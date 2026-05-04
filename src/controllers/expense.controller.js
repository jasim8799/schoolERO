const Expense = require('../models/Expense');
const AcademicSession = require('../models/AcademicSession');
const LedgerEntry = require('../models/LedgerEntry');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads/expenses');
    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Generate unique filename
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'expense-' + uniqueSuffix + path.extname(file.originalname));
  }
});

// File filter for PDF and images
const fileFilter = (req, file, cb) => {
  const allowedTypes = /pdf|jpeg|jpg|png/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);

  if (mimetype && extname) {
    return cb(null, true);
  } else {
    cb(new Error('Only PDF, JPEG, JPG, and PNG files are allowed'));
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  }
});

// Create expense
const createExpense = async (req, res) => {
  try {
    const { category, amount, date, paymentMode, description } = req.body;
    const { schoolId, _id: createdBy } = req.user;

    // Validate amount
    if (amount <= 0) {
      return res.status(400).json({ message: 'Amount must be greater than 0' });
    }

    // Get current active session
    const currentSession = await AcademicSession.findOne({
      schoolId,
      isActive: true
    });

    if (!currentSession) {
      return res.status(400).json({ message: 'No active academic session found' });
    }

    // Handle file upload
    let billAttachment = null;
    if (req.file) {
      billAttachment = req.file.filename;
    }

    // Create expense
    const expense = await Expense.create({
      category,
      amount: parseFloat(amount),
      date: date ? new Date(date) : new Date(),
      paymentMode,
      description,
      billAttachment,
      createdBy,
      schoolId,
      sessionId: currentSession._id
    });

    // Populate references
    await expense.populate('createdBy', 'name');
    await expense.populate('sessionId', 'name');

    // Ledger dual-write — never fail the expense creation
    try {
      await LedgerEntry.create({
        schoolId,
        sessionId: currentSession._id,
        entryType: 'CREDIT',
        category: 'EXPENSE_PAYMENT',
        amount: expense.amount,
        description: expense.description || `Expense: ${expense.category}`,
        referenceId: expense._id,
        sourceModel: 'Expense',
        performedBy: createdBy,
        entryDate: expense.date || new Date()
      });
    } catch (ledgerErr) {
      console.error('[LedgerEntry] expense dual-write failed:', ledgerErr.message);
    }

    res.status(201).json({
      message: 'Expense created successfully',
      expense
    });
  } catch (err) {
    // Clean up uploaded file if error occurs
    if (req.file) {
      fs.unlinkSync(req.file.path);
    }

    if (err.code === 11000) {
      return res.status(409).json({ message: 'Duplicate expense entry' });
    }
    res.status(500).json({ message: err.message });
  }
};

