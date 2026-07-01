const StudentFee = require('../models/StudentFee');
const Student = require('../models/Student');
const OnlinePayment = require('../models/OnlinePayment');
const Payment = require('../models/Payment');
const Parent = require('../models/Parent');
const PDFDocument = require('pdfkit');
const School = require('../models/School');
const Class = require('../models/Class');
const Section = require('../models/Section');
const FeeStructure = require('../models/FeeStructure');
const Bill = require('../models/Bill');
const AcademicSession = require('../models/AcademicSession');
const { auditLog } = require('../utils/auditLog');
const { processBillPayments, PaymentEngineError } = require('../services/paymentEngine.service');

const getSessionFilter = (req) => {
  const sessionId = req.user?.sessionId;
  return sessionId ? { $or: [{ sessionId }, { sessionId: { $exists: false } }] } : {};
};

// Manual fee payment
const payManual = async (req, res) => {
  try {
    const { role } = req.user;
    if (role !== 'PRINCIPAL' && role !== 'OPERATOR') {
      return res.status(403).json({ message: 'Access denied. Insufficient permissions.' });
    }

    const { studentFeeId, amount, mode } = req.body;
    const { schoolId, _id: collectedBy, sessionId } = req.user;

    // Validate studentFee exists and belongs to same school
    const studentFee = await StudentFee.findOne({ _id: studentFeeId, schoolId });
    if (!studentFee) {
      return res.status(400).json({ message: 'Invalid studentFeeId or does not belong to your school' });
    }

    // Check if payment amount exceeds due amount
    if (amount > studentFee.dueAmount) {
      return res.status(400).json({ message: 'Payment amount cannot exceed due amount' });
    }

    const linkedBill = await Bill.findOne({
      sourceType: 'StudentFee',
      sourceId: studentFeeId,
      schoolId,
      ...getSessionFilter(req),
    });
    if (!linkedBill) {
      return res.status(400).json({ message: 'No linked Bill found for this student fee' });
    }

    const engineResult = await processBillPayments({
      schoolId,
      actorId: collectedBy,
      reqSessionId: sessionId,
      paymentMode: mode,
      notes: `Manual fee payment for StudentFee ${studentFeeId}`,
      billItems: [{ billId: linkedBill._id, amount }],
      allOrNothing: true,
    });

    const canonicalPayment = await Payment.findById(engineResult.receipts[0].paymentId)
      .populate('collectedBy', 'name')
      .lean();

    const refreshedStudentFee = await StudentFee.findById(studentFeeId).lean();

    // Audit log
    await auditLog({
      action: 'FEE_PAYMENT_MANUAL',
      userId: req.user._id,
      role: req.user.role,
      entityType: 'Payment',
      entityId: canonicalPayment?._id,
      description: `Manual fee payment of ₹${amount} recorded for student fee ${studentFeeId}`,
      schoolId: req.user.schoolId,
      sessionId: req.user.sessionId,
      req
    });

    res.status(201).json({
      message: 'Payment recorded successfully',
      payment: canonicalPayment,
      updatedStudentFee: {
        paidAmount: Number(refreshedStudentFee?.paidAmount || 0),
        dueAmount: Number(refreshedStudentFee?.dueAmount || 0),
        status: refreshedStudentFee?.status || 'Due'
      }
    });
  } catch (err) {
    if (err instanceof PaymentEngineError) {
      return res.status(err.statusCode || 400).json({ message: err.message });
    }
    res.status(500).json({ message: err.message });
  }
};

