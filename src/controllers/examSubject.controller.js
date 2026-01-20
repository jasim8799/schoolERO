const Exam = require('../models/Exam.js');
const ExamSubject = require('../models/ExamSubject.js');

const createExamSubject = async (req, res) => {
  try {
    const { subjectId, maxMarks, passMarks, teacherId } = req.body;
    const { examId } = req.params;
    const { schoolId, sessionId, _id: userId } = req.user;

    if (passMarks > maxMarks) {
      return res.status(400).json({
        message: 'Pass marks cannot be greater than max marks'
      });
    }

    const exam = await Exam.findOne({ _id: examId, schoolId, sessionId });
    if (!exam) {
      return res.status(404).json({ message: 'Exam not found' });
    }

    if (exam.status !== 'Draft') {
      return res.status(403).json({
        message: 'Cannot add subjects after exam is published'
      });
    }

    const examSubject = await ExamSubject.create({
      examId,
      subjectId,
      teacherId,
      maxMarks,
      passMarks,
      sessionId,
      schoolId,
      createdBy: userId
    });

    res.status(201).json(examSubject);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({
        message: 'Subject already assigned to this exam'
      });
    }
    res.status(500).json({ message: err.message });
  }
};

const getExamSubjects = async (req, res) => {
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

module.exports = { createExamSubject, getExamSubjects };
