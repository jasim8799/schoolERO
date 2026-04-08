const ExamPayment = require('../models/ExamPayment.js');

const payExamFee = async (req, res) => {
  try {
    let { studentId, examFormId, amount } = req.body;
    const { schoolId, _id: userId, role } = req.user;

    if (!examFormId || amount == null) {
      return res.status(400).json({ message: 'examFormId and amount are required' });
    }

    if (!['PARENT', 'STUDENT'].includes(role)) {
      return res.status(403).json({ message: 'Only parents or students can pay exam fees online' });
    }

    let studentIds = [];
    if (role === 'PARENT') {
      const Parent = require('../models/Parent.js');
      const parent = await Parent.findOne({ userId, schoolId });
      if (!parent) return res.status(400).json({ message: 'Parent profile not found' });
      if (!parent.children.some((id) => id.toString() === studentId.toString())) {
        return res.status(403).json({ message: 'Access denied. Student not associated with this parent.' });
      }
      studentIds = parent.children;
    }

    if (role === 'STUDENT') {
      const Student = require('../models/Student.js');
      const ownStudent = await Student.findOne({ userId, schoolId }).select('_id');
      if (!ownStudent) {
        return res.status(400).json({ message: 'Student profile not found' });
      }
      if (!studentId) {
        studentId = ownStudent._id;
      }
      if (studentId && ownStudent._id.toString() !== studentId.toString()) {
        return res.status(403).json({ message: 'Access denied. You can only pay for your own exam fee.' });
      }
    }

    if (!studentId) {
      return res.status(400).json({ message: 'studentId is required' });
    }

    if (role === 'PARENT' && studentIds.length === 0) {
      return res.status(400).json({ message: 'No students associated with this parent' });
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

const getAllExamPayments = async (req, res) => {
  try {
    const { schoolId } = req.user;

    const AcademicSession = require('../models/AcademicSession.js');
    const activeSession = await AcademicSession.findOne({ schoolId, isActive: true });
    if (!activeSession) {
      return res.status(400).json({ success: false, message: 'No active academic session found' });
    }

    const payments = await ExamPayment.find({ schoolId, sessionId: activeSession._id })
      .populate({ path: 'examFormId', populate: { path: 'examId', select: 'name' } })
      .populate({ path: 'studentId', select: 'name userId', populate: { path: 'userId', select: 'name' } })
      .sort({ createdAt: -1 });

    res.json({ success: true, data: payments });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getMyExamPayments = async (req, res) => {
  try {
    const { schoolId, _id: userId, role } = req.user;

    let studentFilter = null;
    if (role === 'PARENT') {
      const Parent = require('../models/Parent.js');
      const parent = await Parent.findOne({ userId, schoolId });
      if (!parent) {
        return res.status(400).json({ message: 'Parent profile not found' });
      }
      studentFilter = { $in: parent.children };
    } else if (role === 'STUDENT') {
      const Student = require('../models/Student.js');
      const student = await Student.findOne({ userId, schoolId }).select('_id');
      if (!student) {
        return res.status(400).json({ message: 'Student profile not found' });
      }
      studentFilter = student._id;
    } else {
      return res.status(403).json({ message: 'Only parents or students can access this endpoint' });
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
      studentId: studentFilter,
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

module.exports = { payExamFee, manualExamPayment, getMyExamPayments, getAllExamPayments };
