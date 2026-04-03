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

// ── HTML Receipt ──────────────────────────────────────────────────────────────
// GET /api/bills/:id/receipt
// Returns a print-ready HTML receipt for a bill, combining all its payments.
exports.getBillHtmlReceipt = async (req, res) => {
  try {
    const { id } = req.params;
    const { schoolId } = req.user;

    const School = require('../models/School');

    const [bill, school] = await Promise.all([
      Bill.findOne({ _id: id, schoolId })
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

    // All payments for this bill, newest first
    const payments = await Payment.find({ billId: bill._id })
      .populate('collectedBy', 'name')
      .sort({ paymentDate: -1 })
      .lean();

    if (payments.length === 0) {
      return res.status(404).json({ success: false, message: 'No payments found for this bill' });
    }

    const student     = bill.studentId || {};
    const className   = student.classId?.name   || '—';
    const sectionName = student.sectionId?.name || '—';

    const fmt = (n) =>
      '₹' + (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });

    const fmtDate = (d) =>
      new Date(d).toLocaleDateString('en-IN', {
        day: '2-digit', month: 'long', year: 'numeric',
      });

    // Parse ref number from notes field ("Ref: XXXX | ...")
    const parseRef = (notes = '') => {
      const m = notes.match(/Ref:\s*([^|]+)/);
      return m ? m[1].trim() : '—';
    };

    const primaryPayment = payments[0];

    // Build fee-breakdown rows — one row per payment line
    const tableRows = payments.map((p) => `
      <tr>
        <td>${bill.billType}</td>
        <td>${bill.description}</td>
        <td>${fmtDate(p.paymentDate)}</td>
        <td>${p.paymentMode}</td>
        <td>${parseRef(p.notes)}</td>
        <td class="amount">${fmt(p.amount)}</td>
      </tr>`).join('');

    const totalPaid    = payments.reduce((s, p) => s + (p.amount || 0), 0);
    const receiptNums  = payments.map((p) => p.receiptNumber).join(', ');
    const printDate    = fmtDate(new Date());

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
  @media print {
    body { background: #fff; padding: 0; }
    .receipt {
      box-shadow: none;
      border: none;
      max-width: 100%;
    }
    .print-btn { display: none !important; }
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
          <span class="val">${escHtml(bill.billType)}</span>
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
          <span class="s-val">${fmt(bill.totalAmount)}</span>
        </div>
        <div class="summary-row">
          <span class="s-lbl">Paid So Far</span>
          <span class="s-val">${fmt(bill.paidAmount)}</span>
        </div>
        <div class="summary-row">
          <span class="s-lbl">Balance Due</span>
          <span class="s-val">${fmt(bill.dueAmount)}</span>
        </div>
        <div class="summary-row total-row">
          <span class="s-lbl">This Receipt</span>
          <span class="s-val">${fmt(totalPaid)}</span>
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
