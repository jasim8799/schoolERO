import ExamPayment from '../models/ExamPayment.js';

export const payExamFee = async (req, res) => {
  try {
    const { examFormId, amount } = req.body;
    const { studentId, schoolId, sessionId, _id: userId } = req.user;

    const examPayment = await ExamPayment.create({
      studentId,
      examFormId,
      amount,
      paymentMode: 'Online',
      status: 'Paid',
      receiptNumber: `EXAM-${Date.now()}`,
      sessionId,
      schoolId,
      createdBy: userId,
    });
    res.status(201).json(examPayment);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: 'Payment already exists for this student, exam form, session, and school.' });
    }
    res.status(500).json({ message: err.message });
  }
};

export const manualExamPayment = async (req, res) => {
  try {
    const { studentId, examFormId, amount } = req.body;
    const { schoolId, sessionId, _id: userId } = req.user;

    const examPayment = await ExamPayment.create({
      studentId,
      examFormId,
      amount,
      paymentMode: 'Manual',
      status: 'Paid',
      receiptNumber: `EXAM-${Date.now()}`,
      sessionId,
      schoolId,
      createdBy: userId,
    });
    res.status(201).json(examPayment);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: 'Payment already exists for this student, exam form, session, and school.' });
    }
    res.status(500).json({ message: err.message });
  }
};

export const getMyExamPayments = async (req, res) => {
  try {
    const { studentId, schoolId, sessionId } = req.user;

    const payments = await ExamPayment.find({ studentId, schoolId, sessionId })
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
