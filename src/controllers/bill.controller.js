const Bill = require('../models/Bill');
const Payment = require('../models/Payment');
const LedgerEntry = require('../models/LedgerEntry');
const Student = require('../models/Student');
const AcademicSession = require('../models/AcademicSession');

// Generate bill number
const generateBillNumber = (schoolId) => {
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 1000)
    .toString().padStart(3, '0');
  return `BILL-${schoolId.toString().slice(-4)}-${timestamp}-${random}`;
};

// Generate receipt number
const generateReceiptNumber = (schoolId) => {
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 1000)
    .toString().padStart(3, '0');
  return `RCP-${schoolId.toString().slice(-4)}-${timestamp}-${random}`;
};

// GET /api/bills/student/:studentId
// Get all bills for a student
exports.getStudentBills = async (req, res) => {
  try {
    const { studentId } = req.params;
    const { schoolId } = req.user;
    const { status, billType } = req.query;

    const filter = { studentId, schoolId };
    if (status) filter.status = status;
    if (billType) filter.billType = billType;

    const bills = await Bill.find(filter)
      .populate('studentId', 'name rollNumber')
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

    const filter = { schoolId };
    if (status) filter.status = status;
    if (billType) filter.billType = billType;
    if (studentId) filter.studentId = studentId;

    const skip = (page - 1) * limit;
    const [bills, total] = await Promise.all([
      Bill.find(filter)
        .populate('studentId', 'name rollNumber')
        .populate('sessionId', 'name')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      Bill.countDocuments(filter)
    ]);

    res.json({
      success: true,
      data: bills,
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
    const { schoolId, _id: createdBy } = req.user;
    const {
      studentId, billType, description,
      totalAmount, dueDate, sourceType, sourceId
    } = req.body;

    // Validate student
    const student = await Student.findOne({ _id: studentId, schoolId });
    if (!student) {
      return res.status(400).json({ message: 'Student not found' });
    }

    // Get active session
    const session = await AcademicSession.findOne({
      schoolId, isActive: true
    });
    if (!session) {
      return res.status(400).json({
        message: 'No active session found'
      });
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
      sessionId: session._id,
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
    const { schoolId, _id: collectedBy } = req.user;
    const { amount, paymentMode, notes } = req.body;

    const bill = await Bill.findOne({ _id: billId, schoolId });
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

    // Get active session
    const session = await AcademicSession.findOne({
      schoolId, isActive: true
    });

    // Generate receipt number
    let receiptNumber;
    let attempts = 0;
    do {
      receiptNumber = generateReceiptNumber(schoolId);
      attempts++;
      if (attempts > 10) throw new Error('Could not generate receipt');
    } while (await Payment.findOne({ receiptNumber }));

    // Create payment
    const payment = await Payment.create({
      receiptNumber,
      billId: bill._id,
      studentId: bill.studentId,
      schoolId,
      sessionId: session ? session._id : bill.sessionId,
      amount,
      paymentMode,
      paymentDate: new Date(),
      collectedBy,
      notes: notes || ''
    });

    // Update bill
    bill.paidAmount += amount;
    await bill.save(); // pre-save hook updates dueAmount + status

    // Ledger dual-write — never fail the payment
    try {
      const billTypeToCategory = {
        TUITION: 'FEE_COLLECTION',
        HOSTEL: 'HOSTEL_COLLECTION',
        TRANSPORT: 'TRANSPORT_COLLECTION',
        EXAM: 'EXAM_COLLECTION'
      };
      await LedgerEntry.create({
        schoolId,
        sessionId: session ? session._id : bill.sessionId,
        entryType: 'DEBIT',
        category: billTypeToCategory[bill.billType] || 'FEE_COLLECTION',
        amount,
        description: bill.description || `Payment for ${bill.billType}`,
        referenceId: payment._id,
        sourceModel: 'Payment',
        performedBy: collectedBy,
        entryDate: new Date()
      });
    } catch (ledgerErr) {
      console.error('[LedgerEntry] bill payment dual-write failed:', ledgerErr.message);
    }

    res.status(201).json({
      success: true,
      data: {
        payment,
        bill: {
          _id: bill._id,
          billNumber: bill.billNumber,
          totalAmount: bill.totalAmount,
          paidAmount: bill.paidAmount,
          dueAmount: bill.dueAmount,
          status: bill.status
        }
      },
      receiptNumber,
      message: 'Payment recorded successfully'
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/bills/summary
// Dashboard summary for school
exports.getBillSummary = async (req, res) => {
  try {
    const { schoolId } = req.user;

    const [
      totalUnpaid,
      totalPartial,
      totalPaid,
      todayPayments
    ] = await Promise.all([
      Bill.aggregate([
        { $match: { schoolId, status: 'UNPAID' } },
        { $group: { _id: null, total: { $sum: '$dueAmount' },
          count: { $sum: 1 } } }
      ]),
      Bill.aggregate([
        { $match: { schoolId, status: 'PARTIAL' } },
        { $group: { _id: null, total: { $sum: '$dueAmount' },
          count: { $sum: 1 } } }
      ]),
      Bill.aggregate([
        { $match: { schoolId, status: 'PAID' } },
        { $group: { _id: null, total: { $sum: '$totalAmount' },
          count: { $sum: 1 } } }
      ]),
      Payment.aggregate([
        {
          $match: {
            schoolId,
            paymentDate: {
              $gte: new Date(new Date().setHours(0, 0, 0, 0)),
              $lt: new Date(new Date().setHours(23, 59, 59, 999))
            }
          }
        },
        { $group: { _id: null, total: { $sum: '$amount' },
          count: { $sum: 1 } } }
      ])
    ]);

    res.json({
      success: true,
      data: {
        unpaidDue: totalUnpaid[0]?.total || 0,
        unpaidCount: totalUnpaid[0]?.count || 0,
        partialDue: totalPartial[0]?.total || 0,
        partialCount: totalPartial[0]?.count || 0,
        paidTotal: totalPaid[0]?.total || 0,
        paidCount: totalPaid[0]?.count || 0,
        collectedToday: todayPayments[0]?.total || 0,
        paymentsToday: todayPayments[0]?.count || 0
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

    const filter = { schoolId };
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

    const matchStage = { schoolId };
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

    const payment = await Payment.findOne({ receiptNumber, schoolId })
      .populate('billId')
      .populate('collectedBy', 'name')
      .populate('studentId', 'name rollNumber')
      .lean();

    if (!payment) {
      return res.status(404).json({ message: 'Receipt not found' });
    }

    const bill = payment.billId;
    const student = payment.studentId;

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
      ['Amount Paid', `Rs. ${(payment.amount || 0).toLocaleString('en-IN')}`],
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
     ['Bill Type',     bill?.billType || 'N/A'],
     ['Description',   bill?.description || 'N/A'],
     ['Total Amount',  `Rs. ${(bill?.totalAmount || 0).toLocaleString('en-IN')}`],
     ['Amount Paid',   `Rs. ${(bill?.paidAmount || 0).toLocaleString('en-IN')}`],
     ['Balance Due',   `Rs. ${(bill?.dueAmount || 0).toLocaleString('en-IN')}`],
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
