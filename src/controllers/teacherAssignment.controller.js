const TeacherAssignment = require('../models/TeacherAssignment.js');
const Teacher = require('../models/Teacher.js');
const { HTTP_STATUS } = require('../config/constants.js');
const { logger } = require('../utils/logger.js');

// ── POST /api/teacher-assignments ────────────────────────────────────────────
const createAssignment = async (req, res) => {
  try {
    const { teacherId, classId, sectionId, subjectId, day, periodNumber, startTime, endTime } = req.body;
    const schoolId = req.user.schoolId;
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
    const assignments = await TeacherAssignment.find({ teacherId, schoolId })
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
    const filter = { classId, schoolId };
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
    const deleted = await TeacherAssignment.findOneAndDelete({ _id: id, schoolId });
    if (!deleted) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ success: false, message: 'Assignment not found' });
    }
    return res.status(HTTP_STATUS.OK).json({ success: true, message: 'Assignment deleted' });
  } catch (err) {
    logger.error('deleteAssignment error:', err);
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ success: false, message: err.message });
  }
};

module.exports = { createAssignment, getByTeacher, getByClass, deleteAssignment };
