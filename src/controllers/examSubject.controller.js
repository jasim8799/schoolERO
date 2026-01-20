import ExamSubject from '../models/ExamSubject.js';

export const createExamSubject = async (req, res) => {
  try {
    const { examId, subjectId, maxMarks, passMarks, teacherId } = req.body;
    const { schoolId, sessionId, _id: userId } = req.user;

    const examSubject = await ExamSubject.create({
      examId,
      subjectId,
      maxMarks,
      passMarks,
      teacherId,
      sessionId,
      schoolId
    });
    res.status(201).json(examSubject);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: 'Exam subject already exists for this exam, subject, session, and school.' });
    }
    res.status(500).json({ message: err.message });
  }
};

export const getExamSubjects = async (req, res) => {
  try {
    const { examId } = req.params;
    const { schoolId, sessionId } = req.user;

    const examSubjects = await ExamSubject.find({ examId, schoolId, sessionId })
      .populate('subjectId', 'name')
      .populate('teacherId', 'name');
    res.json(examSubjects);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
