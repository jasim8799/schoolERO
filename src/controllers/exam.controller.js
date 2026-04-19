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
    const { schoolId, sessionId, _id: userId } = req.user;

    const myExamSubjects = await ExamSubject.find({
      teacherId: userId,
      schoolId,
      sessionId,
    }).populate('subjectId', 'name');

    if (!myExamSubjects.length) {
      return res.json({
        success: true,
        message: 'No assigned exams found',
        data: [],
      });
    }

    const examIdStrings = [...new Set(myExamSubjects.map((es) => String(es.examId)))];

    const exams = await Exam.find({
      _id: { $in: examIdStrings },
      schoolId,
      sessionId,
    }).sort({ startDate: 1 });

    const myPapers = await ExamQuestionPaper.find({
      examId: { $in: examIdStrings },
      teacherId: userId,
      schoolId,
      sessionId,
    }).select('examId subjectId status');

    const paperStatusByExamSubject = new Map();
    for (const paper of myPapers) {
      const key = `${String(paper.examId)}_${String(paper.subjectId)}`;
      paperStatusByExamSubject.set(key, paper.status || 'Draft');
    }

    const subjectsByExam = new Map();
    for (const examSubject of myExamSubjects) {
      const examId = String(examSubject.examId);
      const subjectId = examSubject.subjectId;
      const subjectIdString =
        subjectId && typeof subjectId === 'object' && subjectId._id
          ? String(subjectId._id)
          : String(subjectId);
      const paperKey = `${examId}_${subjectIdString}`;
      const paperStatus = paperStatusByExamSubject.get(paperKey) || 'NotStarted';

      if (!subjectsByExam.has(examId)) {
        subjectsByExam.set(examId, []);
      }

      subjectsByExam.get(examId).push({
        subjectId: subjectIdString,
        subjectName:
          subjectId && typeof subjectId === 'object' && subjectId.name
            ? subjectId.name
            : '',
        maxMarks: examSubject.maxMarks,
        examDate: examSubject.examDate,
        paperStatus,
      });
    }

    const data = exams.map((exam) => {
      const examId = String(exam._id);
      return {
        ...exam.toObject(),
        mySubjects: subjectsByExam.get(examId) || [],
      };
    });

    res.json({
      success: true,
      message: 'Assigned exams fetched successfully',
      data,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message, data: [] });
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

    const exam = await Exam.findOne({ _id: examId, schoolId, sessionId })
      .populate('classId', 'name _id');
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
