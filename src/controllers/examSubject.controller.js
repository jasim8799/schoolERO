const Exam = require('../models/Exam.js');
const ExamSubject = require('../models/ExamSubject.js');

const createExamSubject = async (req, res) => {
  try {
    const { subjectId, maxMarks, passMarks, teacherId } = req.body;
    const { examId } = req.params;
    const { schoolId, _id: userId } = req.user;

    if (passMarks > maxMarks) {
      return res.status(400).json({
        message: 'Pass marks cannot be greater than max marks'
      });
    }

    // 🔴 FIX: REMOVE sessionId from exam lookup
    const exam = await Exam.findOne({ _id: examId, schoolId });

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
      sessionId: exam.sessionId, // ✅ USE EXAM SESSION
      schoolId,
      createdBy: userId
    });

    res.status(201).json({
      success: true,
      message: 'Exam subject linked successfully',
      data: examSubject
    });

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
    const { schoolId } = req.user;

    // 🔴 FIX: REMOVE sessionId filter
    const examSubjects = await ExamSubject.find({ examId, schoolId })
      .populate('subjectId', 'name')
      .populate('teacherId', 'name');

    res.json({
      success: true,
      count: examSubjects.length,
      data: examSubjects
    });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = { createExamSubject, getExamSubjects };
