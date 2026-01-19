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

module.exports = {
  payManual,
  getPaymentsByStudent,
  initiateOnlinePayment,
  verifyOnlinePayment,
  getMyPayments,
  getReceipt,
};
