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

const getExamPaymentStatus = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { examId, classId } = req.query;

    const AcademicSession = require('../models/AcademicSession.js');
    const activeSession = await AcademicSession.findOne({
      schoolId,
      isActive: true,
    });
    if (!activeSession) {
      return res.status(400).json({
        success: false,
        message: 'No active academic session found',
      });
    }
    const sessionId = activeSession._id;

    // ── 1. Load active exam forms (optionally filtered) ───────────────
    const ExamForm = require('../models/ExamForm.js');
    const formQuery = { schoolId, sessionId, status: 'ACTIVE' };
    if (examId) formQuery.examId = examId;
    if (classId) formQuery.classId = classId;

    const examForms = await ExamForm.find(formQuery)
      .populate('examId', 'name startDate endDate status')
      .populate('classId', 'name')
      .lean();

    if (examForms.length === 0) {
      return res.json({ success: true, data: [] });
    }

    // ── 2. Load all payments for these exam forms ─────────────────────
    const examFormIds = examForms.map((f) => f._id);
    const payments = await ExamPayment.find({
      schoolId,
      sessionId,
      examFormId: { $in: examFormIds },
    }).lean();

    // Map: examFormId_studentId → payment
    const paymentMap = {};
    for (const p of payments) {
      const key = `${p.examFormId}_${p.studentId}`;
      paymentMap[key] = p;
    }

    // ── 3. For each exam form, load students in that class ────────────
    const Student = require('../models/Student.js');
    const result = [];

    for (const form of examForms) {
      const students = await Student.find({
        classId: form.classId._id || form.classId,
        schoolId,
        status: 'ACTIVE',
      })
        .select('_id name rollNumber userId classId')
        .populate('userId', 'name')
        .lean();

      for (const student of students) {
        const key = `${form._id}_${student._id}`;
        const payment = paymentMap[key] || null;
        const studentName =
          student.name ||
          student.userId?.name ||
          'Unknown';

        result.push({
          examFormId: form._id,
          examId: form.examId,
          classId: form.classId,
          feeAmount: form.feeAmount,
          endDate: form.endDate,
          isPaymentRequired: form.isPaymentRequired,
          studentId: {
            _id: student._id,
            name: studentName,
            rollNumber: student.rollNumber,
          },
          status: payment ? payment.status : 'Pending',
          receiptNumber: payment?.receiptNumber ?? null,
          paymentId: payment?._id ?? null,
          paymentMode: payment?.paymentMode ?? null,
          paidAt: payment?.createdAt ?? null,
        });
      }
    }

    // Sort: pending first, then by exam name, then student name
    result.sort((a, b) => {
      if (a.status === 'Pending' && b.status !== 'Pending') return -1;
      if (a.status !== 'Pending' && b.status === 'Pending') return 1;
      const aExam = a.examId?.name ?? '';
      const bExam = b.examId?.name ?? '';
      if (aExam !== bExam) return aExam.localeCompare(bExam);
      return (a.studentId?.name ?? '').localeCompare(b.studentId?.name ?? '');
    });

    return res.json({ success: true, data: result, total: result.length });
  } catch (err) {
    console.error('[getExamPaymentStatus] error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { payExamFee, manualExamPayment, getMyExamPayments, getAllExamPayments, getExamPaymentStatus };
