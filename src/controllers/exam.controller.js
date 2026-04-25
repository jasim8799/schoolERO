const Exam = require('../models/Exam.js');
const ExamSubject = require('../models/ExamSubject.js');
const ExamQuestionPaper = require('../models/ExamQuestionPaper.js');

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
    res.json({ success: true, data: exams });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getMyAssignedExams = async (req, res) => {
  try {
    const { _id: teacherId, schoolId, sessionId } = req.user;

    // Find all ExamSubject rows assigned to this teacher
    const mySubjectRows = await ExamSubject.find({
      teacherId,
      schoolId,
      sessionId,
    }).populate('subjectId', 'name');

    if (mySubjectRows.length === 0) {
      return res.json({ success: true, data: [] });
    }

    // Get unique examIds
    const examIds = [...new Set(mySubjectRows.map((s) => s.examId.toString()))];

    // Fetch the actual exams
    const exams = await Exam.find({
      _id: { $in: examIds },
      schoolId,
      sessionId,
    }).sort({ startDate: 1 });

    // For each exam, attach only THIS teacher's subjects + paper status
    const result = await Promise.all(
      exams.map(async (exam) => {
        const mySubjectsForExam = mySubjectRows.filter(
          (s) => s.examId.toString() === exam._id.toString()
        );

        const subjectsWithPaperStatus = await Promise.all(
          mySubjectsForExam.map(async (sub) => {
            const paper = await ExamQuestionPaper.findOne({
              examId: exam._id,
              subjectId: sub.subjectId._id,
              teacherId,
              schoolId,
              sessionId,
            });
            return {
              subjectId: sub.subjectId._id,
              subjectName: sub.subjectId?.name ?? '',
              maxMarks: sub.maxMarks,
              passMarks: sub.passMarks,
              examDate: sub.examDate,
              paperStatus: paper ? paper.status : 'NotStarted',
            };
          })
        );

        return {
          ...exam.toObject(),
          mySubjects: subjectsWithPaperStatus,
        };
      })
    );

    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
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

const { dispatchAutomationTrigger } = require('../services/automation.service');

const publishExam = async (req, res) => {
  try {
    const { examId } = req.params;
    const { schoolId, sessionId } = req.user;

    const exam = await Exam.findOne({ _id: examId, schoolId, sessionId })
      .populate('classId', 'name _id');
    if (!exam) {
      return res.status(404).json({ message: 'Exam not found' });
    }

    if (exam.status !== 'Draft') {
      return res.status(403).json({ message: 'Exam is already published' });
    }

    const updatedExam = await Exam.findByIdAndUpdate(examId, { status: 'Published' }, { new: true });

    try {
      await dispatchAutomationTrigger(schoolId, 'EXAM_PUBLISHED', {
        entityId: updatedExam._id,
        entityType: 'Exam',
        examId: updatedExam._id,
        examName: updatedExam.name,
        classId: exam.classId?._id,
        message: `${updatedExam.name} exam has been published. Check the exam schedule.`,
      });
    } catch (automationErr) {
      console.error('[automation] EXAM_PUBLISHED dispatch failed:', automationErr.message);
    }

    res.json(updatedExam);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const publishAdmitCards = async (req, res) => {
  try {
    const { examId } = req.params;
    const { schoolId, sessionId } = req.user;

    const exam = await Exam.findOne({ _id: examId, schoolId, sessionId });
    if (!exam) {
      return res.status(404).json({ message: 'Exam not found' });
    }

    if (exam.status !== 'Published') {
      return res.status(403).json({ message: 'Exam must be published before releasing admit cards' });
    }

    const AdmitCard = require('../models/AdmitCard.js');
    const count = await AdmitCard.countDocuments({ examId, schoolId, sessionId });
    if (count === 0) {
      return res.status(400).json({ message: 'No admit cards generated yet. Generate admit cards first.' });
    }

    const updated = await Exam.findByIdAndUpdate(
      examId,
      { isAdmitCardPublished: true, admitCardPublishedAt: new Date() },
      { new: true }
    );

    try {
      await dispatchAutomationTrigger(schoolId, 'ADMIT_CARD_PUBLISHED', {
        entityId: updated._id,
        entityType: 'Exam',
        examId: updated._id,
        examName: updated.name,
        message: `${updated.name} admit cards are now available.`,
      });
    } catch (automationErr) {
      console.error('[automation] ADMIT_CARD_PUBLISHED dispatch failed:', automationErr.message);
    }

    res.json({ success: true, message: 'Admit cards published successfully', data: updated });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getExamById = async (req, res) => {
  try {
    const { examId } = req.params;
    const { schoolId, sessionId } = req.user;

    const exam = await Exam.findOne({ _id: examId, schoolId, sessionId });
    if (!exam) {
      return res.status(404).json({ success: false, message: 'Exam not found' });
    }

    const examSubjects = await ExamSubject.find({ examId, schoolId, sessionId })
      .populate('subjectId', 'name');

    const subjects = examSubjects
      .map(es => ({
        name: es.subjectId?.name ?? '',
        subjectId: es.subjectId?._id,
        maxMarks: es.maxMarks,
        passMarks: es.passMarks,
        examDate: es.examDate,
      }))
      .filter(s => s.name);

    res.json({
      success: true,
      data: {
        ...exam.toObject(),
        subjects,
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  createExam,
  getExamsByClass,
  getMyAssignedExams,
  getExamById,
  updateExam,
  publishExam,
  publishAdmitCards,
};
