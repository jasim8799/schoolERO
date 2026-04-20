const TeacherAssignment = require('../models/TeacherAssignment.js');
const Teacher = require('../models/Teacher.js');
const Student = require('../models/Student.js');
const { HTTP_STATUS } = require('../config/constants.js');
const { logger } = require('../utils/logger.js');

const sessionFilter = (req) => {
  const sid = req.user?.sessionId;
  if (!sid) return {};
  return {
    $or: [
      { sessionId: sid },
      { sessionId: null },
      { sessionId: { $exists: false } },
    ],
  };
};

// ── POST /api/teacher-assignments ────────────────────────────────────────────
const createAssignment = async (req, res) => {
  try {
    const { teacherId, classId, sectionId, subjectId, day, periodNumber, startTime, endTime } = req.body;
    const schoolId = req.user.schoolId._id || req.user.schoolId;
    const sessionId = req.user.sessionId;

    if (!teacherId || !classId || !sectionId || !subjectId || !day || !periodNumber || !startTime || !endTime) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'teacherId, classId, sectionId, subjectId, day, periodNumber, startTime and endTime are all required'
      });
    }

    // Verify teacher belongs to this school
    const teacher = await Teacher.findOne({ _id: teacherId, schoolId });
    if (!teacher) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ success: false, message: 'Teacher not found in this school' });
    }

    // 1) Existing teacher-subject assignment in class/section (allowed across different periods)
    await TeacherAssignment.findOne({
      teacherId,
      classId,
      sectionId,
      subjectId,
      schoolId,
      sessionId,
    });

    // 2) Teacher period conflict for same day + period
    const teacherConflict = await TeacherAssignment.findOne({
      teacherId,
      day,
      periodNumber,
      schoolId,
      sessionId,
    });
    if (teacherConflict) {
      return res.status(HTTP_STATUS.CONFLICT).json({
        success: false,
        message: `Teacher already has a class in Period ${periodNumber} on ${day}`,
      });
    }

    // 3) Class-section period conflict for same day + period
    const classConflict = await TeacherAssignment.findOne({
      classId,
      sectionId,
      day,
      periodNumber,
      schoolId,
      sessionId,
    });
    if (classConflict) {
      return res.status(HTTP_STATUS.CONFLICT).json({
        success: false,
        message: `This class-section already has a subject in Period ${periodNumber} on ${day}`,
      });
    }

    const assignment = await TeacherAssignment.create({
      teacherId,
      classId,
      sectionId,
      subjectId,
      day,
      periodNumber,
      startTime,
      endTime,
      schoolId,
      sessionId
    });

    const populated = await TeacherAssignment.findById(assignment._id)
      .populate('teacherId', 'userId')
      .populate({ path: 'teacherId', populate: { path: 'userId', select: 'name' } })
      .populate('classId', 'name')
      .populate('sectionId', 'name')
      .populate('subjectId', 'name');

    logger.info(`TeacherAssignment created: ${assignment._id}`);
    return res.status(HTTP_STATUS.CREATED).json({ success: true, data: populated });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(HTTP_STATUS.CONFLICT).json({
        success: false,
        code: 'PERIOD_CONFLICT',
        message: 'A period conflict exists — either this class/section/day/period is already occupied, or the teacher is already booked at that time.'
      });
    }
    logger.error('createAssignment error:', err);
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ success: false, message: err.message });
  }
};

// ── GET /api/teacher-assignments?teacherId= ───────────────────────────────────
const getByTeacher = async (req, res) => {
  try {
    const { teacherId } = req.query;
    const schoolId = req.user.schoolId;
    if (!teacherId) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ success: false, message: 'teacherId query param is required' });
    }
    const assignments = await TeacherAssignment.find({ teacherId, schoolId, ...sessionFilter(req) })
      .populate('classId', 'name')
      .populate('sectionId', 'name')
      .populate('subjectId', 'name')
      .sort({ day: 1, periodNumber: 1 });
    return res.status(HTTP_STATUS.OK).json({ success: true, data: assignments });
  } catch (err) {
    logger.error('getByTeacher error:', err);
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ success: false, message: err.message });
  }
};

// ── GET /api/teacher-assignments/class?classId=&sectionId= ───────────────────
const getByClass = async (req, res) => {
  try {
    const { classId, sectionId } = req.query;
    const schoolId = req.user.schoolId;
    if (!classId) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ success: false, message: 'classId query param is required' });
    }
    const filter = { classId, schoolId, ...sessionFilter(req) };
    if (sectionId) filter.sectionId = sectionId;
    const assignments = await TeacherAssignment.find(filter)
      .populate({ path: 'teacherId', populate: { path: 'userId', select: 'name' } })
      .populate('classId', 'name')
      .populate('sectionId', 'name')
      .populate('subjectId', 'name')
      .sort({ day: 1, periodNumber: 1 });
    return res.status(HTTP_STATUS.OK).json({ success: true, data: assignments });
  } catch (err) {
    logger.error('getByClass error:', err);
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ success: false, message: err.message });
  }
};

