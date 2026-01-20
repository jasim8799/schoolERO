const Exam = require('../models/Exam.js');

const createExam = async (req, res) => {
  try {
    const { schoolId, sessionId, _id: userId } = req.user;

    const exam = await Exam.create({
      ...req.body,
      schoolId,
      sessionId,
      createdBy: userId
    });
    res.status(201).json(exam);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: 'Exam already exists for this class, session, and school.' });
    }
    res.status(500).json({ message: err.message });
  }
};

const getExamsByClass = async (req, res) => {
  try {
    const { classId } = req.query;
    const { schoolId, sessionId } = req.user;

    const exams = await Exam.find({ classId, schoolId, sessionId }).sort({ startDate: 1 });
    res.json(exams);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = { createExam, getExamsByClass };
