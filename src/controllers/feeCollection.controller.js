const Bill = require('../models/Bill');
const Payment = require('../models/Payment');
const LedgerEntry = require('../models/LedgerEntry');
const Student = require('../models/Student');
const AcademicSession = require('../models/AcademicSession');
const { syncBillPaymentToSource, syncByStudentAndType } = require('../services/feeSync.service');
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
    const errors = [];

    for (const billId of billIds) {
      let bill;
      try {
        bill = await Bill.findOne({ _id: billId, schoolId, ...getSessionFilter(req) });
      } catch (findErr) {
        errors.push({ billId, error: 'Bill lookup failed' });
        continue;
      }
      if (!bill) {
        errors.push({ billId, error: 'Bill not found' });
        continue;
      }
      if (bill.status === 'PAID') {
        errors.push({ billId, error: 'Already paid' });
        continue;
      }

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

      await syncBillPaymentToSource(bill);

      if (!bill.sourceId && ['TRANSPORT', 'HOSTEL'].includes(bill.billType)) {
        await syncByStudentAndType({
          studentId: bill.studentId,
          schoolId,
          billType: bill.billType,
          sessionId: session?._id,
        });
      }

      if (bill.billType === 'TRANSPORT' && bill.status === 'PAID') {
        try {
          const TransportFee = require('../models/TransportFee');
          const updated = await TransportFee.findOneAndUpdate(
            { studentId: bill.studentId, schoolId, status: 'PENDING' },
            { status: 'PAID', paymentDate: new Date() },
            { sort: { createdAt: -1 }, new: true }
          );

          if (updated && !bill.sourceId) {
            await Bill.findByIdAndUpdate(bill._id, {
              sourceType: 'StudentTransport',
              sourceId: updated._id,
            });
          }
        } catch (e) {
          console.error('[FeeCollection] Transport sync failed:', e.message);
        }
      }

      if (bill.billType === 'HOSTEL' && bill.status === 'PAID') {
        try {
          const StudentHostel = require('../models/StudentHostel');
          await StudentHostel.findOneAndUpdate(
            { studentId: bill.studentId, schoolId, status: 'ACTIVE' },
            { feeStatus: 'PAID', lastPaymentDate: new Date() }
          );
        } catch (e) {
          console.error('[FeeCollection] Hostel sync failed:', e.message);
        }
      }

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

    if (receipts.length === 0) {
      return res.status(400).json({
        success: false,
        message: errors.length > 0
          ? `No payments processed: ${errors.map(e => e.error).join(', ')}`
          : 'No valid bills to process',
        errors
      });
    }

    res.status(201).json({
      success: true,
      message: `${receipts.length} payment(s) recorded successfully`,
      receipts,
      billIds: receipts.map(r => r.billId.toString()),
      totalCollected: receipts.reduce((s, r) => s + r.amount, 0),
      ...(errors.length > 0 ? { warnings: errors } : {})
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
