const Exam = require('../models/Exam.js');

const createExam = async (req, res) => {
  try {
    const { _id: userId, schoolId, sessionId } = req.user;

    const {
      sessionId: _ignoreSession,
      schoolId: _ignoreSchool,
      createdBy: _ignoreCreatedBy,
      ...safeBody
    } = req.body;

    const exam = await Exam.create({
      ...safeBody,
      schoolId,
      sessionId,
      createdBy: userId
    });

    res.status(201).json(exam);


  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getExamsByClass = async (req, res) => {
  try {
    const { classId } = req.query;
    const { schoolId, sessionId } = req.user;

    const query = { schoolId, sessionId };
    if (classId) {
      query.classId = classId;
    }

    const exams = await Exam.find(query).sort({ startDate: 1 });
    res.json(exams);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const updateExam = async (req, res) => {
  try {
    const { examId } = req.params;
    const { schoolId, sessionId } = req.user;

    const exam = await Exam.findOne({ _id: examId, schoolId, sessionId });
    if (!exam) {
      return res.status(404).json({ message: 'Exam not found' });
    }

    if (exam.status !== 'Draft') {
      return res.status(403).json({ message: 'Cannot update published exam' });
    }

    const { schoolId: _, sessionId: __, createdBy: ___, ...updateData } = req.body;

    const updatedExam = await Exam.findByIdAndUpdate(examId, updateData, { new: true });
    res.json(updatedExam);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const publishExam = async (req, res) => {
  try {
    const { examId } = req.params;
    const { schoolId, sessionId } = req.user;

    const exam = await Exam.findOne({ _id: examId, schoolId, sessionId });
    if (!exam) {
      return res.status(404).json({ message: 'Exam not found' });
    }

    if (exam.status !== 'Draft') {
      return res.status(403).json({ message: 'Exam is already published' });
    }

    const updatedExam = await Exam.findByIdAndUpdate(examId, { status: 'Published' }, { new: true });
    res.json(updatedExam);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = { createExam, getExamsByClass, updateExam, publishExam };
