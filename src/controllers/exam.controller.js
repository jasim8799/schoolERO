const Exam = require('../models/Exam.js');
const ExamSubject = require('../models/ExamSubject.js');
const ExamQuestionPaper = require('../models/ExamQuestionPaper.js');

const _ip = (req) =>
  req.headers['x-forwarded-for']?.split(',')[0]?.trim()
  || req.socket?.remoteAddress || req.ip || '0.0.0.0';

const _audit = async (action, entityType, entityId, desc, details, req) => {
  try {
    const { auditLog } = require('../utils/auditLog');
    await auditLog({
      action, entityType, entityId,
      userId: req.user?._id,
      schoolId: req.user?.schoolId,
      description: desc,
      details,
      ipAddress: _ip(req),
      role: req.user?.role || 'SYSTEM',
    });
  } catch (_) {}
};

const createExam = async (req, res) => {
  try {
    const { _id: userId, schoolId, sessionId } = req.user;
    const { name, classId, startDate, endDate } = req.body;

    // ── Validation ──────────────────────────────────────────────
    const errors = [];
    if (!name || !name.trim()) errors.push('Exam name is required');
    if (!classId) errors.push('Class is required');
    if (!startDate) errors.push('Start date is required');
    if (!endDate) errors.push('End date is required');
    if (errors.length > 0) {
      return res.status(400).json({ success: false, message: errors.join(', '), errors });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    if (isNaN(start.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid start date' });
    }
    if (isNaN(end.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid end date' });
    }
    if (end < start) {
      return res.status(400).json({ success: false, message: 'End date must be after start date' });
    }

    // ── Verify class belongs to school ───────────────────────────
    const Class = require('../models/Class.js');
    const classDoc = await Class.findOne({ _id: classId, schoolId });
    if (!classDoc) {
      return res.status(404).json({ success: false, message: 'Class not found in your school' });
    }

    // ── Duplicate check ──────────────────────────────────────────
    const existing = await Exam.findOne({
      name: name.trim(), classId, sessionId, schoolId
    });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: `An exam named "${name.trim()}" already exists for this class in the current session`
      });
    }

    const exam = await Exam.create({
      name: name.trim(),
      classId,
      startDate: start,
      endDate: end,
      schoolId,
      sessionId,
      createdBy: userId,
      status: 'Draft',
    });

    const populated = await Exam.findById(exam._id).populate('classId', 'name');

    _audit('EXAM_CREATED', 'EXAM', exam._id,
      `Exam "${exam.name}" created for class "${classDoc.name}"`, { classId }, req);

    return res.status(201).json({
      success: true,
      message: 'Exam created successfully',
      data: populated,
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'An exam with this name already exists for this class and session'
      });
    }
    console.error('[createExam] Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to create exam. Please try again.' });
  }
};

const getExamsByClass = async (req, res) => {
  try {
    const { classId } = req.query;
    const { schoolId, sessionId } = req.user;

    const query = { schoolId, sessionId };
    if (classId) query.classId = classId;

    const exams = await Exam.find(query)
      .populate('classId', 'name')
      .populate('createdBy', 'name')
      .sort({ startDate: 1 });

    // Attach subject count to each exam
    const examIds = exams.map(e => e._id);
    const subjectCounts = await ExamSubject.aggregate([
      { $match: { examId: { $in: examIds }, schoolId } },
      { $group: { _id: '$examId', count: { $sum: 1 } } },
    ]);
    const countMap = {};
    for (const sc of subjectCounts) countMap[sc._id.toString()] = sc.count;

    const data = exams.map(e => ({
      ...e.toObject(),
      subjectCount: countMap[e._id.toString()] || 0,
    }));

    return res.json({ success: true, data });
  } catch (err) {
    console.error('[getExamsByClass] Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to load exams' });
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
    })
      .populate('classId', 'name')
      .sort({ startDate: 1 });

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
              classId: exam.classId ?? null,
              className: exam.classId?.name ?? '',
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
      return res.status(404).json({ success: false, message: 'Exam not found' });
    }
    if (exam.status !== 'Draft') {
      return res.status(403).json({
        success: false,
        message: 'Cannot edit a published exam. Only Draft exams can be modified.'
      });
    }

    const { name, startDate, endDate } = req.body;
    const updateData = {};

    if (name !== undefined) {
      if (!name.trim()) return res.status(400).json({ success: false, message: 'Exam name cannot be empty' });
      updateData.name = name.trim();
    }
    if (startDate !== undefined) {
      const start = new Date(startDate);
      if (isNaN(start.getTime())) return res.status(400).json({ success: false, message: 'Invalid start date' });
      updateData.startDate = start;
    }
    if (endDate !== undefined) {
      const end = new Date(endDate);
      if (isNaN(end.getTime())) return res.status(400).json({ success: false, message: 'Invalid end date' });
      updateData.endDate = end;
    }

    const startToCheck = updateData.startDate || exam.startDate;
    const endToCheck = updateData.endDate || exam.endDate;
    if (endToCheck < startToCheck) {
      return res.status(400).json({ success: false, message: 'End date must be after start date' });
    }

    const updated = await Exam.findByIdAndUpdate(examId, updateData, { new: true })
      .populate('classId', 'name');

    _audit('EXAM_UPDATED', 'EXAM', examId, `Exam "${updated.name}" updated`, updateData, req);

    return res.json({ success: true, message: 'Exam updated successfully', data: updated });
  } catch (err) {
    console.error('[updateExam] Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to update exam' });
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

    _audit('EXAM_PUBLISHED', 'EXAM', updatedExam._id,
      `Exam "${updatedExam.name}" published`, {}, req);
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
