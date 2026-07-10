const Bill = require('../models/Bill');
const Payment = require('../models/Payment');
const LedgerEntry = require('../models/LedgerEntry');
const Student = require('../models/Student');
const AcademicSession = require('../models/AcademicSession');
const mongoose = require('mongoose');
const { processBillPayments, PaymentEngineError } = require('../services/paymentEngine.service');
const {
  ensureStudentPendingAssignmentBills,
  ensureSchoolPendingAssignmentBills,
} = require('../services/feeAssignmentBillSync.service');

const getSessionFilter = (req) => {
  const sessionId = req.user?.sessionId;
  return sessionId ? { $or: [{ sessionId }, { sessionId: { $exists: false } }] } : {};
};

// Generate bill number
const generateBillNumber = (schoolId) => {
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 1000)
    .toString().padStart(3, '0');
  return `BILL-${schoolId.toString().slice(-4)}-${timestamp}-${random}`;
};

// GET /api/bills/student/:studentId
// Get all bills for a student
exports.getStudentBills = async (req, res) => {
  try {
    const { studentId } = req.params;
    const { schoolId, sessionId, _id: userId } = req.user;
    const { status, billType } = req.query;

    await ensureStudentPendingAssignmentBills({
      schoolId,
      studentId,
      sessionId,
      createdBy: userId,
    });

    const filter = { studentId, schoolId, ...getSessionFilter(req) };
    if (status) filter.status = status;
    if (billType) filter.billType = billType;

    const bills = await Bill.find(filter)
      .populate({
        path: 'studentId',
        select: 'name rollNumber admissionNumber parentId',
        populate: [
          { path: 'classId', select: 'name' },
          { path: 'sectionId', select: 'name' },
          {
            path: 'parentId',
            select: 'name guardianName',
            populate: { path: 'userId', select: 'name mobile' }
          },
        ],
      })
      .populate('sessionId', 'name')
      .sort({ createdAt: -1 })
      .lean();

    res.json({ success: true, data: bills });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/bills
// Get all bills for school (with filters)
exports.getSchoolBills = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { status, billType, studentId, page = 1, limit = 50 } = req.query;

    const filter = { schoolId, ...getSessionFilter(req) };
    if (status) filter.status = status;
    if (billType) filter.billType = billType;
    if (studentId) filter.studentId = studentId;

    const skip = (page - 1) * limit;
    const [bills, total] = await Promise.all([
      Bill.find(filter)
        .populate({
          path: 'studentId',
          select: 'name rollNumber classId sectionId',
          populate: [
            { path: 'classId', select: 'name' },
            { path: 'sectionId', select: 'name' }
          ]
        })
        .populate('sessionId', 'name')
        .populate('createdBy', 'name')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      Bill.countDocuments(filter)
    ]);

    // Attach paymentMode from the most recent Payment for each bill
    const billIds = bills.map(b => b._id);
    const latestPayments = await Payment.find(
      { billId: { $in: billIds } },
      { billId: 1, paymentMode: 1, collectedBy: 1 }
    )
      .populate('collectedBy', 'name')
      .sort({ paymentDate: -1 })
      .lean();

    // Build map: billId -> latest payment
    const paymentMap = {};
    for (const p of latestPayments) {
      const key = p.billId.toString();
      if (!paymentMap[key]) {
        paymentMap[key] = p; // first = latest (sorted desc)
      }
    }

    // Merge payment info onto each bill
    const enrichedBills = bills.map(b => {
      const payment = paymentMap[b._id.toString()];
      return {
        ...b,
        paymentMode: payment?.paymentMode || null,
        collectedByUser: payment?.collectedBy || b.createdBy || null,
      };
    });

    res.json({
      success: true,
      data: enrichedBills,
      pagination: { total, page: Number(page), limit: Number(limit) }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/bills
// Create a bill manually
exports.createBill = async (req, res) => {
  try {
    const { schoolId, _id: createdBy, sessionId } = req.user;
    const {
      studentId, billType, description,
      totalAmount, dueDate, sourceType, sourceId
    } = req.body;

    // Validate student
    const student = await Student.findOne({ _id: studentId, schoolId });
    if (!student) {
      return res.status(400).json({ message: 'Student not found' });
    }

    if (!sessionId) {
      return res.status(400).json({ message: 'No active session found' });
    }

    // Generate bill number
    let billNumber;
    let attempts = 0;
    do {
      billNumber = generateBillNumber(schoolId);
      attempts++;
      if (attempts > 10) throw new Error('Could not generate bill number');
    } while (await Bill.findOne({ billNumber }));

    const bill = await Bill.create({
      billNumber,
      studentId,
      schoolId,
      sessionId,
      billType,
      sourceType: sourceType || 'Manual',
      sourceId: sourceId || null,
      description,
      totalAmount,
      paidAmount: 0,
      dueAmount: totalAmount,
      status: 'UNPAID',
      dueDate: dueDate || null,
      createdBy
    });

    res.status(201).json({ success: true, data: bill });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/bills/:billId/pay
// Record a payment against a bill
exports.payBill = async (req, res) => {
  try {
    const { billId } = req.params;
    const { schoolId, _id: collectedBy, sessionId } = req.user;
    const { amount, paymentMode, notes } = req.body;

    const bill = await Bill.findOne({ _id: billId, schoolId, ...getSessionFilter(req) });
    if (!bill) {
      return res.status(404).json({ message: 'Bill not found' });
    }
    if (bill.status === 'PAID') {
      return res.status(400).json({ message: 'Bill is already paid' });
    }
    if (amount > bill.dueAmount) {
      return res.status(400).json({
        message: 'Payment amount exceeds due amount'
      });
    }

    const result = await processBillPayments({
      schoolId,
      actorId: collectedBy,
      reqSessionId: sessionId || bill.sessionId,
      paymentMode,
      notes: notes || '',
      billItems: [{ billId: bill._id, amount }],
      allOrNothing: true,
    });

    const receipt = result.receipts[0];
    const updatedBill = await Bill.findById(bill._id).lean();
    const payment = await Payment.findById(receipt.paymentId).lean();

    res.status(201).json({
      success: true,
      data: {
        payment,
        bill: {
          _id: updatedBill._id,
          billNumber: updatedBill.billNumber,
          totalAmount: updatedBill.totalAmount,
          paidAmount: updatedBill.paidAmount,
          dueAmount: updatedBill.dueAmount,
          status: updatedBill.status
        }
      },
      receiptNumber: receipt.receiptNumber,
      message: 'Payment recorded successfully'
    });
  } catch (err) {
    if (err instanceof PaymentEngineError) {
      return res.status(err.statusCode || 400).json({ success: false, message: err.message });
    }
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/bills/summary
// Dashboard summary for school - Uses shared service for fee due calculation
exports.getBillSummary = async (req, res) => {
  try {
    const { schoolId, sessionId, _id: userId } = req.user;

    // Ensure assignment-backed tuition bills (all pending months)
    // are present before aggregating dashboard summary cards.
    await ensureSchoolPendingAssignmentBills({
      schoolId,
      sessionId,
      createdBy: userId,
    });

    const safeSchoolId = schoolId?._id
      ? new mongoose.Types.ObjectId(schoolId._id.toString())
      : new mongoose.Types.ObjectId(schoolId.toString());
    const safeSessionId = sessionId
      ? new mongoose.Types.ObjectId(sessionId.toString())
      : null;

    console.log('[BillSummary][Context] schoolId received:', schoolId);
    console.log('[BillSummary][Context] schoolId used:', safeSchoolId.toString());
    console.log('[BillSummary][Context] sessionId received:', sessionId || null);

    // FIX: Use schoolSessionMatch for ALL dashboard aggregations
    // This ensures summary cards reflect ONLY the current active session
    const schoolMatch = { schoolId: safeSchoolId };
    const schoolSessionMatch = safeSessionId
      ? { schoolId: safeSchoolId, sessionId: safeSessionId }
      : { schoolId: safeSchoolId };

    // Get payment data separately (not part of shared service)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 1);

    const [
      totalBillsCount,
      paidBillsCount,
      partialBillsCount,
      unpaidBillsCount,
      cancelledBillsCount,
      waivedBillsCount,
      totalPaidAmountAgg,
      dueByStatusAgg,
      todayPayments,
      allPayments,
      monthPayments,
    ] = await Promise.all([
      Bill.countDocuments(schoolSessionMatch),
      Bill.countDocuments({ ...schoolSessionMatch, status: 'PAID' }),
      Bill.countDocuments({ ...schoolSessionMatch, status: 'PARTIAL' }),
      Bill.countDocuments({ ...schoolSessionMatch, status: 'UNPAID' }),
      Bill.countDocuments({ ...schoolSessionMatch, status: 'CANCELLED' }),
      Bill.countDocuments({ ...schoolSessionMatch, status: 'WAIVED' }),
      Bill.aggregate([
        { $match: schoolSessionMatch },
        { $group: { _id: null, totalPaidAmount: { $sum: '$paidAmount' } } },
      ]),
      Bill.aggregate([
        {
          $match: {
            ...schoolSessionMatch,
            status: { $in: ['UNPAID', 'PARTIAL'] },
            dueAmount: { $gt: 0 },
          },
        },
        {
          $group: {
            _id: '$status',
            due: { $sum: '$dueAmount' },
            count: { $sum: 1 },
          },
        },
      ]),
      Payment.aggregate([
        { $match: { ...schoolSessionMatch, paymentDate: { $gte: today, $lt: tomorrow } } },
        { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]),
      Payment.aggregate([
        { $match: schoolSessionMatch },
        { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]),
      Payment.aggregate([
        { $match: { ...schoolSessionMatch, paymentDate: { $gte: monthStart, $lt: monthEnd } } },
        { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]),
    ]);

    const dueMap = dueByStatusAgg.reduce((acc, item) => {
      acc[item._id] = { due: item.due || 0, count: item.count || 0 };
      return acc;
    }, {});

    const unpaidDue = dueMap.UNPAID?.due || 0;
    const partialDue = dueMap.PARTIAL?.due || 0;
    const unpaidCount = dueMap.UNPAID?.count || 0;
    const partialCount = dueMap.PARTIAL?.count || 0;
    const totalDue = unpaidDue + partialDue;
    const totalPaidAmount = totalPaidAmountAgg[0]?.totalPaidAmount || 0;

    console.log('========== BILL SUMMARY (Session-Scoped) ==========' );
    console.log('[BillSummary][Session] schoolId:', safeSchoolId.toString());
    console.log('[BillSummary][Session] sessionId:', safeSessionId?.toString() || 'none (school-level fallback)');
    console.log('[BillSummary][DB] Total Bills:', totalBillsCount);
    console.log('[BillSummary][DB] Paid Bills:', paidBillsCount);
    console.log('[BillSummary][DB] Partial Bills:', partialBillsCount);
    console.log('[BillSummary][DB] Unpaid Bills:', unpaidBillsCount);
    console.log('[BillSummary][DB] Cancelled Bills:', cancelledBillsCount);
    console.log('[BillSummary][DB] Waived Bills:', waivedBillsCount);
    console.log('[BillSummary][DB] Total Payments:', allPayments[0]?.count || 0);
    console.log('[BillSummary][DB] Today\'s Payments:', todayPayments[0]?.count || 0);
    console.log('[BillSummary][DB] Current Month Payments:', monthPayments[0]?.count || 0);
    console.log('[BillSummary][DB] Total Due Amount:', totalDue);
    console.log('[BillSummary][DB] Total Paid Amount (Bill.paidAmount sum):', totalPaidAmount);
    console.log('[BillSummary][Response] unpaidDue:', unpaidDue, 'partialDue:', partialDue, 'totalDue:', totalDue);
    console.log('[BillSummary][Response] collectedToday:', todayPayments[0]?.total || 0, 'totalCollected:', allPayments[0]?.total || 0, 'thisMonthCollected:', monthPayments[0]?.total || 0);
    console.log('================================================');

    res.json({
      success: true,
      data: {
        totalDue: totalDue,
        unpaidDue,
        unpaidCount,
        partialDue,
        partialCount,
        // Payment data
        paidTotal: totalPaidAmount,
        paidCount: paidBillsCount,
        collectedToday: todayPayments[0]?.total || 0,
        paymentsToday: todayPayments[0]?.count || 0,
        totalCollected: allPayments[0]?.total || 0,
        totalPaymentsCount: allPayments[0]?.count || 0,
        thisMonthCollected: monthPayments[0]?.total || 0,
        thisMonthPaymentsCount: monthPayments[0]?.count || 0
      }
    });
} catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/bills/ledger
// Paginated ledger entries for the school
exports.getLedger = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const {
      page = 1,
      limit = 50,
      category,
      entryType,
      from,
      to
    } = req.query;

    const filter = { schoolId, ...getSessionFilter(req) };
    if (category) filter.category = category;
    if (entryType) filter.entryType = entryType;
    if (from || to) {
      filter.entryDate = {};
      if (from) filter.entryDate.$gte = new Date(from);
      if (to)   filter.entryDate.$lte = new Date(to);
    }

    const skip = (page - 1) * limit;
    const [entries, total] = await Promise.all([
      LedgerEntry.find(filter)
        .populate('performedBy', 'name')
        .populate('sessionId', 'name')
        .sort({ entryDate: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      LedgerEntry.countDocuments(filter)
    ]);

    res.json({
      success: true,
      data: entries,
      pagination: { total, page: Number(page), limit: Number(limit) }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/bills/profit-loss
// Aggregated income vs expenditure for a date range
exports.getProfitLoss = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { from, to } = req.query;

    const dateFilter = {};
    if (from) dateFilter.$gte = new Date(from);
    if (to)   dateFilter.$lte = new Date(to);

    const matchStage = { schoolId, ...(req.user?.sessionId ? { sessionId: req.user.sessionId } : {}) };
    if (from || to) matchStage.entryDate = dateFilter;

    const results = await LedgerEntry.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: { entryType: '$entryType', category: '$category' },
          total: { $sum: '$amount' },
          count: { $sum: 1 }
        }
      }
    ]);

    let totalIncome = 0;
    let totalExpense = 0;
    const breakdown = {};

    for (const r of results) {
      const { entryType, category } = r._id;
      breakdown[category] = (breakdown[category] || 0) + r.total;
      if (entryType === 'DEBIT') {
        totalIncome += r.total;
      } else {
        totalExpense += r.total;
      }
    }

    res.json({
      success: true,
      data: {
        totalIncome,
        totalExpense,
        netProfit: totalIncome - totalExpense,
        breakdown
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/bills/receipt/:receiptNumber
// Generate PDF receipt for a bill payment
exports.getBillReceipt = async (req, res) => {
  try {
    const { receiptNumber } = req.params;
    const { schoolId } = req.user;

    const payment = await Payment.findOne({ receiptNumber, schoolId, ...getSessionFilter(req) })
      .populate('billId')
      .populate('collectedBy', 'name')
      .populate('studentId', 'name rollNumber')
      .lean();

    if (!payment) {
      return res.status(404).json({ message: 'Receipt not found' });
    }

    const bill = payment.billId;
    const student = payment.studentId;

    let receiptPayments = [payment];
    if (payment.transactionGroupId) {
      const groupedPayments = await Payment.find({
        transactionGroupId: payment.transactionGroupId,
        schoolId,
        studentId: payment.studentId?._id || payment.studentId,
        ...getSessionFilter(req),
      })
        .populate(
          'billId',
          'billNumber billType description totalAmount paidAmount dueAmount status'
        )
        .sort({ paymentDate: -1 })
        .lean();

      if (groupedPayments.length > 0) {
        receiptPayments = groupedPayments;
      }
    }

    const normalizeBillType = (value) =>
      String(value || '')
        .trim()
        .toUpperCase();

    const billById = new Map();
    for (const p of receiptPayments) {
      const billDoc = p?.billId && typeof p.billId === 'object' ? p.billId : null;
      const billId = billDoc?._id || p?.billId;
      const key = billId ? String(billId) : '';
      if (!key || billById.has(key)) continue;
      if (billDoc) {
        billById.set(key, billDoc);
      }
    }
    if (bill?._id && !billById.has(String(bill._id))) {
      billById.set(String(bill._id), bill);
    }
    const receiptBills = Array.from(billById.values());

    const billTypes = Array.from(
      new Set(
        receiptPayments
          .map((p) => normalizeBillType(p?.billId?.billType || bill?.billType))
          .filter(Boolean)
      )
    );
    const computedBillType =
      billTypes.length === 0
        ? normalizeBillType(bill?.billType) || 'N/A'
        : billTypes.length === 1
        ? billTypes[0]
        : `MULTIPLE FEES (${billTypes.length})`;

    const aggregatedBillTotal = receiptBills.reduce(
      (sum, b) => sum + (Number(b?.totalAmount) || 0),
      0
    );
    const aggregatedPaidSoFar = receiptBills.reduce(
      (sum, b) => sum + (Number(b?.paidAmount) || 0),
      0
    );
    const aggregatedBalanceDue = receiptBills.reduce(
      (sum, b) => sum + (Number(b?.dueAmount) || 0),
      0
    );

    const School = require('../models/School');
    const school = await School.findById(schoolId).lean();

    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ size: 'A4', margin: 50 });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=receipt-${receiptNumber}.pdf`
    );
    doc.pipe(res);

    // ── Header ──────────────────────────────────────────
    doc.fontSize(22).font('Helvetica-Bold')
      .text('FEE RECEIPT', { align: 'center' });
    doc.moveDown(0.5);

    doc.fontSize(15).font('Helvetica-Bold')
      .text(school?.name || 'School ERP', { align: 'center' });
    if (school?.address) {
      doc.fontSize(10).font('Helvetica')
        .text(school.address, { align: 'center' });
    }
    if (school?.phone || school?.email) {
      doc.fontSize(10).font('Helvetica')
        .text(
          [school?.phone, school?.email].filter(Boolean).join(' | '),
          { align: 'center' }
        );
    }
    doc.moveDown(1);

    doc.moveTo(50, doc.y).lineTo(545, doc.y)
      .strokeColor('#2D5A8E').lineWidth(2).stroke();
    doc.moveDown(1);

    // ── Receipt Details ──────────────────────────────────
    doc.fontSize(13).font('Helvetica-Bold')
      .text('Receipt Details', { underline: true });
    doc.moveDown(0.5);

    const receiptRows = [
      ['Receipt Number', receiptNumber],
      ['Date', new Date(payment.paymentDate).toLocaleDateString('en-IN', {
        day: '2-digit', month: 'long', year: 'numeric'
      })],
      ['Payment Mode', payment.paymentMode],
      ['Amount Paid', `Rs. ${receiptPayments
        .reduce((sum, p) => sum + (Number(p?.amount) || 0), 0)
        .toLocaleString('en-IN')}`],
    ];

    receiptRows.forEach(([label, value]) => {
      doc.fontSize(11).font('Helvetica-Bold')
        .text(label + ':', { continued: true, width: 160 });
      doc.font('Helvetica').text('  ' + value);
    });

    doc.moveDown(1);

    // ── Student Information ──────────────────────────────
    doc.fontSize(13).font('Helvetica-Bold')
      .text('Student Information', { underline: true });
    doc.moveDown(0.5);

    [['Student Name', student?.name || 'N/A'],
     ['Roll Number', student?.rollNumber || 'N/A']].forEach(([label, value]) => {
      doc.fontSize(11).font('Helvetica-Bold')
        .text(label + ':', { continued: true, width: 160 });
      doc.font('Helvetica').text('  ' + value);
    });

    doc.moveDown(1);

    // ── Bill Information ─────────────────────────────────
    doc.fontSize(13).font('Helvetica-Bold')
      .text('Bill Information', { underline: true });
    doc.moveDown(0.5);

    [['Bill Number',   bill?.billNumber || 'N/A'],
     ['Bill Type',     computedBillType],
     ['Description',   bill?.description || 'N/A'],
     ['Total Amount',  `Rs. ${aggregatedBillTotal.toLocaleString('en-IN')}`],
     ['Amount Paid',   `Rs. ${aggregatedPaidSoFar.toLocaleString('en-IN')}`],
     ['Balance Due',   `Rs. ${aggregatedBalanceDue.toLocaleString('en-IN')}`],
     ['Bill Status',   bill?.status || 'N/A']].forEach(([label, value]) => {
      doc.fontSize(11).font('Helvetica-Bold')
        .text(label + ':', { continued: true, width: 160 });
      doc.font('Helvetica').text('  ' + value);
    });

    doc.moveDown(1);

    doc.moveTo(50, doc.y).lineTo(545, doc.y)
      .strokeColor('#2D5A8E').lineWidth(1).stroke();
    doc.moveDown(1);

    if (payment.collectedBy?.name) {
      doc.fontSize(10).font('Helvetica')
        .text(`Collected by: ${payment.collectedBy.name}`, { align: 'right' });
      doc.moveDown(0.5);
    }

    // ── Footer ───────────────────────────────────────────
    doc.moveDown(2);
    doc.fontSize(9).font('Helvetica')
      .fillColor('grey')
      .text('This is a computer generated receipt. No signature required.',
        { align: 'center' });
    doc.text('Thank you for your payment!', { align: 'center' });

    doc.end();
  } catch (err) {
    console.error('Bill receipt PDF error:', err);
    res.status(500).json({ message: 'Error generating receipt' });
  }
};

// ── HTML Receipt ──────────────────────────────────────────────────────────────
// GET /api/bills/:id/receipt
// Returns a print-ready HTML receipt for a bill, combining all its payments.
exports.getBillHtmlReceipt = async (req, res) => {
  try {
    const { id } = req.params;
    const { schoolId } = req.user;

    const School = require('../models/School');
    const StudentFeeAssignment = require('../models/StudentFeeAssignment');
    const StudentFee = require('../models/StudentFee');

    const [bill, school] = await Promise.all([
      Bill.findOne({ _id: id, schoolId, ...getSessionFilter(req) })
        .populate({ path: 'studentId', populate: [
          { path: 'classId',   select: 'name' },
          { path: 'sectionId', select: 'name' },
        ]})
        .lean(),
      School.findById(schoolId).lean(),
    ]);

    if (!bill) {
      return res.status(404).json({ success: false, message: 'Bill not found' });
    }

    // Base payments for this bill, newest first
    const billPayments = await Payment.find({ billId: bill._id, ...getSessionFilter(req) })
      .populate('collectedBy', 'name')
      .populate('billId', 'billNumber billType description sourceType sourceId totalAmount paidAmount dueAmount status')
      .sort({ paymentDate: -1 })
      .lean();

    if (billPayments.length === 0) {
      return res.status(404).json({ success: false, message: 'No payments found for this bill' });
    }

    const primaryPayment = billPayments[0];
    const studentIdValue = bill.studentId?._id || bill.studentId;

    const monthNumberFromName = (txt) => {
      const names = {
        january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
        july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
        jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
      };
      return names[String(txt || '').trim().toLowerCase()] || null;
    };

    const parseMonthFromDescription = (description) => {
      const txt = String(description || '');
      const match = txt.match(/(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s*[,-]?\s*(20\d{2})/i);
      if (!match) return null;
      const month = monthNumberFromName(match[1]);
      const year = Number(match[2]);
      if (!month || !year) return null;
      return new Date(year, month - 1, 1);
    };

    const parseDate = (raw) => {
      if (!raw) return null;
      const dt = new Date(raw);
      return Number.isNaN(dt.getTime()) ? null : dt;
    };

    const monthKeyForBill = (b, fallbackDate = null) => {
      const due = parseDate(b?.dueDate);
      if (due) return `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}`;
      const created = parseDate(b?.createdAt);
      if (created) return `${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, '0')}`;
      const fromDesc = parseMonthFromDescription(b?.description);
      if (fromDesc) {
        return `${fromDesc.getFullYear()}-${String(fromDesc.getMonth() + 1).padStart(2, '0')}`;
      }
      if (fallbackDate) {
        return `${fallbackDate.getFullYear()}-${String(fallbackDate.getMonth() + 1).padStart(2, '0')}`;
      }
      return 'unknown';
    };

    const primaryPaymentDate = parseDate(primaryPayment?.paymentDate);
    const selectedMonthKey = monthKeyForBill(bill, primaryPaymentDate);

    const allStudentBills = await Bill.find({
      schoolId,
      studentId: studentIdValue,
      ...getSessionFilter(req),
    })
      .select('billNumber billType description sourceType sourceId totalAmount paidAmount dueAmount status dueDate createdAt sessionId')
      .lean();

    let monthlyBills = allStudentBills.filter((b) => {
      const status = String(b?.status || '').toUpperCase();
      if (status !== 'PAID' && status !== 'PARTIAL') return false;
      if ((Number(b?.paidAmount) || 0) <= 0) return false;
      return monthKeyForBill(b, primaryPaymentDate) === selectedMonthKey;
    });

    if (!monthlyBills.some((b) => String(b._id) === String(bill._id))) {
      monthlyBills = [bill, ...monthlyBills];
    }

    const monthlyBillIds = monthlyBills.map((b) => b._id);

    let receiptPayments = await Payment.find({
      schoolId,
      studentId: studentIdValue,
      billId: { $in: monthlyBillIds },
      ...getSessionFilter(req),
    })
      .populate('collectedBy', 'name')
      .populate('billId', 'billNumber billType description sourceType sourceId totalAmount paidAmount dueAmount status dueDate createdAt sessionId')
      .sort({ paymentDate: -1 })
      .lean();

    // Fallback for legacy flows: if month-based consolidation returns no lines,
    // keep the prior transaction-group behavior.
    if (receiptPayments.length === 0 && primaryPayment.transactionGroupId) {
      const groupedPayments = await Payment.find({
        transactionGroupId: primaryPayment.transactionGroupId,
        schoolId,
        studentId: studentIdValue,
        ...getSessionFilter(req),
      })
        .populate('collectedBy', 'name')
        .populate('billId', 'billNumber billType description sourceType sourceId totalAmount paidAmount dueAmount status dueDate createdAt sessionId')
        .sort({ paymentDate: -1 })
        .lean();

      if (groupedPayments.length > 0) {
        receiptPayments = groupedPayments;
      } else {
        receiptPayments = billPayments;
      }
    }

    const monthlyBillTypeSummary = monthlyBills
      .map((b) => `${b.billNumber || 'N/A'}:${b.billType || 'N/A'}`)
      .join(', ');
    console.info(
      '[ReceiptRootCause] student=%s session=%s month=%s bills=%d details=%s',
      String(studentIdValue || 'N/A'),
      String(bill.sessionId || 'N/A'),
      selectedMonthKey,
      monthlyBills.length,
      monthlyBillTypeSummary || 'NONE'
    );

    const student     = bill.studentId || {};
    const className   = student.classId?.name   || '—';
    const sectionName = student.sectionId?.name || '—';

    const fmt = (n) =>
      '₹' + (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });

    const fmtDate = (d) =>
      new Date(d).toLocaleDateString('en-IN', {
        day: '2-digit', month: 'long', year: 'numeric',
      });

    const fmtMonth = (monthStr) => {
      if (!monthStr || typeof monthStr !== 'string') return '—';
      const [y, m] = monthStr.split('-').map((v) => Number(v));
      if (!y || !m || m < 1 || m > 12) return '—';
      return new Date(y, m - 1, 1).toLocaleDateString('en-IN', {
        month: 'long',
        year: 'numeric',
      });
    };

    const humanizeToken = (value) =>
      String(value || '')
        .trim()
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .toLowerCase()
        .replace(/\b\w/g, (c) => c.toUpperCase());

    // Parse ref number from notes field ("Ref: XXXX | ...")
    const parseRef = (notes = '') => {
      const m = notes.match(/Ref:\s*([^|]+)/);
      return m ? m[1].trim() : '—';
    };

    const normalizeBillType = (value) =>
      String(value || '')
        .trim()
        .toUpperCase();

    const paymentBillIds = Array.from(
      new Set(
        receiptPayments
          .map((p) => {
            const raw = p?.billId;
            if (!raw) return '';
            if (typeof raw === 'object') {
              return String(raw._id || '');
            }
            return String(raw);
          })
          .filter(Boolean)
      )
    );

    const canonicalBills = paymentBillIds.length
      ? await Bill.find({ _id: { $in: paymentBillIds }, schoolId })
          .select('billNumber billType description sourceType sourceId totalAmount paidAmount dueAmount status')
          .lean()
      : [];
    const canonicalBillById = new Map(
      canonicalBills.map((b) => [String(b._id), b])
    );

    const getPaymentBill = (paymentLine) => {
      const raw = paymentLine?.billId;
      if (!raw) return null;
      if (typeof raw === 'object') {
        const id = String(raw._id || '');
        return canonicalBillById.get(id) || raw;
      }
      return canonicalBillById.get(String(raw)) || null;
    };

    const assignmentSourceIds = [];
    const studentFeeSourceIds = [];
    for (const p of receiptPayments) {
      const b = getPaymentBill(p);
      if (!b || typeof b !== 'object') continue;
      const sourceId = b.sourceId ? String(b.sourceId) : '';
      if (!sourceId) continue;
      if (b.sourceType === 'StudentFeeAssignment') {
        assignmentSourceIds.push(sourceId);
      } else if (b.sourceType === 'StudentFee') {
        studentFeeSourceIds.push(sourceId);
      }
    }

    const [assignmentDocs, studentFeeDocs] = await Promise.all([
      assignmentSourceIds.length
        ? StudentFeeAssignment.find({ _id: { $in: assignmentSourceIds } })
            .populate('feeStructureId', 'name')
            .select('_id month feeStructureId')
            .lean()
        : Promise.resolve([]),
      studentFeeSourceIds.length
        ? StudentFee.find({ _id: { $in: studentFeeSourceIds } })
            .populate('feeStructureId', 'name')
            .select('_id feeStructureId')
            .lean()
        : Promise.resolve([]),
    ]);

    const assignmentMetaById = new Map(
      assignmentDocs.map((doc) => [
        String(doc._id),
        {
          feeName: doc?.feeStructureId?.name || '',
          billingMonth: fmtMonth(doc?.month),
        },
      ])
    );
    const studentFeeMetaById = new Map(
      studentFeeDocs.map((doc) => [
        String(doc._id),
        {
          feeName: doc?.feeStructureId?.name || '',
          billingMonth: '—',
        },
      ])
    );

    const deriveLineMeta = (paymentLine) => {
      const billDoc = getPaymentBill(paymentLine) || bill;
      const sourceType = billDoc?.sourceType || '';
      const sourceId = billDoc?.sourceId ? String(billDoc.sourceId) : '';
      const fromAssignment = sourceId && sourceType === 'StudentFeeAssignment'
        ? assignmentMetaById.get(sourceId)
        : null;
      const fromStudentFee = sourceId && sourceType === 'StudentFee'
        ? studentFeeMetaById.get(sourceId)
        : null;

      const feeNameFromSource = fromAssignment?.feeName || fromStudentFee?.feeName || '';
      const billingMonth = fromAssignment?.billingMonth || fromStudentFee?.billingMonth || '—';
      const billTypeUpper = normalizeBillType(billDoc?.billType || bill?.billType || '');
      const billType = humanizeToken(billTypeUpper);
      const description = (billDoc?.description || bill?.description || '').toString().trim();

      const sourceFeeNorm = feeNameFromSource.trim().toLowerCase();
      const isGenericTuitionName =
        sourceFeeNorm === 'tuition' ||
        sourceFeeNorm === 'tuition fee' ||
        sourceFeeNorm === 'monthly fee' ||
        sourceFeeNorm === 'monthly tuition';

      let feeType;
      if (billTypeUpper === 'HOSTEL') {
        feeType = 'Hostel Fee';
      } else if (billTypeUpper === 'TRANSPORT') {
        feeType = 'Transport Fee';
      } else if (billTypeUpper === 'TUITION') {
        feeType = feeNameFromSource && !isGenericTuitionName
          ? feeNameFromSource
          : 'Tuition Fee';
      } else {
        feeType = feeNameFromSource || billType || description || 'Fee';
      }

      return {
        feeType,
        description: description || feeType,
        billingMonth,
      };
    };

    const receiptLines = receiptPayments
      .map((p) => {
        const amount = Number(p?.amount || 0);
        if (amount <= 0) return null;
        const meta = deriveLineMeta(p);
        return {
          feeType: meta.feeType,
          description: meta.description,
          billingMonth: meta.billingMonth,
          paymentDate: fmtDate(p.paymentDate),
          paymentMode: p.paymentMode || '—',
          reference: parseRef(p.notes),
          amount,
        };
      })
      .filter(Boolean);

    // Build fee-breakdown rows — one row per payment line
    const tableRows = receiptLines.map((line) => `
      <tr>
        <td>${escHtml(line.feeType)}</td>
        <td>${escHtml(line.description)}</td>
        <td>${escHtml(line.billingMonth)}</td>
        <td>${escHtml(line.paymentDate)}</td>
        <td>${escHtml(line.paymentMode)}</td>
        <td>${escHtml(line.reference)}</td>
        <td class="amount">${fmt(line.amount)}</td>
      </tr>`).join('');

    const receiptBillMap = new Map();
    for (const p of receiptPayments) {
      const billDoc = getPaymentBill(p);
      const billId = billDoc?._id || p?.billId;
      const key = billId ? String(billId) : '';
      if (!key || receiptBillMap.has(key)) continue;
      if (billDoc) {
        receiptBillMap.set(key, billDoc);
      }
    }
    if (bill?._id && !receiptBillMap.has(String(bill._id))) {
      receiptBillMap.set(String(bill._id), bill);
    }
    const receiptBills = Array.from(receiptBillMap.values());

    const paidFeeTypes = Array.from(
      new Set(
        receiptLines
          .map((line) => normalizeBillType(line?.feeType || ''))
          .filter(Boolean)
      )
    );
    const billTypeLabel =
      paidFeeTypes.length === 0
        ? normalizeBillType(bill?.billType) || 'N/A'
        : paidFeeTypes.length === 1
        ? paidFeeTypes[0]
        : `MULTIPLE FEES (${paidFeeTypes.length})`;

    const aggregatedBillTotal = receiptBills.reduce(
      (sum, b) => sum + (Number(b?.totalAmount) || 0),
      0
    );
    const aggregatedPaidSoFar = receiptBills.reduce(
      (sum, b) => sum + (Number(b?.paidAmount) || 0),
      0
    );
    const aggregatedBalanceDue = receiptBills.reduce(
      (sum, b) => sum + (Number(b?.dueAmount) || 0),
      0
    );

    const totalPaid    = receiptPayments.reduce((s, p) => s + (p.amount || 0), 0);
    const receiptNums  = receiptPayments.map((p) => p.receiptNumber).join(', ');
    const printDate    = fmtDate(new Date());
    const alreadyPaid = Math.max(aggregatedPaidSoFar - totalPaid, 0);
    const discountTotal = receiptLines.reduce((sum, line) => {
      const hay = `${line.feeType} ${line.description}`.toLowerCase();
      return hay.includes('discount') ? sum + line.amount : sum;
    }, 0);
    const lateFineTotal = receiptLines.reduce((sum, line) => {
      const hay = `${line.feeType} ${line.description}`.toLowerCase();
      return hay.includes('late fine') || hay.includes('late fee')
        ? sum + line.amount
        : sum;
    }, 0);

    console.info(
      '[ReceiptDebug] Transaction=%s payments=%d bills=%d billTypes=%s',
      primaryPayment.transactionGroupId || 'N/A',
      receiptPayments.length,
      receiptBills.length,
      receiptLines.map((line) => line.feeType).join(', ') || 'NONE'
    );

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Fee Receipt — ${receiptNums}</title>
<style>
  /* ── Reset & Base ───────────────────────── */
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Segoe UI', Arial, sans-serif;
    background: #eef2f7;
    min-height: 100vh;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 32px 16px;
  }

  /* ── Card ───────────────────────────────── */
  .receipt {
    background: #fff;
    width: 100%;
    max-width: 740px;
    border-radius: 10px;
    box-shadow: 0 4px 24px rgba(0,0,0,.12);
    overflow: hidden;
    border: 1px solid #d4dde8;
  }

  /* ── Header Band ────────────────────────── */
  .header {
    background: linear-gradient(135deg, #1a3c5e 0%, #2d6a9f 100%);
    color: #fff;
    padding: 28px 32px 24px;
    text-align: center;
    position: relative;
  }
  .header .school-name {
    font-size: 24px;
    font-weight: 700;
    letter-spacing: .5px;
    margin-bottom: 4px;
  }
  .header .school-meta {
    font-size: 12px;
    opacity: .85;
    line-height: 1.6;
  }
  .header .receipt-badge {
    display: inline-block;
    margin-top: 14px;
    background: rgba(255,255,255,.18);
    border: 1px solid rgba(255,255,255,.35);
    border-radius: 20px;
    padding: 4px 18px;
    font-size: 11px;
    letter-spacing: 2px;
    text-transform: uppercase;
    font-weight: 600;
  }

  /* ── Status Bar ─────────────────────────── */
  .status-bar {
    background: ${bill.status === 'PAID' ? '#e8f5e9' : bill.status === 'PARTIAL' ? '#fff8e1' : '#fce4ec'};
    border-bottom: 3px solid ${bill.status === 'PAID' ? '#43a047' : bill.status === 'PARTIAL' ? '#ffa000' : '#e53935'};
    padding: 10px 32px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 13px;
  }
  .status-bar .status-label {
    font-weight: 700;
    color: ${bill.status === 'PAID' ? '#2e7d32' : bill.status === 'PARTIAL' ? '#e65100' : '#c62828'};
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .status-bar .status-label::before {
    content: '${bill.status === 'PAID' ? '✔' : bill.status === 'PARTIAL' ? '◑' : '●'}';
    font-size: 16px;
  }
  .status-bar .receipt-no {
    color: #555;
    font-size: 12px;
  }
  .status-bar .receipt-no strong { color: #222; }

  /* ── Body ───────────────────────────────── */
  .body { padding: 24px 32px; }

  /* ── Info Grid ──────────────────────────── */
  .info-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0;
    border: 1px solid #dde3ea;
    border-radius: 8px;
    overflow: hidden;
    margin-bottom: 24px;
  }
  .info-section {
    padding: 16px 20px;
  }
  .info-section:first-child {
    border-right: 1px solid #dde3ea;
  }
  .info-section h3 {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 1.2px;
    color: #2d6a9f;
    font-weight: 700;
    margin-bottom: 10px;
    padding-bottom: 6px;
    border-bottom: 1px solid #e8edf3;
  }
  .info-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding: 4px 0;
    font-size: 13px;
    border-bottom: 1px dashed #f0f0f0;
  }
  .info-row:last-child { border-bottom: none; }
  .info-row .lbl { color: #777; flex-shrink: 0; margin-right: 12px; }
  .info-row .val { color: #1a1a2e; font-weight: 600; text-align: right; }

  /* ── Table ──────────────────────────────── */
  .table-wrap {
    border: 1px solid #dde3ea;
    border-radius: 8px;
    overflow: hidden;
    margin-bottom: 24px;
  }
  .table-title {
    background: #f0f4f9;
    padding: 10px 16px;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 1.2px;
    color: #2d6a9f;
    font-weight: 700;
    border-bottom: 1px solid #dde3ea;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }
  thead tr { background: #1a3c5e; color: #fff; }
  thead th {
    padding: 10px 14px;
    text-align: left;
    font-weight: 600;
    font-size: 11px;
    letter-spacing: .4px;
  }
  thead th.amount { text-align: right; }
  tbody tr:nth-child(even) { background: #f9fbff; }
  tbody tr:hover { background: #eef4ff; }
  tbody td {
    padding: 10px 14px;
    color: #333;
    border-bottom: 1px solid #eee;
    vertical-align: middle;
  }
  tbody td.amount {
    text-align: right;
    font-weight: 600;
    color: #1a3c5e;
    font-family: 'Courier New', monospace;
  }
  tbody tr:last-child td { border-bottom: none; }

  /* ── Summary ────────────────────────────── */
  .summary-wrap {
    display: flex;
    justify-content: flex-end;
    margin-bottom: 24px;
  }
  .summary-box {
    min-width: 240px;
    border: 1px solid #dde3ea;
    border-radius: 8px;
    overflow: hidden;
  }
  .summary-row {
    display: flex;
    justify-content: space-between;
    padding: 9px 16px;
    font-size: 13px;
    border-bottom: 1px solid #eee;
  }
  .summary-row:last-child { border-bottom: none; }
  .summary-row .s-lbl { color: #666; }
  .summary-row .s-val { font-weight: 600; color: #222; font-family: 'Courier New', monospace; }
  .summary-row.total-row {
    background: #1a3c5e;
    color: #fff;
  }
  .summary-row.total-row .s-lbl,
  .summary-row.total-row .s-val { color: #fff; font-size: 14px; }

  /* ── Footer ─────────────────────────────── */
  .footer {
    border-top: 1px solid #dde3ea;
    padding: 20px 32px;
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 20px;
  }
  .footer-note {
    font-size: 10.5px;
    color: #888;
    line-height: 1.7;
    max-width: 340px;
  }
  .signature-block { text-align: center; min-width: 160px; }
  .signature-line {
    border-top: 1.5px solid #333;
    width: 160px;
    margin-bottom: 5px;
  }
  .signature-label { font-size: 11px; color: #555; }

  /* ── Print ──────────────────────────────── */
  @page {
    size: A4 portrait;
    margin: 10mm;
  }

  @media print {
    html, body {
      width: 100%;
      height: 100%;
      min-height: 0;
      overflow: visible;
      background: #fff;
      margin: 0;
      padding: 0;
      display: block;
      font-size: 11px;
      line-height: 1.25;
    }

    .receipt {
      box-shadow: none;
      border: none;
      max-width: 100%;
      width: 100%;
      margin: 0;
      min-height: calc(297mm - 20mm);
      display: flex;
      flex-direction: column;
      page-break-inside: avoid;
      break-inside: avoid;
      overflow: visible;
      border-radius: 0;
    }

    .header,
    .status-bar,
    .body,
    .info-grid,
    .info-section,
    .table-wrap,
    .summary-wrap,
    .summary-box,
    .footer,
    .signature-block {
      page-break-inside: avoid;
      break-inside: avoid;
    }

    table,
    thead,
    tbody,
    tr,
    td,
    th {
      page-break-inside: avoid;
      break-inside: avoid;
    }

    thead { display: table-header-group; }
    tfoot { display: table-footer-group; }

    /* Print-only compact layout to keep one A4 page when content is moderate. */
    .header {
      padding: 10px 12px 8px;
    }
    .header .school-name {
      font-size: 16px;
      margin-bottom: 2px;
      letter-spacing: .2px;
    }
    .header .school-meta {
      font-size: 10px;
      line-height: 1.25;
    }
    .header .receipt-badge {
      margin-top: 6px;
      padding: 2px 10px;
      font-size: 9px;
      letter-spacing: 1px;
    }

    .status-bar {
      padding: 5px 12px;
      font-size: 10px;
      border-bottom-width: 2px;
    }
    .status-bar .status-label {
      gap: 4px;
      font-size: 10px;
    }
    .status-bar .status-label::before {
      font-size: 12px;
    }
    .status-bar .receipt-no {
      font-size: 10px;
    }

    .body { padding: 8px 10px; }
    .body {
      display: flex;
      flex-direction: column;
      flex: 1 1 auto;
    }

    .info-grid {
      margin-bottom: 8px;
      border-radius: 6px;
    }
    .info-section { padding: 7px 9px; }
    .info-section h3 {
      font-size: 9px;
      margin-bottom: 5px;
      padding-bottom: 3px;
      letter-spacing: .8px;
    }
    .info-row {
      padding: 2px 0;
      font-size: 10px;
    }
    .info-row .lbl { margin-right: 8px; }

    .table-title {
      padding: 6px 10px;
      font-size: 9px;
      letter-spacing: .8px;
    }
    table {
      font-size: 10px;
    }
    thead th {
      padding: 5px 7px;
      font-size: 10px;
      letter-spacing: .2px;
    }
    tbody td {
      padding: 4px 7px;
      font-size: 10px;
      line-height: 1.2;
    }

    .table-wrap,
    .summary-wrap { margin-bottom: 8px; }

    .summary-box {
      min-width: 220px;
    }
    .summary-row {
      padding: 5px 10px;
      font-size: 10px;
    }
    .summary-row.total-row .s-lbl,
    .summary-row.total-row .s-val {
      font-size: 11px;
    }

    .footer {
      padding: 8px 10px 6px;
      gap: 10px;
      align-items: flex-end;
      flex-wrap: nowrap;
      margin-top: auto;
      padding-bottom: 6mm;
    }
    .footer-note {
      font-size: 9px;
      line-height: 1.35;
      max-width: none;
      flex: 1;
    }
    .signature-block {
      min-width: 120px;
    }
    .signature-line {
      width: 120px;
      margin-bottom: 3px;
    }
    .signature-label {
      font-size: 9px;
    }

    *, *::before, *::after {
      box-sizing: border-box;
    }

    .receipt,
    .body,
    .table-wrap,
    .summary-wrap,
    .footer {
      max-width: 100%;
      overflow-wrap: anywhere;
    }

    .print-btn,
    script,
    noscript {
      display: none !important;
      visibility: hidden !important;
    }

    /* Avoid accidental trailing blank page in Chromium print engine. */
    body > *:last-child { margin-bottom: 0 !important; }
  }

  /* ── Print Button ───────────────────────── */
  .print-btn {
    display: block;
    margin: 20px auto 0;
    padding: 10px 36px;
    background: #1a3c5e;
    color: #fff;
    border: none;
    border-radius: 6px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    letter-spacing: .4px;
    transition: background .2s;
  }
  .print-btn:hover { background: #2d6a9f; }
</style>
</head>
<body>
<div class="receipt">

  <!-- Header -->
  <div class="header">
    <div class="school-name">${escHtml(school?.name || 'School ERP')}</div>
    <div class="school-meta">
      ${school?.address ? escHtml(school.address) + '<br>' : ''}
      ${[school?.contact?.phone, school?.contact?.email].filter(Boolean).map(escHtml).join(' &nbsp;|&nbsp; ')}
    </div>
    <div class="receipt-badge">Fee Receipt</div>
  </div>

  <!-- Status Bar -->
  <div class="status-bar">
    <span class="status-label">${bill.status}</span>
    <span class="receipt-no">Receipt(s): <strong>${escHtml(receiptNums)}</strong></span>
  </div>

  <div class="body">

    <!-- Info Grid -->
    <div class="info-grid">

      <!-- Student Info -->
      <div class="info-section">
        <h3>Student Information</h3>
        <div class="info-row">
          <span class="lbl">Name</span>
          <span class="val">${escHtml(student.name || '—')}</span>
        </div>
        <div class="info-row">
          <span class="lbl">Class / Section</span>
          <span class="val">${escHtml(className)} — ${escHtml(sectionName)}</span>
        </div>
        <div class="info-row">
          <span class="lbl">Roll No.</span>
          <span class="val">${escHtml(String(student.rollNumber || '—'))}</span>
        </div>
        <div class="info-row">
          <span class="lbl">Adm. No.</span>
          <span class="val">${escHtml(student.admissionNumber || '—')}</span>
        </div>
      </div>

      <!-- Payment Info -->
      <div class="info-section">
        <h3>Payment Information</h3>
        <div class="info-row">
          <span class="lbl">Bill No.</span>
          <span class="val">${escHtml(bill.billNumber)}</span>
        </div>
        <div class="info-row">
          <span class="lbl">Bill Type</span>
          <span class="val">${escHtml(billTypeLabel)}</span>
        </div>
        <div class="info-row">
          <span class="lbl">Payment Mode</span>
          <span class="val">${escHtml(primaryPayment.paymentMode)}</span>
        </div>
        <div class="info-row">
          <span class="lbl">Date</span>
          <span class="val">${fmtDate(primaryPayment.paymentDate)}</span>
        </div>
        ${primaryPayment.collectedBy?.name ? `
        <div class="info-row">
          <span class="lbl">Collected By</span>
          <span class="val">${escHtml(primaryPayment.collectedBy.name)}</span>
        </div>` : ''}
      </div>
    </div>

    <!-- Fee Breakdown Table -->
    <div class="table-wrap">
      <div class="table-title">Fee Breakdown</div>
      <table>
        <thead>
          <tr>
            <th>Fee Type</th>
            <th>Description</th>
            <th>Billing Month</th>
            <th>Date</th>
            <th>Mode</th>
            <th>Reference</th>
            <th class="amount">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows}
        </tbody>
      </table>
    </div>

    <!-- Summary -->
    <div class="summary-wrap">
      <div class="summary-box">
        <div class="summary-row">
          <span class="s-lbl">Bill Total</span>
          <span class="s-val">${fmt(aggregatedBillTotal)}</span>
        </div>
        <div class="summary-row">
          <span class="s-lbl">Already Paid</span>
          <span class="s-val">${fmt(alreadyPaid)}</span>
        </div>
        <div class="summary-row">
          <span class="s-lbl">Current Receipt Amount</span>
          <span class="s-val">${fmt(totalPaid)}</span>
        </div>
        <div class="summary-row">
          <span class="s-lbl">Discount</span>
          <span class="s-val">${fmt(discountTotal)}</span>
        </div>
        <div class="summary-row">
          <span class="s-lbl">Late Fine</span>
          <span class="s-val">${fmt(lateFineTotal)}</span>
        </div>
        <div class="summary-row">
          <span class="s-lbl">Paid So Far</span>
          <span class="s-val">${fmt(aggregatedPaidSoFar)}</span>
        </div>
        <div class="summary-row">
          <span class="s-lbl">Balance Due</span>
          <span class="s-val">${fmt(aggregatedBalanceDue)}</span>
        </div>
        <div class="summary-row total-row">
          <span class="s-lbl">This Receipt</span>
          <span class="s-val">${fmt(totalPaid)}</span>
        </div>
        <div class="summary-row total-row">
          <span class="s-lbl">Grand Total Received</span>
          <span class="s-val">${fmt(aggregatedPaidSoFar)}</span>
        </div>
      </div>
    </div>

  </div><!-- /body -->

  <!-- Footer -->
  <div class="footer">
    <div class="footer-note">
      This is a computer generated receipt and does not require a physical signature.<br>
      Printed on: ${printDate}<br>
      For queries contact: ${escHtml(school?.contact?.email || school?.contact?.phone || school?.name || 'school office')}
    </div>
    <div class="signature-block">
      <div class="signature-line"></div>
      <div class="signature-label">Authorised Signatory</div>
    </div>
  </div>

</div><!-- /receipt -->

<button class="print-btn" onclick="window.print()">&#128424; Print Receipt</button>

<script>
  // Auto-print when opened directly (e.g., from Flutter web via window.open)
  // Remove or adjust this if you want manual trigger only.
  // window.addEventListener('load', () => setTimeout(() => window.print(), 400));
</script>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    console.error('[HTML RECEIPT ERROR]', err.message);
    res.status(500).json({ success: false, message: 'Error generating receipt' });
  }
};

// Sanitise user data before embedding in HTML
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
