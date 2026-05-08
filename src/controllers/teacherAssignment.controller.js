const mongoose = require('mongoose');
const TeacherAssignment = require('../models/TeacherAssignment.js');
const TimetableHoliday = require('../models/TimetableHoliday.js');
const Teacher = require('../models/Teacher.js');
const Student = require('../models/Student.js');
const AcademicHistory = require('../models/AcademicHistory.js');
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

    // Build session match — handles null/undefined sessionId correctly
    const sessionMatch = sessionId
      ? { $or: [{ sessionId }, { sessionId: null }, { sessionId: { $exists: false } }] }
      : { $or: [{ sessionId: null }, { sessionId: { $exists: false } }] };

    // 2) Teacher period conflict — same teacher, same day, same period
    // A teacher CAN teach different classes on different periods.
    // This only blocks: same teacher, same day, same period (any class).
    const teacherConflict = await TeacherAssignment.findOne({
      teacherId,
      day,
      periodNumber: Number(periodNumber),
      schoolId,
      ...sessionMatch,
    });
    if (teacherConflict) {
      const conflictClass = teacherConflict.classId?.name ||
        teacherConflict.classId?.toString() || 'another class';
      return res.status(HTTP_STATUS.CONFLICT).json({
        success: false,
        message: `Teacher already has Period ${periodNumber} on ${day} assigned to ${conflictClass}. Choose a different period.`,
      });
    }

    // 3) Class-section period conflict — same class+section, same day, same period
    // A class CAN have multiple teachers on different periods.
    // This only blocks: same class+section+day+period (two teachers at once).
    const classConflict = await TeacherAssignment.findOne({
      classId,
      sectionId,
      day,
      periodNumber: Number(periodNumber),
      schoolId,
      ...sessionMatch,
    });
    if (classConflict) {
      return res.status(HTTP_STATUS.CONFLICT).json({
        success: false,
        message: `Class-section already has a teacher in Period ${periodNumber} on ${day}. Choose a different period.`,
      });
    }

    const assignment = await TeacherAssignment.create({
      teacherId,
      classId,
      sectionId,
      subjectId,
      day,
      periodNumber: Number(periodNumber),
      startTime,
      endTime,
      schoolId,
      sessionId: sessionId || null
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
    const { date } = req.query;
    // classId intentionally NOT used as a filter here.
    // getAllBySchool must always return ALL assignments for the school.
    // The frontend's _applyFilter() handles per-class display filtering.
    // Filtering here caused switching classes to show empty grid because
    // _allAssignments only contained the previously loaded class's data.
    const filter = { schoolId, ...sessionFilter(req) };

    const assignments = await TeacherAssignment.find(filter)
      .populate({ path: 'teacherId', populate: { path: 'userId', select: 'name' } })
      .populate('classId', 'name')
      .populate('sectionId', 'name')
      .populate('subjectId', 'name')
      .sort({ day: 1, periodNumber: 1 })
      .lean();

    // If a specific date is requested, check if it is a holiday
    let isHoliday = false;
    let holidayReason = null;
    if (date) {
      const queryDate = new Date(date);
      queryDate.setHours(0, 0, 0, 0);
      const nextDay = new Date(queryDate);
      nextDay.setDate(nextDay.getDate() + 1);
      const holiday = await TimetableHoliday.findOne({
        schoolId,
        sessionId: req.user.sessionId,
        date: { $gte: queryDate, $lt: nextDay }
      });
      if (holiday) {
        isHoliday = true;
        holidayReason = holiday.reason;
      }
    }

    // Compute per-class publish status
    const classPublishMap = {};
    for (const a of assignments) {
      const cid = a.classId?._id?.toString() || a.classId?.toString();
      if (!cid) continue;
      if (!(cid in classPublishMap)) {
        classPublishMap[cid] = {
          published: true,
          weeklyRepeat: a.weeklyRepeat,
          totalSlots: 0,
          publishedSlots: 0,
        };
      }
      classPublishMap[cid].totalSlots++;
      if (a.isPublished) {
        classPublishMap[cid].publishedSlots++;
      } else {
        // Even one unpublished slot marks the class as needing re-publish
        classPublishMap[cid].published = false;
      }
    }
    // Add hasUnpublished flag: true when class has SOME published but ALSO
    // some unpublished (i.e. new slots added after last publish).
    for (const cid of Object.keys(classPublishMap)) {
      const entry = classPublishMap[cid];
      entry.hasUnpublished = entry.publishedSlots > 0 && !entry.published;
    }

    return res.status(200).json({
      success: true,
      data: assignments,
      classPublishStatus: classPublishMap,
      isHoliday,
      holidayReason
    });
  } catch (err) {
    logger.error('getAllBySchool error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST /api/teacher-assignments/publish — publish timetable for the school ──
const publishTimetable = async (req, res) => {
  try {
    const schoolId = req.user.schoolId;
    const sessionId = req.user.sessionId;
    const { classId, weeklyRepeat } = req.body || {};

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        message: 'No active academic session found.'
      });
    }

    const publishFilter = { schoolId, sessionId };
    if (classId) publishFilter.classId = classId;

    const updateFields = { isPublished: true };
    if (typeof weeklyRepeat === 'boolean') {
      updateFields.weeklyRepeat = weeklyRepeat;
    }

    const result = await TeacherAssignment.updateMany(
      publishFilter,
      { $set: updateFields }
    );

    const scope = classId ? `class ${classId}` : 'all classes';
    logger.info(`Timetable published for school ${schoolId} (${scope}): ${result.modifiedCount} slots`);

    return res.status(200).json({
      success: true,
      message: `Timetable published. ${result.modifiedCount} slots updated.`,
      modifiedCount: result.modifiedCount,
      classId: classId || null,
      weeklyRepeat: weeklyRepeat ?? false
    });
  } catch (err) {
    logger.error('publishTimetable error:', err);
    return res.status(500).json({ success: false, message: err.message });
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

    // Build session match explicitly to avoid spread issues
    const sid = req.user?.sessionId;
    const sessionMatch = sid
      ? { $or: [{ sessionId: sid }, { sessionId: null }, { sessionId: { $exists: false } }] }
      : { $or: [{ sessionId: null }, { sessionId: { $exists: false } }] };

    const assignments = await TeacherAssignment.find({
      teacherId: teacher._id,
      schoolId,
      isPublished: true,
      ...sessionMatch,
    })
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
    const { schoolId, sessionId, isBrowsingHistory } = req.user;
    const resolvedUserId = req.user.userId || req.user._id;

    const schoolObjectId = mongoose.Types.ObjectId.isValid(schoolId)
      ? new mongoose.Types.ObjectId(schoolId)
      : null;
    if (!schoolObjectId) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ success: false, message: 'Invalid schoolId' });
    }

    let classId;
    let sectionId;

    if (isBrowsingHistory) {
      const student = await Student.findOne({
        userId: resolvedUserId,
        schoolId: schoolObjectId,
      }).select('_id');
      if (!student) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({ success: false, message: 'Student not found' });
      }

      const historyRecord = await AcademicHistory.findOne({
        studentId: student._id,
        schoolId: schoolObjectId,
        sessionId,
      }).select('classId sectionId');

      if (!historyRecord?.classId) {
        return res.status(HTTP_STATUS.OK).json({ success: true, data: [] });
      }

      classId = historyRecord.classId;
      sectionId = historyRecord.sectionId || null;
    } else {
      const student = await Student.findOne({
        userId: resolvedUserId,
        schoolId: schoolObjectId,
      })
        .select('classId sectionId');
      if (!student) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({ success: false, message: 'Student profile not found' });
      }

      classId = student.classId;
      sectionId = student.sectionId;
    }

    if (!classId) {
      return res.status(HTTP_STATUS.OK).json({ success: true, data: [] });
    }

    // Build session match the same way as sessionFilter() helper
    const sid = sessionId;
    const sessionMatch = sid
      ? { $or: [{ sessionId: sid }, { sessionId: null }, { sessionId: { $exists: false } }] }
      : { $or: [{ sessionId: null }, { sessionId: { $exists: false } }] };

    // Build the base query — do NOT use plain sessionId field;
    // use sessionMatch spread to handle ObjectId vs string mismatch.
    const baseQuery = {
      schoolId: schoolObjectId,
      isPublished: true,
      classId,
      ...sessionMatch,
    };

    // If sectionId exists, filter by section OR no section assigned.
    // We must use $and to combine sessionMatch.$or with sectionId.$or.
    let finalQuery;
    if (sectionId) {
      finalQuery = {
        ...baseQuery,
        $and: [
          sessionMatch,
          {
            $or: [
              { sectionId },
              { sectionId: null },
              { sectionId: { $exists: false } },
            ],
          },
        ],
      };
      // Remove the top-level sessionMatch $or since it's now in $and
      delete finalQuery.$or;
    } else {
      finalQuery = baseQuery;
    }

    const assignments = await TeacherAssignment.find(finalQuery)
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

