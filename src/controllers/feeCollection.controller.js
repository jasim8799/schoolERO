const Bill = require('../models/Bill');
const Student = require('../models/Student');
const { processBillPayments, PaymentEngineError } = require('../services/paymentEngine.service');
const { ensureStudentPendingAssignmentBills } = require('../services/feeAssignmentBillSync.service');

const getSessionFilter = (req) => {
  const sessionId = req.user?.sessionId;
  return sessionId ? { $or: [{ sessionId }, { sessionId: { $exists: false } }] } : {};
};

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const extractBillMonth = (bill) => {
  const direct = bill?.month?.toString();
  if (direct && direct.trim()) return direct;

  const description = bill?.description?.toString() || '';
  for (const monthName of MONTH_NAMES) {
    if (description.includes(monthName)) return monthName;
  }

  const shortMonths = {
    Jan: 'January',
    Feb: 'February',
    Mar: 'March',
    Apr: 'April',
    May: 'May',
    Jun: 'June',
    Jul: 'July',
    Aug: 'August',
    Sep: 'September',
    Oct: 'October',
    Nov: 'November',
    Dec: 'December',
  };
  for (const [abbr, full] of Object.entries(shortMonths)) {
    if (description.includes(abbr)) return full;
  }

  if (bill?.dueDate) {
    const dt = new Date(bill.dueDate);
    if (!Number.isNaN(dt.getTime())) return MONTH_NAMES[dt.getMonth()];
  }

  if (bill?.createdAt) {
    const dt = new Date(bill.createdAt);
    if (!Number.isNaN(dt.getTime())) return MONTH_NAMES[dt.getMonth()];
  }

  return '';
};

// GET /api/fee-collection/search?q=searchTerm
// Search students by name, mobile, roll number, or admission number
exports.searchStudents = async (req, res) => {
  try {
    const { q } = req.query;
    const { schoolId } = req.user;
    if (!schoolId) {
      return res.status(400).json({ success: false, message: 'School context missing' });
    }

    if (!q || q.trim().length < 1) {
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
      ...getSessionFilter(req),
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
      .populate({
        path: 'parentId',
        select: 'name guardianName',
        populate: { path: 'userId', select: 'name mobile' }
      })
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
    console.error('[FEE SEARCH ERROR]', err.message, err.stack);
    if (err.name === 'CastError') {
      return res.status(400).json({ success: false, message: 'Invalid ID format in search' });
    }
    res.status(500).json({ success: false, message: 'Search failed. Please try again.' });
  }
};

// GET /api/fee-collection/student/:studentId/dues
// Get all unpaid/partial bills for a student
exports.getStudentDues = async (req, res) => {
  try {
    const { studentId } = req.params;
    const { schoolId, sessionId, _id: userId } = req.user;

    // Keep monthly tuition/assignment bills consistent with Hostel/Transport behavior:
    // if an assignment exists for the current flow but Bill is missing, backfill once.
    await ensureStudentPendingAssignmentBills({
      schoolId,
      studentId,
      sessionId,
      createdBy: userId,
    });

    const bills = await Bill.find({
      studentId,
      schoolId,
      ...getSessionFilter(req),
      status: { $in: ['UNPAID', 'PARTIAL'] }
    })
      .populate('sessionId', 'name')
      .sort({ createdAt: 1 })
      .lean();

    const enrichedBills = bills.map((bill) => ({
      ...bill,
      month: extractBillMonth(bill),
    }));

    // Calculate total due
    const totalDue = enrichedBills.reduce(
      (sum, b) => sum + (b.dueAmount || 0), 0
    );

    res.json({
      success: true,
      data: enrichedBills,
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

    const billItems = billIds.map((billId) => ({
      billId,
      amount: amounts?.[billId] ? parseFloat(amounts[billId]) : undefined,
    }));

    const result = await processBillPayments({
      schoolId,
      actorId: collectedBy,
      reqSessionId: req.user?.sessionId,
      paymentMode,
      notes: notes || '',
      billItems,
      allOrNothing: true,
    });

    return res.status(201).json({
      success: true,
      message: `${result.receipts.length} payment(s) recorded successfully`,
      receipts: result.receipts,
      billIds: result.billIds,
      totalCollected: result.totalCollected,
      ...(result.warnings?.length ? { warnings: result.warnings } : {}),
    });
  } catch (err) {
    if (err instanceof PaymentEngineError) {
      return res.status(err.statusCode || 400).json({
        success: false,
        message: err.message,
        ...(err.details ? { errors: Array.isArray(err.details) ? err.details : [err.details] } : {}),
      });
    }
    return res.status(500).json({ success: false, message: err.message });
  }
};
