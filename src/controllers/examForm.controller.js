import ExamForm from '../models/ExamForm.js';

export const createExamForm = async (req, res) => {
  try {
    const { examId, classId, feeAmount, lastDate, isPaymentRequired } = req.body;
    const { schoolId, sessionId, _id: userId } = req.user;

    const examForm = await ExamForm.create({
      examId,
      classId,
      feeAmount,
      lastDate,
      isPaymentRequired,
      status: 'Open',
      sessionId,
      schoolId,
      createdBy: userId,
    });
    res.status(201).json(examForm);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: 'Exam form already exists for this exam, class, session, and school.' });
    }
    res.status(500).json({ message: err.message });
  }
};

export const getActiveExamForms = async (req, res) => {
  try {
    const { classId } = req.query;
    const { schoolId, sessionId } = req.user;

    const examForms = await ExamForm.find({ classId, schoolId, sessionId, status: 'Open' }).sort({ lastDate: 1 });
    res.json(examForms);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