// Get payments for a student
const getPaymentsByStudent = async (req, res) => {
  try {
    const { role } = req.user;
    if (role !== 'PRINCIPAL' && role !== 'OPERATOR') {
      return res.status(403).json({ message: 'Access denied. Insufficient permissions.' });
    }

    const { id: studentId } = req.params;
    const { schoolId } = req.user;

    // Validate student belongs to same school
    const student = await Student.findOne({ _id: studentId, schoolId });
    if (!student) {
      return res.status(400).json({ message: 'Invalid studentId' });
    }

    const bills = await Bill.find({
      studentId,
      schoolId,
      sourceType: 'StudentFee',
      ...getSessionFilter(req),
    }).select('_id sourceId totalAmount dueAmount status');

    const billMap = new Map(bills.map((b) => [String(b._id), b]));
    const payments = await Payment.find({
      billId: { $in: bills.map((b) => b._id) },
      schoolId,
      ...getSessionFilter(req),
    })
      .populate('collectedBy', 'name')
      .sort({ createdAt: -1 });

    const normalized = payments.map((p) => {
      const bill = billMap.get(String(p.billId));
      return {
        ...p.toObject(),
        studentFeeId: bill?.sourceId || null,
        mode: p.paymentMode,
        date: p.paymentDate,
        receiptNo: p.receiptNumber,
        linkedBill: bill || null,
      };
    });

    res.json(normalized);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Initiate online payment
const initiateOnlinePayment = async (req, res) => {
  try {
    const { studentFeeId, amount } = req.body;
    const { schoolId, _id: userId, role, sessionId } = req.user;

    // Validate user is a parent
    if (role !== 'PARENT') {
      return res.status(403).json({ message: 'Only parents can initiate online payments' });
    }

    // Get parent details to find associated student
    const parent = await Parent.findOne({ userId, schoolId });
    if (!parent) {
      return res.status(400).json({ message: 'Parent profile not found' });
    }

    // Validate studentFee exists and belongs to parent's child
    const studentFee = await StudentFee.findOne({
      _id: studentFeeId,
      studentId: { $in: parent.children },
      schoolId
    });
    if (!studentFee) {
      return res.status(400).json({ message: 'Invalid studentFeeId or does not belong to your child' });
    }

    // Check if payment amount exceeds due amount
    if (amount > studentFee.dueAmount) {
      return res.status(400).json({ message: 'Payment amount cannot exceed due amount' });
    }

    // Generate unique gateway reference
    const gatewayRef = `PAY-${schoolId}-${Date.now()}-${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;

    // Create online payment record (Pending status)
    const onlinePayment = await OnlinePayment.create({
      studentFeeId,
      amount,
      gatewayRef,
      status: 'Pending',
      schoolId,
      sessionId
    });

    res.status(201).json({
      message: 'Online payment initiated successfully',
      payment: {
        _id: onlinePayment._id,
        gatewayRef,
        amount,
        status: 'Pending'
      }
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: 'Gateway reference already exists. Please try again.' });
    }
    res.status(500).json({ message: err.message });
  }
};

// Verify online payment
const verifyOnlinePayment = async (req, res) => {
  try {
    const { role } = req.user;
    if (role !== 'PRINCIPAL' && role !== 'OPERATOR') {
      return res.status(403).json({ message: 'Access denied. Insufficient permissions.' });
    }

    const { gatewayRef, status } = req.body;
    const { schoolId, sessionId } = req.user;

    // Validate status
    if (!['Success', 'Failed'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status. Must be Success or Failed.' });
    }

    // Find the online payment
    const onlinePayment = await OnlinePayment.findOne({ gatewayRef, schoolId, ...getSessionFilter(req) });
    if (!onlinePayment) {
      return res.status(404).json({ message: 'Online payment not found' });
    }

    // Check if already processed
    if (onlinePayment.status !== 'Pending') {
      return res.status(400).json({ message: 'Payment already processed' });
    }

    // Update payment status
    onlinePayment.status = status;
    await onlinePayment.save();

      let feePayment = null;
    let updatedStudentFee = null;

    if (status === 'Success') {
      const linkedBill = await Bill.findOne({
        sourceType: 'StudentFee',
        sourceId: onlinePayment.studentFeeId,
        schoolId,
        ...getSessionFilter(req),
      });
      if (!linkedBill) {
        return res.status(400).json({ message: 'No linked Bill found for this online payment' });
      }

      const engineResult = await processBillPayments({
        schoolId,
        actorId: req.user._id,
        reqSessionId: sessionId,
        paymentMode: 'Online',
        notes: `Online payment ${gatewayRef}`,
        billItems: [{ billId: linkedBill._id, amount: onlinePayment.amount }],
        allOrNothing: true,
      });

      onlinePayment.receiptNo = engineResult.receipts[0].receiptNumber;
      await onlinePayment.save();

      feePayment = await Payment.findById(engineResult.receipts[0].paymentId)
        .populate('collectedBy', 'name')
        .lean();

      const studentFee = await StudentFee.findById(onlinePayment.studentFeeId).lean();

      updatedStudentFee = {
        paidAmount: Number(studentFee?.paidAmount || 0),
        dueAmount: Number(studentFee?.dueAmount || 0),
        status: studentFee?.status || 'Due'
      };
    }

    // Audit log
    await auditLog({
      action: status === 'Success' ? 'FEE_PAYMENT_ONLINE_SUCCESS' : 'FEE_PAYMENT_ONLINE_FAILED',
      userId: req.user._id,
      role: req.user.role,
      entityType: 'Payment',
      entityId: onlinePayment._id,
      description: `Online payment ${status.toLowerCase()} for ₹${onlinePayment.amount}`,
      schoolId: req.user.schoolId,
      sessionId: req.user.sessionId,
      req
    });

    res.json({
      message: `Payment ${status.toLowerCase()} processed successfully`,
      onlinePayment,
      feePayment,
      updatedStudentFee
    });
  } catch (err) {
    if (err instanceof PaymentEngineError) {
      return res.status(err.statusCode || 400).json({ message: err.message });
    }
    res.status(500).json({ message: err.message });
  }
};

// Get payments for logged-in parent's child
const getMyPayments = async (req, res) => {
  try {
    const { role } = req.user;
    if (role !== 'PARENT') {
      return res.status(403).json({ message: 'Access denied. Insufficient permissions.' });
    }

    const { schoolId, _id: userId } = req.user;

    // Get parent details to find associated student
    const parent = await Parent.findOne({ userId, schoolId });
    if (!parent) {
      return res.status(400).json({ message: 'Parent profile not found' });
    }

    const bills = await Bill.find({
      studentId: { $in: parent.children },
      schoolId,
      sourceType: 'StudentFee',
      ...getSessionFilter(req),
    }).select('_id sourceId totalAmount dueAmount status');

    const billMap = new Map(bills.map((b) => [String(b._id), b]));
    const payments = await Payment.find({
      billId: { $in: bills.map((b) => b._id) },
      schoolId,
      ...getSessionFilter(req),
    })
      .sort({ createdAt: -1 });

    const normalized = payments.map((p) => {
      const bill = billMap.get(String(p.billId));
      return {
        ...p.toObject(),
        studentFeeId: bill?.sourceId || null,
        mode: p.paymentMode,
        date: p.paymentDate,
        receiptNo: p.receiptNumber,
        linkedBill: bill || null,
      };
    });

    res.json(normalized);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Generate PDF receipt
const getReceipt = async (req, res) => {
  try {
    const { receiptNo } = req.params;
    const { schoolId, role, _id: userId } = req.user;

    // Find the canonical payment by receipt number
    const payment = await Payment.findOne({ receiptNumber: receiptNo, schoolId, ...getSessionFilter(req) })
      .populate('billId')
      .populate('collectedBy', 'name');
    if (!payment) {
      return res.status(404).json({ message: 'Receipt not found' });
    }

    const linkedBill = payment.billId;
    if (!linkedBill) {
      return res.status(400).json({ message: 'Linked bill not found for receipt' });
    }

    // Access control based on role
    if (role === 'STUDENT') {
      // Student can only view their own receipts
      const student = await Student.findOne({ userId, schoolId });
      if (!student || student._id.toString() !== linkedBill.studentId.toString()) {
        return res.status(403).json({ message: 'Access denied. You can only view your own receipts.' });
      }
    } else if (role === 'PARENT') {
      // Parent can only view their child's receipts
      const parent = await Parent.findOne({ userId, schoolId });
      if (!parent || !parent.children.some(id => id.toString() === linkedBill.studentId.toString())) {
        return res.status(403).json({ message: 'Access denied. You can only view your child\'s receipts.' });
      }
    }
    // Principal/Operator can view all receipts (no additional check needed)

    // Get additional data for receipt
    const student = await Student.findById(linkedBill.studentId)
      .populate('classId', 'name')
      .populate('sectionId', 'name');
    const school = await School.findById(schoolId);
    let studentFee = null;
    let feeStructure = null;
    if (linkedBill.sourceType === 'StudentFee' && linkedBill.sourceId) {
      studentFee = await StudentFee.findById(linkedBill.sourceId).lean();
      if (studentFee?.feeStructureId) {
        feeStructure = await FeeStructure.findById(studentFee.feeStructureId).lean();
      }
    }

    // Create PDF document
    const doc = new PDFDocument({
      size: 'A4',
      margin: 50
    });

    // Set response headers for PDF download
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=receipt-${receiptNo}.pdf`);

    // Pipe PDF to response
    doc.pipe(res);

    // Header
    doc.fontSize(20).font('Helvetica-Bold').text('FEE RECEIPT', { align: 'center' });
    doc.moveDown();

    // School Information
    doc.fontSize(14).font('Helvetica-Bold').text(school.name, { align: 'center' });
    doc.fontSize(10).font('Helvetica').text(school.address || '', { align: 'center' });
    doc.text(`Phone: ${school.phone || ''} | Email: ${school.email || ''}`, { align: 'center' });
    doc.moveDown();

    // Receipt Details
    doc.fontSize(12).font('Helvetica-Bold').text('Receipt Details:', { underline: true });
    doc.moveDown(0.5);

    const receiptData = [
      ['Receipt Number:', receiptNo],
      ['Date:', new Date(payment.paymentDate).toLocaleDateString()],
      ['Payment Mode:', payment.paymentMode],
      ['Amount Paid:', `₹${payment.amount}`],
    ];

    receiptData.forEach(([label, value]) => {
      doc.fontSize(10).font('Helvetica-Bold').text(label, { continued: true });
      doc.font('Helvetica').text(value);
    });

    doc.moveDown();

    // Student Information
    doc.fontSize(12).font('Helvetica-Bold').text('Student Information:', { underline: true });
    doc.moveDown(0.5);

    const studentData = [
      ['Student Name:', student.name],
      ['Class:', `${student.classId?.name || ''} - ${student.sectionId?.name || ''}`],
      ['Admission Number:', student.admissionNumber || ''],
    ];

    studentData.forEach(([label, value]) => {
      doc.fontSize(10).font('Helvetica-Bold').text(label, { continued: true });
      doc.font('Helvetica').text(value);
    });

    doc.moveDown();

    // Fee Information
    doc.fontSize(12).font('Helvetica-Bold').text('Fee Information:', { underline: true });
    doc.moveDown(0.5);

    const feeData = [
      ['Fee Head:', feeStructure?.name || 'N/A'],
      ['Total Amount:', `₹${linkedBill.totalAmount || 0}`],
      ['Amount Paid:', `₹${payment.amount}`],
      ['Balance Due:', `₹${linkedBill.dueAmount || 0}`],
    ];

    feeData.forEach(([label, value]) => {
      doc.fontSize(10).font('Helvetica-Bold').text(label, { continued: true });
      doc.font('Helvetica').text(value);
    });

    doc.moveDown(2);

    // Footer
    doc.fontSize(10).font('Helvetica').text('This is a computer generated receipt.', { align: 'center' });
    doc.text('Thank you for your payment!', { align: 'center' });

    // Collected by (if applicable)
    if (payment.collectedBy) {
      doc.moveDown();
      doc.fontSize(8).text(`Collected by: ${payment.collectedBy.name}`, { align: 'right' });
    }

    // Finalize PDF
    doc.end();

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ── Advance Payment ───────────────────────────────────────────────────────────
// POST /api/fees/generate-and-pay
// For each requested fee type, find-or-create a Bill for that student+month, then pay it.
// Body: { studentId, month, feeTypes, amounts, paymentMode, referenceNumber?, discount?,
//         discountType?, extraFees? }
const generateAndPay = async (req, res) => {
  try {
    const {
      studentId,
      month,
      feeTypes,
      amounts,
      paymentMode,
      referenceNumber,
      discount,
      discountType,
      extraFees,
    } = req.body;

    const { schoolId, _id: collectedBy } = req.user;

    // ── Validate required fields ──────────────────────────────────────────────
    if (!studentId)
      return res.status(400).json({ success: false, message: 'studentId is required' });
    if (!month)
      return res.status(400).json({ success: false, message: 'month is required' });
    if (!Array.isArray(feeTypes) || feeTypes.length === 0)
      return res.status(400).json({ success: false, message: 'feeTypes array is required' });
    if (!amounts || typeof amounts !== 'object')
      return res.status(400).json({ success: false, message: 'amounts map is required' });
    if (!paymentMode)
      return res.status(400).json({ success: false, message: 'paymentMode is required' });

    const VALID_MONTHS = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ];
    if (!VALID_MONTHS.includes(month))
      return res.status(400).json({ success: false, message: 'Invalid month' });

    const VALID_BILL_TYPES = [
      'TUITION', 'HOSTEL', 'TRANSPORT', 'EXAM',
      'ADMISSION', 'LIBRARY', 'SPORTS', 'MISCELLANEOUS',
    ];
    for (const ft of feeTypes) {
      if (!VALID_BILL_TYPES.includes(ft))
        return res.status(400).json({ success: false, message: `Invalid feeType: ${ft}` });
      const amt = parseFloat(amounts[ft]);
      if (!amt || amt <= 0)
        return res.status(400).json({ success: false, message: `Missing or invalid amount for ${ft}` });
    }

    // ── Fetch session + verify student belong to school ───────────────────────
    const [session, student] = await Promise.all([
      AcademicSession.findOne({ schoolId, isActive: true }),
      Student.findOne({ _id: studentId, schoolId, ...getSessionFilter(req) }),
    ]);
    if (!session)
      return res.status(400).json({ success: false, message: 'No active academic session found' });
    if (!student)
      return res.status(404).json({ success: false, message: 'Student not found' });

    const billTypeToCategory = {
      TUITION: 'FEE_COLLECTION',
      HOSTEL: 'HOSTEL_COLLECTION',
      TRANSPORT: 'TRANSPORT_COLLECTION',
      EXAM: 'EXAM_COLLECTION',
      ADMISSION: 'FEE_COLLECTION',
      LIBRARY: 'FEE_COLLECTION',
      SPORTS: 'FEE_COLLECTION',
      MISCELLANEOUS: 'FEE_COLLECTION',
    };

    // ── Helper: generate a unique bill number with retry ──────────────────────
    const newBillNumber = async () => {
      let billNumber;
      let attempts = 0;
      do {
        const ts = Date.now();
        const r = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
        billNumber = `BILL-${schoolId.toString().slice(-4)}-${ts}-${r}`;
        attempts++;
        if (attempts > 10) break;
      } while (await Bill.findOne({ billNumber }));
      return billNumber;
    };

    const monthIndex = VALID_MONTHS.indexOf(month);
    // Due date: 10th of the requested month (current calendar year)
    const dueDate = new Date(new Date().getFullYear(), monthIndex, 10);

    // ── Step 1: Find-or-create bills ──────────────────────────────────────────
    // billQueue entries: { bill, payAmount }
    const billQueue = [];

    for (const feeType of feeTypes) {
      const requestedAmount = parseFloat(amounts[feeType]);
      const description = `${month} ${feeType} Fee`;

      let bill = await Bill.findOne({ studentId, schoolId, billType: feeType, description, ...getSessionFilter(req) });

      if (!bill) {
        bill = await Bill.create({
          billNumber: await newBillNumber(),
          studentId,
          schoolId,
          sessionId: session._id,
          billType: feeType,
          sourceType: 'Manual',
          description,
          totalAmount: requestedAmount,
          paidAmount: 0,
          dueAmount: requestedAmount,
          dueDate,
          createdBy: collectedBy,
        });
      }

      if (bill.status === 'PAID') continue;

      const payAmount = Math.min(requestedAmount, bill.dueAmount);
      if (payAmount <= 0) continue;

      billQueue.push({ bill, payAmount });
    }

    // ── Step 2: Handle extraFees — create MISCELLANEOUS bills ─────────────────
    if (Array.isArray(extraFees) && extraFees.length > 0) {
      for (const extra of extraFees) {
        const extraAmount = parseFloat(extra.amount);
        if (!extra.name || !extraAmount || extraAmount <= 0) continue;

        const description = `${month} ${extra.name} (Extra)`;
        let bill = await Bill.findOne({
          studentId, schoolId, billType: 'MISCELLANEOUS', description, ...getSessionFilter(req)
        });

        if (!bill) {
          bill = await Bill.create({
            billNumber: await newBillNumber(),
            studentId,
            schoolId,
            sessionId: session._id,
            billType: 'MISCELLANEOUS',
            sourceType: 'Manual',
            description,
            totalAmount: extraAmount,
            paidAmount: 0,
            dueAmount: extraAmount,
            dueDate,
            createdBy: collectedBy,
          });
        }

        if (bill.status === 'PAID') continue;
        const payAmount = Math.min(extraAmount, bill.dueAmount);
        if (payAmount > 0) billQueue.push({ bill, payAmount });
      }
    }

    if (billQueue.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'All selected fees are already fully paid',
      });
    }

    // ── Step 3: Pay queued bills via unified payment engine ───────────────────
    const noteParts = ['Advance payment'];
    if (referenceNumber) noteParts.push(`Ref: ${referenceNumber}`);
    if (discount && parseFloat(discount) > 0) {
      noteParts.push(
        `Discount: ${discountType === 'Percent' ? `${discount}%` : `₹${discount}`}`
      );
    }
    const notesBase = noteParts.join(' | ');

    const result = await processBillPayments({
      schoolId,
      actorId: collectedBy,
      reqSessionId: session._id,
      paymentMode,
      notes: notesBase,
      billItems: billQueue.map(({ bill, payAmount }) => ({
        billId: bill._id,
        amount: payAmount,
      })),
      allOrNothing: true,
    });

    const receipts = result.receipts.map((r) => ({
      ...r,
      month,
    }));

    res.status(201).json({
      success: true,
      message: `${receipts.length} advance payment(s) recorded successfully`,
      receipts,
      billIds: receipts.map(r => r.billId.toString()),
      totalPaid: receipts.reduce((s, r) => s + r.amount, 0),
    });
  } catch (err) {
    if (err instanceof PaymentEngineError) {
      return res.status(err.statusCode || 400).json({ success: false, message: err.message });
    }
    console.error('[ADVANCE PAY ERROR]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  payManual,
  getPaymentsByStudent,
  initiateOnlinePayment,
  verifyOnlinePayment,
  getMyPayments,
  getReceipt,
  generateAndPay,
};