// ── GET /api/teacher-assignments/publish-status?classId= ─────────────
const getPublishStatus = async (req, res) => {
  try {
    const schoolId = req.user.schoolId;
    const sessionId = req.user.sessionId;
    const { classId } = req.query;

    if (!sessionId) {
      return res.status(400).json({ success: false, message: 'No active session' });
    }

    const filter = { schoolId, sessionId };
    if (classId) filter.classId = classId;

    const assignments = await TeacherAssignment.find(filter)
      .select('classId isPublished weeklyRepeat')
      .lean();

    if (assignments.length === 0) {
      return res.status(200).json({
        success: true,
        isPublished: false,
        weeklyRepeat: false,
        classId: classId || null,
        totalSlots: 0,
        publishedSlots: 0
      });
    }

    const publishedCount = assignments.filter(a => a.isPublished).length;
    const isPublished = publishedCount === assignments.length && assignments.length > 0;
    const weeklyRepeat = assignments.length > 0 && assignments[0].weeklyRepeat === true;

    return res.status(200).json({
      success: true,
      isPublished,
      weeklyRepeat,
      classId: classId || null,
      totalSlots: assignments.length,
      publishedSlots: publishedCount
    });
  } catch (err) {
    logger.error('getPublishStatus error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST /api/teacher-assignments/holidays ────────────────────────────
const addHoliday = async (req, res) => {
  try {
    const schoolId = req.user.schoolId;
    const sessionId = req.user.sessionId;
    const { date, reason } = req.body;

    if (!date) {
      return res.status(400).json({ success: false, message: 'date is required (YYYY-MM-DD)' });
    }

    const parsedDate = new Date(date);
    if (isNaN(parsedDate.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid date format. Use YYYY-MM-DD.' });
    }
    parsedDate.setHours(0, 0, 0, 0);

    const holiday = await TimetableHoliday.findOneAndUpdate(
      { schoolId, sessionId, date: parsedDate },
      { $set: { reason: reason || 'Holiday', createdBy: req.user.userId } },
      { upsert: true, new: true }
    );

    return res.status(200).json({
      success: true,
      message: 'Holiday marked successfully',
      data: holiday
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ success: false, message: 'Holiday already marked for this date' });
    }
    logger.error('addHoliday error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── DELETE /api/teacher-assignments/holidays ──────────────────────────
const removeHoliday = async (req, res) => {
  try {
    const schoolId = req.user.schoolId;
    const sessionId = req.user.sessionId;
    const { date } = req.body;

    if (!date) {
      return res.status(400).json({ success: false, message: 'date is required' });
    }

    const parsedDate = new Date(date);
    parsedDate.setHours(0, 0, 0, 0);
    const nextDay = new Date(parsedDate);
    nextDay.setDate(nextDay.getDate() + 1);

    const deleted = await TimetableHoliday.findOneAndDelete({
      schoolId,
      sessionId,
      date: { $gte: parsedDate, $lt: nextDay }
    });

    if (!deleted) {
      return res.status(404).json({ success: false, message: 'No holiday found for this date' });
    }

    return res.status(200).json({ success: true, message: 'Holiday removed' });
  } catch (err) {
    logger.error('removeHoliday error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/teacher-assignments/holidays — list all holidays ─────────
const getHolidays = async (req, res) => {
  try {
    const schoolId = req.user.schoolId;
    const sessionId = req.user.sessionId;

    const holidays = await TimetableHoliday.find({ schoolId, sessionId })
      .sort({ date: 1 })
      .lean();

    return res.status(200).json({ success: true, data: holidays });
  } catch (err) {
    logger.error('getHolidays error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/teacher-assignments/date?date=YYYY-MM-DD — timetable for a specific date ──
// Used by students/teachers to see what was scheduled on any past or future date.
// Respects weeklyRepeat: if the timetable repeats weekly, the day-of-week is used.
const getTimetableByDate = async (req, res) => {
  try {
    const { date, classId, sectionId } = req.query;
    const schoolId = req.user.schoolId;
    const sessionId = req.user.sessionId;

    if (!date) {
      return res.status(400).json({ success: false, message: 'date query param is required (YYYY-MM-DD)' });
    }

    const targetDate = new Date(date);
    if (isNaN(targetDate.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid date format. Use YYYY-MM-DD.' });
    }

    // Check if this date is a holiday
    targetDate.setHours(0, 0, 0, 0);
    const nextDay = new Date(targetDate);
    nextDay.setDate(nextDay.getDate() + 1);

    const holiday = await TimetableHoliday.findOne({
      schoolId,
      sessionId,
      date: { $gte: targetDate, $lt: nextDay }
    });

    if (holiday) {
      return res.status(200).json({
        success: true,
        data: [],
        isHoliday: true,
        holidayReason: holiday.reason,
        date
      });
    }

    // Get day name from the date
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayName = dayNames[targetDate.getDay()];

    if (dayName === 'Sunday') {
      return res.status(200).json({
        success: true,
        data: [],
        isHoliday: false,
        isSunday: true,
        date
      });
    }

    // Find published assignments for this school/session matching day-of-week
    const sid2 = req.user?.sessionId;
    const sessionMatch2 = sid2
      ? { $or: [{ sessionId: sid2 }, { sessionId: null }, { sessionId: { $exists: false } }] }
      : { $or: [{ sessionId: null }, { sessionId: { $exists: false } }] };

    const filter = {
      schoolId,
      isPublished: true,
      day: dayName,
      ...sessionMatch2,
    };
    if (classId) filter.classId = classId;
    if (sectionId) filter.sectionId = sectionId;

    const assignments = await TeacherAssignment.find(filter)
      .populate({ path: 'teacherId', populate: { path: 'userId', select: 'name' } })
      .populate('classId', 'name')
      .populate('sectionId', 'name')
      .populate('subjectId', 'name')
      .sort({ periodNumber: 1 })
      .lean();

    return res.status(200).json({
      success: true,
      data: assignments,
      isHoliday: false,
      dayName,
      date
    });
  } catch (err) {
    logger.error('getTimetableByDate error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  createAssignment,
  getByTeacher,
  getByClass,
  getAllBySchool,
  publishTimetable,
  deleteAssignment,
  getMyTimetable,
  getStudentClassTimetable,
  getPublishStatus,
  addHoliday,
  removeHoliday,
  getHolidays,
  getTimetableByDate
};