// Get expenses with month filter
const getExpenses = async (req, res) => {
  try {
    const { month } = req.query; // Format: YYYY-MM
    const { schoolId } = req.user;

    let filter = { schoolId };

    // Add month filter if provided
    if (month) {
      const [year, monthNum] = month.split('-');
      const startDate = new Date(year, monthNum - 1, 1);
      const endDate = new Date(year, monthNum, 1);

      filter.date = {
        $gte: startDate,
        $lt: endDate
      };
    }

    const expenses = await Expense.find(filter)
      .populate('createdBy', 'name')
      .populate('sessionId', 'name')
      .sort({ date: -1 });

    // Calculate totals
    const totalAmount = expenses.reduce((sum, expense) => sum + expense.amount, 0);
    const categoryTotals = expenses.reduce((acc, expense) => {
      acc[expense.category] = (acc[expense.category] || 0) + expense.amount;
      return acc;
    }, {});

    res.json({
      success: true,
      data: expenses,
      summary: {
        totalExpenses: expenses.length,
        totalAmount,
        categoryTotals,
        month: month || 'All'
      }
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Get expense summary
const getExpenseSummary = async (req, res) => {
  try {
    const { month } = req.query;
    const { schoolId } = req.user;

    // Validate mandatory month parameter
    if (!month) {
      return res.status(400).json({ message: 'Month parameter is required (format: YYYY-MM)' });
    }

    // Validate month format
    const monthRegex = /^\d{4}-\d{2}$/;
    if (!monthRegex.test(month)) {
      return res.status(400).json({ message: 'Invalid month format. Use YYYY-MM' });
    }

    // Get active session
    const activeSession = await AcademicSession.findOne({
      schoolId: schoolId,
      isActive: true
    });

    if (!activeSession) {
      return res.status(400).json({
        success: false,
        message: 'No active academic session found for this school'
      });
    }

    // Parse month to date range
    const [year, monthNum] = month.split('-');
    const startDate = new Date(year, monthNum - 1, 1);
    const endDate = new Date(year, monthNum, 1);

    // MongoDB aggregation pipeline — no sessionId filter so totals match the list
    const pipeline = [
      {
        $match: {
          schoolId,
          date: {
            $gte: startDate,
            $lt: endDate
          }
        }
      },
      {
        $group: {
          _id: '$category',
          total: { $sum: '$amount' }
        }
      }
    ];

    const categoryTotals = await Expense.aggregate(pipeline);

    // Calculate total expense
    const totalExpense = categoryTotals.reduce((sum, cat) => sum + cat.total, 0);

    // Format byCategory array
    const byCategory = categoryTotals.map(cat => ({
      category: cat._id,
      total: cat.total
    }));

    res.json({
      month,
      totalExpense,
      byCategory
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Get single expense by ID
const getExpenseById = async (req, res) => {
  try {
    const { id } = req.params;
    const { schoolId } = req.user;

    if (!id || !id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid expense ID format'
      });
    }

    const expense = await Expense.findOne({ _id: id, schoolId })
      .populate('createdBy', 'name')
      .populate('sessionId', 'name');

    if (!expense) {
      return res.status(404).json({
        success: false,
        message: 'Expense not found'
      });
    }

    res.json({ success: true, expense });
  } catch (err) {
    if (err.name === 'CastError') {
      return res.status(400).json({ success: false, message: 'Invalid expense ID' });
    }
    res.status(500).json({ success: false, message: err.message });
  }
};

// Update expense (Principal only)
const updateExpense = async (req, res) => {
  try {
    const { id } = req.params;
    const { schoolId, role } = req.user;

    if (role !== 'PRINCIPAL') {
      return res.status(403).json({
        success: false,
        message: 'Only principals can update expense records'
      });
    }

    if (!id || !id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid expense ID format'
      });
    }

    const expense = await Expense.findOne({ _id: id, schoolId });
    if (!expense) {
      return res.status(404).json({
        success: false,
        message: 'Expense not found or does not belong to this school'
      });
    }

    const { category, amount, date, paymentMode, description } = req.body;

    if (amount !== undefined) {
      const parsedAmount = parseFloat(amount);
      if (isNaN(parsedAmount) || parsedAmount <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Amount must be a number greater than 0'
        });
      }
      expense.amount = parsedAmount;
    }

    const validCategories = ['Electricity', 'Salary', 'Repair', 'Hostel', 'Transport', 'Misc'];
    if (category !== undefined) {
      if (!validCategories.includes(category)) {
        return res.status(400).json({
          success: false,
          message: `Invalid category. Must be one of: ${validCategories.join(', ')}`
        });
      }
      expense.category = category;
    }

    if (paymentMode !== undefined) {
      if (!['Cash', 'Bank'].includes(paymentMode)) {
        return res.status(400).json({
          success: false,
          message: 'Payment mode must be Cash or Bank'
        });
      }
      expense.paymentMode = paymentMode;
    }

    if (description !== undefined) {
      if (typeof description !== 'string' || description.trim().length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Description cannot be empty'
        });
      }
      expense.description = description.trim();
    }

    if (date !== undefined) {
      const parsedDate = new Date(date);
      if (isNaN(parsedDate.getTime())) {
        return res.status(400).json({
          success: false,
          message: 'Invalid date format'
        });
      }
      expense.date = parsedDate;
    }

    await expense.save();
    await expense.populate('createdBy', 'name');
    await expense.populate('sessionId', 'name');

    res.json({
      success: true,
      message: 'Expense updated successfully',
      expense
    });
  } catch (err) {
    if (err.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid expense ID'
      });
    }
    if (err.name === 'ValidationError') {
      const messages = Object.values(err.errors).map(e => e.message);
      return res.status(400).json({
        success: false,
        message: messages.join(', ')
      });
    }
    console.error('[updateExpense] error:', err.message);
    res.status(500).json({
      success: false,
      message: 'Server error while updating expense'
    });
  }
};

// Export functions and multer middleware
module.exports = {
  createExpense,
  getExpenses,
  getExpenseSummary,
  getExpenseById,
  updateExpense,
  upload
};