// ── DELETE /api/teacher-assignments/:id ──────────────────────────────────────
const deleteAssignment = async (req, res) => {
  try {
    const { id } = req.params;
    const schoolId = req.user.schoolId;
    const sessionId = req.user.sessionId;
    const deleted = await TeacherAssignment.findOneAndDelete({ _id: id, schoolId, sessionId });
    if (!deleted) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ success: false, message: 'Assignment not found' });
    }
    return res.status(HTTP_STATUS.OK).json({ success: true, message: 'Assignment deleted' });
  } catch (err) {
    logger.error('deleteAssignment error:', err);
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ success: false, message: err.message });
  }
};

// ── GET /api/teacher-assignments/all — all assignments for the school ─────────
const getAllBySchool = async (req, res) => {
  try {
    const schoolId = req.user.schoolId;
    const assignments = await TeacherAssignment.find({ schoolId, ...sessionFilter(req) })
      .populate({ path: 'teacherId', populate: { path: 'userId', select: 'name' } })
      .populate('classId', 'name')
      .populate('sectionId', 'name')
      .populate('subjectId', 'name')
      .sort({ day: 1, periodNumber: 1 });
    return res.status(HTTP_STATUS.OK).json({ success: true, data: assignments });
  } catch (err) {
    logger.error('getAllBySchool error:', err);
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ success: false, message: err.message });
  }
};

// ── POST /api/teacher-assignments/publish — publish timetable for the school ──
const publishTimetable = async (req, res) => {
  try {
    const schoolId = req.user.schoolId;
    const sessionId = req.user.sessionId;
    const { classId } = req.body || {};
    const publishFilter = { schoolId, sessionId };
    if (classId) publishFilter.classId = classId;
    const result = await TeacherAssignment.updateMany(publishFilter, { $set: { isPublished: true } });
    logger.info(`Timetable published for school ${schoolId}: ${result.modifiedCount} slots updated`);
    return res.status(HTTP_STATUS.OK).json({
      success: true,
      message: `Timetable published successfully. ${result.modifiedCount} slots updated.`
    });
  } catch (err) {
    logger.error('publishTimetable error:', err);
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ success: false, message: err.message });
  }
};

// ── GET /api/teacher-assignments/my — teacher sees own published timetable ────
const getMyTimetable = async (req, res) => {
  try {
    const userId = req.user.userId || req.user._id;
    const schoolId = req.user.schoolId;

    const teacher = await Teacher.findOne({ userId, schoolId });
    if (!teacher) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ success: false, message: 'Teacher profile not found' });
    }

    const assignments = await TeacherAssignment.find({ teacherId: teacher._id, schoolId, isPublished: true, ...sessionFilter(req) })
      .populate('classId', 'name')
      .populate('sectionId', 'name')
      .populate('subjectId', 'name')
      .sort({ day: 1, periodNumber: 1 });

    return res.status(HTTP_STATUS.OK).json({ success: true, data: assignments });
  } catch (err) {
    logger.error('getMyTimetable error:', err);
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ success: false, message: err.message });
  }
};

// ── GET /api/teacher-assignments/student/me — student sees published class timetable
const getStudentClassTimetable = async (req, res) => {
  try {
    const userId = req.user.userId || req.user._id;
    const schoolId = req.user.schoolId;

    const student = await Student.findOne({ userId, schoolId, status: 'ACTIVE', ...sessionFilter(req) });
    if (!student) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ success: false, message: 'Student profile not found' });
    }

    const assignments = await TeacherAssignment.find({
      classId: student.classId,
      sectionId: student.sectionId,
      schoolId,
      ...sessionFilter(req),
      isPublished: true
    })
      .populate({ path: 'teacherId', populate: { path: 'userId', select: 'name' } })
      .populate('classId', 'name')
      .populate('sectionId', 'name')
      .populate('subjectId', 'name')
      .sort({ day: 1, periodNumber: 1 });

    return res.status(HTTP_STATUS.OK).json({ success: true, data: assignments });
  } catch (err) {
    logger.error('getStudentClassTimetable error:', err);
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ success: false, message: err.message });
  }
};

module.exports = { createAssignment, getByTeacher, getByClass, getAllBySchool, publishTimetable, deleteAssignment, getMyTimetable, getStudentClassTimetable };