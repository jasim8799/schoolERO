const ExamPayment = require('../models/ExamPayment.js');

const payExamFee = async (req, res) => {
  try {
    const { studentId, examFormId, amount } = req.body;
    const { schoolId, _id: userId, role } = req.user;

    // Validate user is a parent
    if (role !== 'PARENT') {
      return res.status(403).json({ message: 'Only parents can pay exam fees' });
    }

    // Get parent details
    const Parent = require('../models/Parent.js');
    const parent = await Parent.findOne({ userId, schoolId });
    if (!parent) {
      return res.status(400).json({ message: 'Parent profile not found' });
    }

    // Validate studentId is in parent's children
    if (!parent.children.includes(studentId)) {
      return res.status(403).json({ message: 'Access denied. Student not associated with this parent.' });
    }

    // Get active session
    const AcademicSession = require('../models/AcademicSession.js');
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

    const examPayment = await ExamPayment.create({
      studentId,
      examFormId,
      amount,
      paymentMode: 'Online',
      status: 'Paid',
      receiptNumber: `EXAM-${Date.now()}`,
      sessionId: activeSession._id,
      schoolId,
      createdBy: userId,
    });

    // ── Billing dual-write ──────────────────────────────────────────────
    try {
      const Bill = require('../models/Bill');
      const Payment = require('../models/Payment');

      const generateBillNumber = (sid) => {
        const ts = Date.now();
        const r = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
        return `BILL-${sid.toString().slice(-4)}-${ts}-${r}`;
      };
      const generateReceiptNumber = (sid) => {
        const ts = Date.now();
        const r = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
        return `RCP-${sid.toString().slice(-4)}-${ts}-${r}`;
      };

      let billNumber;
      let attempts = 0;
      do {
        billNumber = generateBillNumber(schoolId);
        attempts++;
      } while (attempts < 10 && await Bill.findOne({ billNumber }));

      const ExamForm = require('../models/ExamForm.js');
      const examForm = await ExamForm.findById(examFormId)
        .populate('examId', 'name').lean();
      const description = examForm?.examId?.name
        ? `Exam Fee — ${examForm.examId.name}`
        : 'Exam Fee';

      const bill = await Bill.create({
        billNumber,
        studentId,
        schoolId,
        sessionId: activeSession._id,
        billType: 'EXAM',
        sourceType: 'ExamPayment',
        sourceId: examPayment._id,
        description,
        totalAmount: amount,
        paidAmount: amount,
        dueAmount: 0,
        status: 'PAID',
        createdBy: userId
      });

      let receiptNumber;
      attempts = 0;
      do {
        receiptNumber = generateReceiptNumber(schoolId);
        attempts++;
      } while (attempts < 10 && await Payment.findOne({ receiptNumber }));

      await Payment.create({
        receiptNumber,
        billId: bill._id,
        studentId,
        schoolId,
        sessionId: activeSession._id,
        amount,
        paymentMode: 'Online',
        paymentDate: new Date(),
        collectedBy: userId,
        notes: `Exam payment — ${examPayment.receiptNumber}`
      });
    } catch (billErr) {
      console.error('Exam bill dual-write failed:', billErr.message);
    }
    // ── End billing dual-write ──────────────────────────────────────

    res.status(201).json(examPayment);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: 'Payment already exists for this student, exam form, session, and school.' });
    }
    res.status(500).json({ message: err.message });
  }
};

const manualExamPayment = async (req, res) => {
  try {
    const { studentId, examFormId, amount } = req.body;
    const { schoolId, _id: userId } = req.user;

    // Get active session
    const AcademicSession = require('../models/AcademicSession.js');
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

    const examPayment = await ExamPayment.create({
      studentId,
      examFormId,
      amount,
      paymentMode: 'Manual',
      status: 'Paid',
      receiptNumber: `EXAM-${Date.now()}`,
      sessionId: activeSession._id,
      schoolId,
      createdBy: userId,
    });

    // ── Billing dual-write ──────────────────────────────────────────────
    try {
      const Bill = require('../models/Bill');
      const Payment = require('../models/Payment');

      const generateBillNumber = (sid) => {
        const ts = Date.now();
        const r = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
        return `BILL-${sid.toString().slice(-4)}-${ts}-${r}`;
      };
      const generateReceiptNumber = (sid) => {
        const ts = Date.now();
        const r = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
        return `RCP-${sid.toString().slice(-4)}-${ts}-${r}`;
      };

      let billNumber;
      let attempts = 0;
      do {
        billNumber = generateBillNumber(schoolId);
        attempts++;
      } while (attempts < 10 && await Bill.findOne({ billNumber }));

      const ExamForm = require('../models/ExamForm.js');
      const examForm = await ExamForm.findById(examFormId)
        .populate('examId', 'name').lean();
      const description = examForm?.examId?.name
        ? `Exam Fee — ${examForm.examId.name}`
        : 'Exam Fee';

      const bill = await Bill.create({
        billNumber,
        studentId,
        schoolId,
        sessionId: activeSession._id,
        billType: 'EXAM',
        sourceType: 'ExamPayment',
        sourceId: examPayment._id,
        description,
        totalAmount: amount,
        paidAmount: amount,
        dueAmount: 0,
        status: 'PAID',
        createdBy: userId
      });

      let receiptNumber;
      attempts = 0;
      do {
        receiptNumber = generateReceiptNumber(schoolId);
        attempts++;
      } while (attempts < 10 && await Payment.findOne({ receiptNumber }));

      await Payment.create({
        receiptNumber,
        billId: bill._id,
        studentId,
        schoolId,
        sessionId: activeSession._id,
        amount,
        paymentMode: 'Cash',
        paymentDate: new Date(),
        collectedBy: userId,
        notes: `Exam payment — ${examPayment.receiptNumber}`
      });
    } catch (billErr) {
      console.error('Exam bill dual-write failed:', billErr.message);
    }
    // ── End billing dual-write ──────────────────────────────────────

    res.status(201).json(examPayment);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: 'Payment already exists for this student, exam form, session, and school.' });
    }
    res.status(500).json({ message: err.message });
  }
};

const getMyExamPayments = async (req, res) => {
  try {
    const { schoolId, _id: userId, role } = req.user;

    // Validate user is a parent
    if (role !== 'PARENT') {
      return res.status(403).json({ message: 'Only parents can access this endpoint' });
    }

    // Get parent details
    const Parent = require('../models/Parent.js');
    const parent = await Parent.findOne({ userId, schoolId });
    if (!parent) {
      return res.status(400).json({ message: 'Parent profile not found' });
    }

    // Get active session
    const AcademicSession = require('../models/AcademicSession.js');
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

    const payments = await ExamPayment.find({
      studentId: { $in: parent.children },
      schoolId,
      sessionId: activeSession._id
    })
      .populate({
        path: 'examFormId',
        populate: {
          path: 'examId',
          select: 'name'
        }
      })
      .sort({ createdAt: -1 });
    res.json(payments);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = { payExamFee, manualExamPayment, getMyExamPayments };
