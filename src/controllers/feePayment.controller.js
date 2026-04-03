const FeePayment = require('../models/FeePayment');
const StudentFee = require('../models/StudentFee');
const Student = require('../models/Student');
const OnlinePayment = require('../models/OnlinePayment');
const Parent = require('../models/Parent');
const PDFDocument = require('pdfkit');
const School = require('../models/School');
const Class = require('../models/Class');
const Section = require('../models/Section');
const FeeStructure = require('../models/FeeStructure');
const Bill = require('../models/Bill');
const Payment = require('../models/Payment');
const LedgerEntry = require('../models/LedgerEntry');
const AcademicSession = require('../models/AcademicSession');
const { auditLog } = require('../utils/auditLog');

// Generate unique receipt number
const generateReceiptNo = (schoolId) => {
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `RCP-${schoolId}-${timestamp}-${random}`;
};

// Manual fee payment
const payManual = async (req, res) => {
  try {
    const { role } = req.user;
    if (role !== 'PRINCIPAL' && role !== 'OPERATOR') {
      return res.status(403).json({ message: 'Access denied. Insufficient permissions.' });
    }

    const { studentFeeId, amount, mode } = req.body;
    const { schoolId, _id: collectedBy } = req.user;

    // Validate studentFee exists and belongs to same school
    const studentFee = await StudentFee.findOne({ _id: studentFeeId, schoolId });
    if (!studentFee) {
      return res.status(400).json({ message: 'Invalid studentFeeId or does not belong to your school' });
    }

    // Check if payment amount exceeds due amount
    if (amount > studentFee.dueAmount) {
      return res.status(400).json({ message: 'Payment amount cannot exceed due amount' });
    }

    // Generate unique receipt number
    let receiptNo;
    let attempts = 0;
    do {
      receiptNo = generateReceiptNo(schoolId);
      attempts++;
      if (attempts > 10) {
        return res.status(500).json({ message: 'Failed to generate unique receipt number' });
      }
    } while (await FeePayment.findOne({ receiptNo }));

    // Create payment record
    const payment = await FeePayment.create({
      studentFeeId,
      amount,
      mode,
      date: new Date(),
      collectedBy,
      receiptNo,
      schoolId
    });

    // Update StudentFee
    const newPaidAmount = studentFee.paidAmount + amount;
    const newDueAmount = studentFee.dueAmount - amount;
    let newStatus = 'Due';
    if (newDueAmount === 0) {
      newStatus = 'Paid';
    } else if (newPaidAmount > 0) {
      newStatus = 'Partial';
    }

    await StudentFee.findByIdAndUpdate(studentFeeId, {
      paidAmount: newPaidAmount,
      dueAmount: newDueAmount,
      status: newStatus
    });

    // Audit log
    await auditLog({
      action: 'FEE_PAYMENT_MANUAL',
      userId: req.user._id,
      role: req.user.role,
      entityType: 'FeePayment',
      entityId: payment._id,
      description: `Manual fee payment of ₹${amount} recorded for student fee ${studentFeeId}`,
      schoolId: req.user.schoolId,
      sessionId: req.user.sessionId,
      req
    });

    res.status(201).json({
      message: 'Payment recorded successfully',
      payment,
      updatedStudentFee: {
        paidAmount: newPaidAmount,
        dueAmount: newDueAmount,
        status: newStatus
      }
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: 'Receipt number already exists. Please try again.' });
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

    // Get all student fees for this student
    const studentFees = await StudentFee.find({ studentId, schoolId }).select('_id');
    const studentFeeIds = studentFees.map(fee => fee._id);

    // Get payments for these student fees
    const payments = await FeePayment.find({ studentFeeId: { $in: studentFeeIds } })
      .populate('studentFeeId', 'totalAmount paidAmount dueAmount status')
      .populate('collectedBy', 'name')
      .sort({ createdAt: -1 });

    res.json(payments);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Initiate online payment
const initiateOnlinePayment = async (req, res) => {
  try {
    const { studentFeeId, amount } = req.body;
    const { schoolId, _id: userId, role } = req.user;

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
      schoolId
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
    const { schoolId } = req.user;

    // Validate status
    if (!['Success', 'Failed'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status. Must be Success or Failed.' });
    }

    // Find the online payment
    const onlinePayment = await OnlinePayment.findOne({ gatewayRef, schoolId });
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
      // Generate receipt number
      let receiptNo;
      let attempts = 0;
      do {
        receiptNo = generateReceiptNo(schoolId);
        attempts++;
        if (attempts > 10) {
          return res.status(500).json({ message: 'Failed to generate unique receipt number' });
        }
      } while (await FeePayment.findOne({ receiptNo }));

      // Update receipt number in online payment
      onlinePayment.receiptNo = receiptNo;
      await onlinePayment.save();

      // Create FeePayment record
      feePayment = await FeePayment.create({
        studentFeeId: onlinePayment.studentFeeId,
        amount: onlinePayment.amount,
        mode: 'Online',
        date: new Date(),
        collectedBy: null, // No collector for online payments
        receiptNo,
        schoolId
      });

      // Update StudentFee
      const studentFee = await StudentFee.findById(onlinePayment.studentFeeId);
      const newPaidAmount = studentFee.paidAmount + onlinePayment.amount;
      const newDueAmount = studentFee.dueAmount - onlinePayment.amount;
      let newStatus = 'Due';
      if (newDueAmount === 0) {
        newStatus = 'Paid';
      } else if (newPaidAmount > 0) {
        newStatus = 'Partial';
      }

      await StudentFee.findByIdAndUpdate(onlinePayment.studentFeeId, {
        paidAmount: newPaidAmount,
        dueAmount: newDueAmount,
        status: newStatus
      });

      updatedStudentFee = {
        paidAmount: newPaidAmount,
        dueAmount: newDueAmount,
        status: newStatus
      };
    }

    // Audit log
    await auditLog({
      action: status === 'Success' ? 'FEE_PAYMENT_ONLINE_SUCCESS' : 'FEE_PAYMENT_ONLINE_FAILED',
      userId: req.user._id,
      role: req.user.role,
      entityType: 'OnlinePayment',
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
    if (err.code === 11000) {
      return res.status(409).json({ message: 'Receipt number already exists. Please try again.' });
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

    // Get all student fees for this student
    const studentFees = await StudentFee.find({ studentId: { $in: parent.children }, schoolId }).select('_id');
    const studentFeeIds = studentFees.map(fee => fee._id);

    // Get payments for these student fees
    const payments = await FeePayment.find({ studentFeeId: { $in: studentFeeIds } })
      .populate('studentFeeId', 'totalAmount paidAmount dueAmount status')
      .sort({ createdAt: -1 });

    res.json(payments);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Generate PDF receipt
const getReceipt = async (req, res) => {
  try {
    const { receiptNo } = req.params;
    const { schoolId, role, _id: userId } = req.user;

    // Find the payment by receipt number
    const payment = await FeePayment.findOne({ receiptNo, schoolId })
      .populate('studentFeeId')
      .populate('collectedBy', 'name');
    if (!payment) {
      return res.status(404).json({ message: 'Receipt not found' });
    }

    // Access control based on role
    if (role === 'STUDENT') {
      // Student can only view their own receipts
      const student = await Student.findOne({ userId, schoolId });
      if (!student || student._id.toString() !== payment.studentFeeId.studentId.toString()) {
        return res.status(403).json({ message: 'Access denied. You can only view your own receipts.' });
      }
    } else if (role === 'PARENT') {
      // Parent can only view their child's receipts
      const parent = await Parent.findOne({ userId, schoolId });
      if (!parent || !parent.children.some(id => id.toString() === payment.studentFeeId.studentId.toString())) {
        return res.status(403).json({ message: 'Access denied. You can only view your child\'s receipts.' });
      }
    }
    // Principal/Operator can view all receipts (no additional check needed)

    // Get additional data for receipt
    const student = await Student.findById(payment.studentFeeId.studentId)
      .populate('classId', 'name')
      .populate('sectionId', 'name');
    const school = await School.findById(schoolId);
    const feeStructure = await FeeStructure.findById(payment.studentFeeId.feeStructureId);

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
      ['Date:', new Date(payment.date).toLocaleDateString()],
      ['Payment Mode:', payment.mode],
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
      ['Total Amount:', `₹${payment.studentFeeId.totalAmount}`],
      ['Amount Paid:', `₹${payment.amount}`],
      ['Balance Due:', `₹${payment.studentFeeId.dueAmount}`],
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
      Student.findOne({ _id: studentId, schoolId }),
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

      let bill = await Bill.findOne({ studentId, schoolId, billType: feeType, description });

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
          studentId, schoolId, billType: 'MISCELLANEOUS', description,
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

    // ── Step 3: Pay each queued bill ──────────────────────────────────────────
    const noteParts = ['Advance payment'];
    if (referenceNumber) noteParts.push(`Ref: ${referenceNumber}`);
    if (discount && parseFloat(discount) > 0) {
      noteParts.push(
        `Discount: ${discountType === 'Percent' ? `${discount}%` : `₹${discount}`}`
      );
    }
    const notesBase = noteParts.join(' | ');

    const receipts = [];

    for (const { bill, payAmount } of billQueue) {
      // Generate unique receipt number
      let receiptNumber;
      let attempts = 0;
      do {
        const ts = Date.now();
        const r = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
        receiptNumber = `RCP-${schoolId.toString().slice(-4)}-${ts}-${r}`;
        attempts++;
        if (attempts > 10) break;
      } while (await Payment.findOne({ receiptNumber }));

      const payment = await Payment.create({
        receiptNumber,
        billId: bill._id,
        studentId: bill.studentId,
        schoolId,
        sessionId: session._id,
        amount: payAmount,
        paymentMode,
        paymentDate: new Date(),
        collectedBy,
        notes: notesBase,
      });

      // pre-save hook recalculates dueAmount + status
      bill.paidAmount += payAmount;
      await bill.save();

      // Ledger entry — never fail the parent payment
      try {
        await LedgerEntry.create({
          schoolId,
          sessionId: session._id,
          entryType: 'DEBIT',
          category: billTypeToCategory[bill.billType] || 'FEE_COLLECTION',
          amount: payAmount,
          sourceModel: 'Payment',
          referenceId: payment._id,
          description: `Advance fee collected — ${bill.description}`,
          entryDate: new Date(),
          performedBy: collectedBy,
        });
      } catch (ledgerErr) {
        console.error('[ADVANCE PAY] Ledger error:', ledgerErr.message);
      }

      receipts.push({
        receiptNumber,
        billId: bill._id,
        billNumber: bill.billNumber,
        billType: bill.billType,
        description: bill.description,
        month,
        amount: payAmount,
        paymentId: payment._id,
      });
    }

    res.status(201).json({
      success: true,
      message: `${receipts.length} advance payment(s) recorded successfully`,
      receipts,
      totalPaid: receipts.reduce((s, r) => s + r.amount, 0),
    });
  } catch (err) {
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
