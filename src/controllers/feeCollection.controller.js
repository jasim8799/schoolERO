const Bill = require('../models/Bill');
const Payment = require('../models/Payment');
const LedgerEntry = require('../models/LedgerEntry');
const Student = require('../models/Student');
const AcademicSession = require('../models/AcademicSession');

// Generate receipt number
const generateReceiptNumber = (schoolId) => {
  const ts = Date.now();
  const r = Math.floor(Math.random() * 1000)
    .toString().padStart(3, '0');
  return `RCP-${schoolId.toString().slice(-4)}-${ts}-${r}`;
};

// GET /api/fee-collection/search?q=searchTerm
// Search students by name, mobile, roll number, or admission number
exports.searchStudents = async (req, res) => {
  try {
    const { q } = req.query;
    const { schoolId } = req.user;

    if (!q || q.trim().length < 2) {
      return res.json({ success: true, data: [] });
    }

    const search = q.trim();
    const User = require('../models/User');

    // 1. Find users matching name or mobile
    const matchingUsers = await User.find({
      $and: [
        { $or: [{ schoolId: schoolId }, { school: schoolId }] },
        { role: { $in: ['STUDENT', 'student', 'Student'] } },
        { $or: [
          { name: { $regex: search, $options: 'i' } },
          { mobile: { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } }
        ]}
      ]
    }).select('_id').lean();

    const userIds = matchingUsers.map(u => u._id);

    // 2. Search students directly
    const students = await Student.find({
      schoolId,
      $or: [
        ...(userIds.length > 0 ? [{ userId: { $in: userIds } }] : []),
        { rollNumber: { $regex: search, $options: 'i' } },
        { admissionNumber: { $regex: search, $options: 'i' } },
        { name: { $regex: search, $options: 'i' } }
      ]
    })
      .populate('userId', 'name mobile email')
      .populate('classId', 'name')
      .populate('sectionId', 'name')
      .lean();

    // 3. Deduplicate by _id
    const seen = new Set();
    const filtered = students.filter(s => {
      if (seen.has(s._id.toString())) return false;
      seen.add(s._id.toString());
      return true;
    });

    console.log(`[FEE SEARCH] query="${search}" found ${filtered.length} students`);

    res.json({ success: true, data: filtered });
  } catch (err) {
    console.error('[FEE SEARCH ERROR]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/fee-collection/student/:studentId/dues
// Get all unpaid/partial bills for a student
exports.getStudentDues = async (req, res) => {
  try {
    const { studentId } = req.params;
    const { schoolId } = req.user;

    const bills = await Bill.find({
      studentId,
      schoolId,
      status: { $in: ['UNPAID', 'PARTIAL'] }
    })
      .populate('sessionId', 'name')
      .sort({ createdAt: 1 })
      .lean();

    // Calculate total due
    const totalDue = bills.reduce(
      (sum, b) => sum + (b.dueAmount || 0), 0
    );

    res.json({
      success: true,
      data: bills,
      totalDue
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/fee-collection/collect
// Collect payment for one or more bills at once
// Body: { billIds: [...], amounts: {...billId: amount}, paymentMode }
exports.collectPayment = async (req, res) => {
  try {
    const { billIds, amounts, paymentMode, notes } = req.body;
    const { schoolId, _id: collectedBy } = req.user;

    if (!billIds || !billIds.length) {
      return res.status(400).json({ message: 'No bills selected' });
    }
    if (!paymentMode) {
      return res.status(400).json({ message: 'Payment mode required' });
    }

    // Get active session
    const session = await AcademicSession.findOne({
      schoolId, isActive: true
    });

    const billTypeToCategory = {
      TUITION: 'FEE_COLLECTION',
      HOSTEL: 'HOSTEL_COLLECTION',
      TRANSPORT: 'TRANSPORT_COLLECTION',
      EXAM: 'EXAM_COLLECTION',
      ADMISSION: 'FEE_COLLECTION',
      LIBRARY: 'FEE_COLLECTION',
      SPORTS: 'FEE_COLLECTION',
      MISCELLANEOUS: 'FEE_COLLECTION'
    };

    const receipts = [];

    for (const billId of billIds) {
      const bill = await Bill.findOne({ _id: billId, schoolId });
      if (!bill) continue;
      if (bill.status === 'PAID') continue;

      // Use specified amount or full due amount
      const amount = amounts?.[billId]
        ? parseFloat(amounts[billId])
        : bill.dueAmount;

      if (amount <= 0 || amount > bill.dueAmount) continue;

      const sessionId = session?._id || bill.sessionId;
      if (!sessionId) continue;

      // Generate unique receipt number
      let receiptNumber;
      let attempts = 0;
      do {
        receiptNumber = generateReceiptNumber(schoolId);
        attempts++;
        if (attempts > 10) break;
      } while (await Payment.findOne({ receiptNumber }));

      // Create payment
      const payment = await Payment.create({
        receiptNumber,
        billId: bill._id,
        studentId: bill.studentId,
        schoolId,
        sessionId,
        amount,
        paymentMode,
        paymentDate: new Date(),
        collectedBy,
        notes: notes || ''
      });

      // Update bill (pre-save hook recalculates dueAmount and status)
      bill.paidAmount += amount;
      await bill.save();

      // Ledger entry — never fail the parent payment
      try {
        await LedgerEntry.create({
          schoolId,
          sessionId,
          entryType: 'DEBIT',
          category: billTypeToCategory[bill.billType] || 'FEE_COLLECTION',
          amount,
          sourceModel: 'Payment',
          referenceId: payment._id,
          description: `Fee collected — ${bill.description}`,
          entryDate: new Date(),
          performedBy: collectedBy
        });
      } catch (ledgerErr) {
        console.error('Ledger error:', ledgerErr.message);
      }

      receipts.push({
        receiptNumber,
        billId: bill._id,
        billNumber: bill.billNumber,
        billType: bill.billType,
        description: bill.description,
        amount,
        paymentId: payment._id
      });
    }

    res.status(201).json({
      success: true,
      message: `${receipts.length} payment(s) recorded successfully`,
      receipts,
      totalCollected: receipts.reduce((s, r) => s + r.amount, 0)
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
