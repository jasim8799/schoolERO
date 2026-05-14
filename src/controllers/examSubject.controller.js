const Exam = require('../models/Exam.js');
const ExamSubject = require('../models/ExamSubject.js');
const Teacher = require('../models/Teacher.js');

const createExamSubject = async (req, res) => {
  try {
    const { subjectId, maxMarks, passMarks, teacherId, examDate } = req.body;
    const { examId } = req.params;
    const { schoolId, sessionId, _id: userId } = req.user;

    // ── Field validation ─────────────────────────────────────────
    const errors = [];
    if (!subjectId) errors.push('Subject is required');
    if (!teacherId) errors.push('Teacher is required');
    if (maxMarks == null || maxMarks === '') errors.push('Max marks is required');
    if (passMarks == null || passMarks === '') errors.push('Pass marks is required');
    if (!examDate) errors.push('Exam date is required');
    if (errors.length > 0) {
      return res.status(400).json({ success: false, message: errors.join(', '), errors });
    }

    const maxM = Number(maxMarks);
    const passM = Number(passMarks);
    if (isNaN(maxM) || maxM <= 0) {
      return res.status(400).json({ success: false, message: 'Max marks must be a positive number' });
    }
    if (isNaN(passM) || passM <= 0) {
      return res.status(400).json({ success: false, message: 'Pass marks must be a positive number' });
    }
    if (passM > maxM) {
      return res.status(400).json({ success: false, message: `Pass marks (${passM}) cannot exceed max marks (${maxM})` });
    }

    // ── Verify exam exists and is in Draft ───────────────────────
    const exam = await Exam.findOne({ _id: examId, schoolId, sessionId });
    if (!exam) {
      return res.status(404).json({ success: false, message: 'Exam not found' });
    }
    if (exam.status !== 'Draft') {
      return res.status(403).json({ success: false, message: 'Cannot add subjects after exam is published' });
    }

    // ── Verify subject belongs to this school ────────────────────
    const Subject = require('../models/Subject.js');
    const subjectDoc = await Subject.findOne({ _id: subjectId, schoolId });
    if (!subjectDoc) {
      return res.status(404).json({ success: false, message: 'Subject not found in your school' });
    }

    // ── Verify teacher exists + belongs to school ─────────────────
    const teacherProfile = await Teacher.findOne({ _id: teacherId, schoolId });
    if (!teacherProfile) {
      return res.status(404).json({ success: false, message: 'Teacher not found in your school' });
    }
    const teacherUserId = teacherProfile.userId;

    // ── Validate exam date is within exam range ───────────────────
    const examDateObj = new Date(examDate);
    if (isNaN(examDateObj.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid exam date' });
    }
    if (examDateObj < exam.startDate || examDateObj > exam.endDate) {
      return res.status(400).json({
        success: false,
        message: `Exam date must be between ${exam.startDate.toISOString().split('T')[0]} and ${exam.endDate.toISOString().split('T')[0]}`
      });
    }

    const examSubject = await ExamSubject.create({
      examId,
      subjectId,
      teacherId: teacherUserId,
      maxMarks: maxM,
      passMarks: passM,
      examDate: examDateObj,
      sessionId: exam.sessionId,
      schoolId,
      createdBy: userId,
    });

    const populated = await ExamSubject.findById(examSubject._id)
      .populate('subjectId', 'name')
      .populate('teacherId', 'name');

    return res.status(201).json({
      success: true,
      message: `Subject "${subjectDoc.name}" added to exam successfully`,
      data: populated,
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'This subject is already added to this exam'
      });
    }
    console.error('[createExamSubject] Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to add subject to exam' });
  }
};

const getExamSubjects = async (req, res) => {
  try {
    const { examId } = req.params;
    const { schoolId, sessionId } = req.user;

    const exam = await Exam.findOne({ _id: examId, schoolId, sessionId });
    if (!exam) {
      return res.status(404).json({ success: false, message: 'Exam not found' });
    }

    const examSubjects = await ExamSubject.find({ examId, schoolId, sessionId })
      .populate('subjectId', 'name code')
      .populate('teacherId', 'name email role');

    const data = examSubjects.map(es => ({
      _id: es._id,
      examId: es.examId,
      subjectId: es.subjectId,
      subjectName: es.subjectId?.name ?? '',
      teacherId: es.teacherId,
      teacherName: es.teacherId?.name ?? '',
      maxMarks: es.maxMarks,
      passMarks: es.passMarks,
      examDate: es.examDate,
    }));

    return res.json({ success: true, count: data.length, data });
  } catch (err) {
    console.error('[getExamSubjects] Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to load exam subjects' });
  }
};

module.exports = { createExamSubject, getExamSubjects };
