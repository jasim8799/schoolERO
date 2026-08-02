const mongoose = require('mongoose');
const Question = require('../models/Question.js');
const Student = require('../models/Student.js');
const Teacher = require('../models/Teacher.js');
const Subject = require('../models/Subject.js');
const Parent = require('../models/Parent.js');

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

const _sessionFilter = (sessionId) =>
  sessionId
    ? {
        $or: [
          { sessionId },
          { sessionId: null },
          { sessionId: { $exists: false } },
        ],
      }
    : {};

const askQuestion = async (req, res) => {
  try {
    const { teacherId, subjectId, chapter, topic, questionText, questionImage } = req.body;
    const { schoolId, _id: userId, role, sessionId } = req.user;

    let studentId;
    if (role === 'STUDENT') {
      const student = await Student.findOne({ userId, schoolId }).select('_id status').lean();
      if (!student) return res.status(404).json({ success: false, message: 'Student not found' });
      
      if (student.status !== 'ACTIVE') {
        return res.status(403).json({ success: false, message: 'Cannot ask questions - student status is: ' + student.status + '. Only ACTIVE students can ask questions.' });
      }
      studentId = student._id;
    } else if (role === 'PARENT') {
      studentId = req.body.studentId;
    } else {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    if (!teacherId || !subjectId) {
      return res.status(400).json({ success: false, message: 'teacherId and subjectId are required' });
    }
    if (!questionText && !questionImage) {
      return res.status(400).json({ success: false, message: 'Either question text or image is required' });
    }

    const question = await Question.create({
      studentId,
      teacherId,
      subjectId,
      schoolId,
      sessionId,
      chapter: chapter || '',
      topic: topic || '',
      questionText: questionText || '',
      questionImage: questionImage || '',
    });

    _audit('QUESTION_ASKED', 'QUESTION', question._id,
      `Question asked: "${question.topic || question.chapter || 'Q&A'}"`, {}, req);
    return res.status(201).json({ success: true, data: question });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const getMyQuestions = async (req, res) => {
  try {
    const { schoolId, _id: userId, role, sessionId } = req.user;

    let studentId;
    if (role === 'STUDENT') {
      const student = await Student.findOne({ userId, schoolId }).select('_id').lean();
      if (!student) return res.json({ success: true, data: [] });
      studentId = student._id;
    } else if (role === 'PARENT') {
      const reqStudentId = req.query.studentId;
      if (!reqStudentId || !mongoose.Types.ObjectId.isValid(reqStudentId)) {
        return res.json({ success: true, data: [] });
      }
      const student = await Student.findOne({
        _id: new mongoose.Types.ObjectId(reqStudentId),
        schoolId,
        parentId: userId,
      })
        .select('_id')
        .lean();
      if (!student) return res.json({ success: true, data: [] });
      studentId = student._id;
    } else {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    const questions = await Question.find({ studentId, schoolId, ..._sessionFilter(sessionId) })
      .populate({ path: 'teacherId', select: 'userId', populate: { path: 'userId', select: 'name' } })
      .populate('subjectId', 'name')
      .sort({ createdAt: -1 })
      .lean();

    return res.json({ success: true, data: questions });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const getTeacherQuestions = async (req, res) => {
  try {
    const { schoolId, _id: userId, sessionId } = req.user;
    const { status } = req.query;

    const teacher = await Teacher.findOne({ userId, schoolId }).select('_id').lean();
    if (!teacher) return res.json({ success: true, data: [] });

    const filter = { teacherId: teacher._id, schoolId, ..._sessionFilter(sessionId) };
    if (status) filter.status = String(status).toUpperCase();

    const questions = await Question.find(filter)
      .populate({
        path: 'studentId',
        select: 'rollNumber classId sectionId userId name',
        populate: [
          { path: 'userId', select: 'name' },
          { path: 'classId', select: 'name' },
          { path: 'sectionId', select: 'name' },
        ],
      })
      .populate('subjectId', 'name')
      .sort({ createdAt: -1 })
      .lean();

    return res.json({ success: true, data: questions });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const answerQuestion = async (req, res) => {
  try {
    const { id } = req.params;
    const { answerText, answerImage } = req.body;
    const { schoolId, _id: userId, sessionId } = req.user;

    const teacher = await Teacher.findOne({ userId, schoolId }).select('_id').lean();
    if (!teacher) return res.status(403).json({ success: false, message: 'Forbidden' });

    if (!answerText && !answerImage) {
      return res.status(400).json({ success: false, message: 'Either answer text or image is required' });
    }

    const question = await Question.findOneAndUpdate(
      { _id: id, teacherId: teacher._id, schoolId, ..._sessionFilter(sessionId) },
      {
        answerText: answerText || '',
        answerImage: answerImage || '',
        status: 'ANSWERED',
        answeredAt: new Date(),
      },
      { new: true }
    );

    if (!question) return res.status(404).json({ success: false, message: 'Question not found' });
    _audit('QUESTION_ANSWERED', 'QUESTION', question._id,
      `Question answered`, {}, req);
    return res.json({ success: true, data: question });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const getAllQuestions = async (req, res) => {
  try {
    const { schoolId, sessionId } = req.user;
    const { status, subjectId, teacherId, classId, page = 1, limit = 50 } = req.query;

    const filter = { schoolId, ..._sessionFilter(sessionId) };
    if (status) filter.status = String(status).toUpperCase();
    if (subjectId && mongoose.Types.ObjectId.isValid(subjectId)) {
      filter.subjectId = new mongoose.Types.ObjectId(subjectId);
    }
    if (teacherId && mongoose.Types.ObjectId.isValid(teacherId)) {
      filter.teacherId = new mongoose.Types.ObjectId(teacherId);
    }
    if (classId && mongoose.Types.ObjectId.isValid(classId)) {
      const classStudents = await Student.find({
        schoolId,
        classId: new mongoose.Types.ObjectId(classId),
      })
        .select('_id')
        .lean();
      filter.studentId = { $in: classStudents.map((s) => s._id) };
    }

    const pageNum = Number(page) || 1;
    const limitNum = Number(limit) || 50;

    const questions = await Question.find(filter)
      .populate({
        path: 'studentId',
        select: 'rollNumber classId sectionId userId name',
        populate: [
          { path: 'userId', select: 'name' },
          { path: 'classId', select: 'name' },
          { path: 'sectionId', select: 'name' },
        ],
      })
      .populate({ path: 'teacherId', select: 'userId', populate: { path: 'userId', select: 'name' } })
      .populate('subjectId', 'name')
      .sort({ createdAt: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum)
      .lean();

    const total = await Question.countDocuments(filter);

    return res.json({ success: true, data: questions, total });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const getSubjectsForStudent = async (req, res) => {
  try {
    const { schoolId, sessionId, role } = req.user;
    const normalizedSchoolId = schoolId?._id || schoolId;

    // Keep existing role behavior unchanged for non-student/parent roles.
    if (role !== 'STUDENT' && role !== 'PARENT') {
      const subjects = await Subject.find({
        schoolId: normalizedSchoolId,
        ..._sessionFilter(sessionId),
      })
        .select('name _id')
        .sort({ name: 1 })
        .lean();
      return res.json({ success: true, data: subjects });
    }

    let targetStudent = null;

    if (role === 'STUDENT') {
      const userId = req.user._id || req.user.userId;
      targetStudent = await Student.findOne({
        userId,
        schoolId: normalizedSchoolId,
      })
        .select('_id classId schoolId sessionId')
        .lean();

      if (!targetStudent) {
        return res.json({ success: true, data: [] });
      }
    } else {
      const userId = req.user._id || req.user.userId;
      const parent = await Parent.findOne({ userId, schoolId: normalizedSchoolId })
        .select('children')
        .lean();

      if (!parent || !Array.isArray(parent.children) || parent.children.length === 0) {
        return res.json({ success: true, data: [] });
      }

      const requestedStudentId = req.query.studentId;
      let selectedStudentId = null;
      if (requestedStudentId && mongoose.Types.ObjectId.isValid(requestedStudentId)) {
        const allowed = parent.children.some(
          (cid) => cid?.toString() === requestedStudentId.toString()
        );
        if (allowed) selectedStudentId = requestedStudentId;
      }

      // Fallback: first linked child when caller does not pass studentId.
      selectedStudentId = selectedStudentId || parent.children[0];

      targetStudent = await Student.findOne({
        _id: selectedStudentId,
        schoolId: normalizedSchoolId,
      })
        .select('_id classId schoolId sessionId')
        .lean();

      if (!targetStudent) {
        return res.json({ success: true, data: [] });
      }
    }

    const targetSessionId = targetStudent.sessionId || sessionId;
    const subjects = await Subject.find({
      schoolId: targetStudent.schoolId,
      classId: targetStudent.classId,
      ..._sessionFilter(targetSessionId),
    })
      .select('name _id')
      .sort({ name: 1 })
      .lean();

    // Temporary debug logs for student/parent subject scoping.
    console.log('[Q&A][SUBJECTS] role=%s student=%s class=%s school=%s session=%s count=%d',
      role,
      targetStudent._id?.toString(),
      targetStudent.classId?.toString(),
      targetStudent.schoolId?.toString(),
      targetSessionId?.toString?.() || targetSessionId,
      subjects.length
    );
    console.log('[Q&A][SUBJECTS] names=%s', subjects.map((s) => s.name).join(', '));

    return res.json({ success: true, data: subjects });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const getTeachersForStudent = async (req, res) => {
  try {
    const { schoolId, sessionId } = req.user;
    const teachers = await Teacher.find({ schoolId, ..._sessionFilter(sessionId) })
      .select('_id userId')
      .populate('userId', 'name')
      .sort({ createdAt: -1 })
      .lean();
    return res.json({ success: true, data: teachers });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const deleteQuestion = async (req, res) => {
  try {
    const { id } = req.params;
    const { schoolId, _id: userId, role, sessionId } = req.user;

    const filter = { _id: id, schoolId, ..._sessionFilter(sessionId) };

    // Teachers can only delete questions assigned to them
    if (role === 'TEACHER') {
      const teacher = await Teacher.findOne({ userId, schoolId })
        .select('_id').lean();
      if (!teacher) {
        return res.status(403).json({
          success: false, message: 'Forbidden' });
      }
      filter.teacherId = teacher._id;
    }
    // PRINCIPAL and OPERATOR can delete any question in their school

    const question = await Question.findOneAndDelete(filter);
    if (!question) {
      return res.status(404).json({
        success: false, message: 'Question not found' });
    }

    _audit('QUESTION_DELETED', 'QUESTION', id,
      `Question deleted`, {}, req);

    return res.json({ success: true,
      message: 'Question deleted successfully' });
  } catch (err) {
    return res.status(500).json({
      success: false, message: err.message });
  }
};

module.exports = {
  askQuestion,
  getMyQuestions,
  getTeacherQuestions,
  answerQuestion,
  getAllQuestions,
  getSubjectsForStudent,
  getTeachersForStudent,
  deleteQuestion,
};
