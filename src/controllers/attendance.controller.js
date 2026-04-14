// Stub for getStaffMembers
const getStaffMembers = async (req, res) => {
  return res.status(200).json({ success: true, message: 'Get staff members endpoint stub.' });
};
// Stub for getAttendanceSummary
const getAttendanceSummary = async (req, res) => {
  return res.status(200).json({ success: true, message: 'Attendance summary endpoint stub.' });
};
// Stub for markStaffAttendance
const markStaffAttendance = async (req, res) => {
  return res.status(200).json({ success: true, message: 'Mark staff attendance endpoint stub.' });
};
// Stub for markSubjectAttendance
const markSubjectAttendance = async (req, res) => {
  return res.status(200).json({ success: true, message: 'Mark subject attendance endpoint stub.' });
};
const StudentDailyAttendance = require('../models/StudentDailyAttendance.js');
const StudentSubjectAttendance = require('../models/StudentSubjectAttendance.js');
const TeacherAttendance = require('../models/TeacherAttendance.js');
const StaffAttendance = require('../models/StaffAttendance.js');
const Student = require('../models/Student.js');
const User = require('../models/User.js');
const Parent = require('../models/Parent.js');
const Subject = require('../models/Subject.js');
const TeacherAssignment = require('../models/TeacherAssignment.js');
const AcademicSession = require('../models/AcademicSession.js');
const { auditLog } = require('../utils/auditLog.js');

// Utility
const normalizeDate = (d) => {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  return date;
};

// All function definitions (const style)

const markStudentDailyAttendance = async (req, res) => {
  try {
    // TODO: Implement real logic
    res.status(200).json({
      success: true,
      message: 'Student daily attendance marked (stub)'
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getStudentDailyAttendance = async (req, res) => {
  try {
    const { classId, sectionId, date, startDate, endDate } = req.query;
    const { schoolId } = req.user;
    const normalizedSchoolId = schoolId?._id || schoolId;

    const activeSession = await AcademicSession.findOne({
      schoolId: normalizedSchoolId,
      isActive: true
    });

    if (!activeSession) {
      return res.status(400).json({
        success: false,
        message: 'No active academic session found for this school'
      });
    }

    const filter = {
      schoolId: normalizedSchoolId,
      sessionId: activeSession._id,
    };

    if (classId) filter.classId = classId;
    if (sectionId) filter.sectionId = sectionId;
    if (date) {
      filter.date = normalizeDate(date);
    }

    if (startDate && endDate) {
      const start = normalizeDate(startDate);
      const end = new Date(normalizeDate(endDate));
      end.setHours(23, 59, 59, 999);
      filter.date = { $gte: start, $lte: end };
    }


    const attendance = await StudentDailyAttendance.find(filter)
      .populate('studentId', 'name rollNumber')
      .populate('classId', 'name')
      .populate('sectionId', 'name')
      .populate('markedBy', 'name')
      .sort({ date: -1, studentId: 1 });

    res.status(200).json({
      success: true,
      data: attendance,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

const getSubjectAttendance = async (req, res) => {
  try {
    const { classId, subjectId, date, studentId } = req.query;
    const { schoolId } = req.user;
    const normalizedSchoolId = schoolId?._id || schoolId;

    const activeSession = await AcademicSession.findOne({
      schoolId: normalizedSchoolId,
      isActive: true
    });

    if (!activeSession) {
      return res.status(400).json({
        success: false,
        message: 'No active academic session found for this school'
      });
    }

    const filter = {
      schoolId: normalizedSchoolId,
      sessionId: activeSession._id,
    };

    if (classId) filter.classId = classId;
    if (subjectId) filter.subjectId = subjectId;
    if (date) {
      filter.date = normalizeDate(date);
    }
    if (studentId) filter.studentId = studentId;

    const attendance = await StudentSubjectAttendance.find(filter)
      .populate('studentId', 'name rollNumber')
      .populate('subjectId', 'name')
      .populate('classId', 'name')
      .populate('teacherId', 'name')
      .sort({ date: -1 });

    res.status(200).json({
      success: true,
      data: attendance,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/attendance/students/subject/period-summary
// Query: classId, subjectId, date (optional), month (optional YYYY-MM)
const getPeriodWiseSummary = async (req, res) => {
  try {
    const { classId, subjectId, date, month } = req.query;
    const { schoolId } = req.user;
    const normalizedSchoolId = schoolId?._id || schoolId;

    const activeSession = await AcademicSession.findOne({
      schoolId: normalizedSchoolId,
      isActive: true,
    });
    if (!activeSession) {
      return res.status(400).json({ success: false, message: 'No active session' });
    }

    const filter = {
      schoolId: normalizedSchoolId,
      sessionId: activeSession._id,
    };
    if (classId) filter.classId = classId;
    if (subjectId) filter.subjectId = subjectId;

    if (date) {
      filter.date = normalizeDate(date);
    } else if (month) {
      const [y, m] = month.split('-').map(Number);
      filter.date = {
        $gte: new Date(y, m - 1, 1),
        $lte: new Date(y, m, 0, 23, 59, 59),
      };
    }

    const records = await StudentSubjectAttendance.find(filter).lean();

    const periodMap = {};
    for (const rec of records) {
      const period = rec.period ?? 0;
      if (!periodMap[period]) {
        periodMap[period] = { period, present: 0, absent: 0, total: 0 };
      }
      periodMap[period].total++;
      if (rec.status === 'PRESENT') periodMap[period].present++;
      else periodMap[period].absent++;
    }

    const summary = Object.values(periodMap)
      .sort((a, b) => a.period - b.period)
      .map((p) => ({
        ...p,
        percentage: p.total > 0 ? Math.round((p.present / p.total) * 100) : 0,
        label: p.period === 0 ? 'All Periods' : `Period ${p.period}`,
      }));

    return res.json({ success: true, data: summary });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const markTeacherAttendance = async (req, res) => {
  try {
    const { date, status, checkIn, checkOut, teacherId: targetTeacherId } = req.body;
    const { userId, role, schoolId } = req.user;
    const normalizedSchoolId = schoolId?._id || schoolId;

    // Role-based access
    if (role === 'STUDENT' || role === 'PARENT') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const activeSession = await AcademicSession.findOne({
      schoolId: normalizedSchoolId,
      isActive: true
    });

    if (!activeSession) {
      return res.status(400).json({
        success: false,
        message: 'No active academic session found for this school'
      });
    }

    let teacherId = userId;

    if (role === 'TEACHER') {
      if (targetTeacherId) {
        return res.status(403).json({ success: false, message: 'Teachers can only mark their own attendance' });
      }
      // Date validation for teachers
      const today = new Date().toISOString().split('T')[0];
      if (date !== today) {
        return res.status(400).json({ success: false, message: 'Teachers can only mark attendance for today' });
      }
    } else if (role === 'OPERATOR' || role === 'PRINCIPAL' || role === 'SUPER_ADMIN') {
      if (targetTeacherId) {
        teacherId = targetTeacherId;
      }
    }

    // Validate status
    if (!['PRESENT', 'ABSENT'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status. Only PRESENT or ABSENT allowed.' });
    }

    // Validate time format if provided
    const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
    if (checkIn && !timeRegex.test(checkIn)) {
      return res.status(400).json({ success: false, message: 'Invalid checkIn time format. Use HH:mm.' });
    }
    if (checkOut && !timeRegex.test(checkOut)) {
      return res.status(400).json({ success: false, message: 'Invalid checkOut time format. Use HH:mm.' });
    }

    // Verify target teacher user exists and belongs to school
    const teacherUser = await User.findOne({
      _id: teacherId,
      schoolId: normalizedSchoolId,
      role: 'TEACHER'
    });
    if (!teacherUser) {
      return res.status(404).json({ success: false, message: 'Teacher not found or does not belong to this school' });
    }

    // Check if attendance already exists
    const attendanceDate = normalizeDate(date);
    const existingAttendance = await TeacherAttendance.findOne({
      teacherId,
      date: attendanceDate,
      schoolId: normalizedSchoolId
    });

    if (existingAttendance && role === 'TEACHER') {
      return res.status(400).json({ success: false, message: 'Attendance already marked for today. Contact admin to update.' });
    }

    if (existingAttendance && role !== 'TEACHER') {
      // Allow overwrite for non-TEACHER roles
    }

    const result = await TeacherAttendance.findOneAndUpdate(
      {
        teacherId: teacherId,
        date: attendanceDate,
        schoolId: normalizedSchoolId,
      },
      {
        $set: {
          status: status,
          checkIn: checkIn,
          checkOut: checkOut,
          sessionId: activeSession._id,
        },
      },
      {
        upsert: true,
        new: true,
      }
    );

    await auditLog({
      action: 'TEACHER_ATTENDANCE_MARKED',
      userId: req.user.userId,
      schoolId,
      details: {
        teacherId,
        date,
        status,
        markedByRole: req.user.role
      },
      req
    });

    res.status(200).json({
      success: true,
      message: 'Teacher attendance marked successfully',
      data: result,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getTeacherAttendance = async (req, res) => {
  try {
    const { date, startDate, endDate, teacherId } = req.query;
    const { userId, role, schoolId } = req.user;
    const normalizedSchoolId = schoolId?._id || schoolId;

    if (role === 'STUDENT' || role === 'PARENT') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const activeSession = await AcademicSession.findOne({
      schoolId: normalizedSchoolId,
      isActive: true
    });

    if (!activeSession) {
      return res.status(400).json({
        success: false,
        message: 'No active academic session found for this school'
      });
    }

    const filter = {
      schoolId: normalizedSchoolId,
      sessionId: activeSession._id,
    };

    if (role === 'TEACHER' && !teacherId) {
      filter.teacherId = userId;
    } else if (teacherId) {
      filter.teacherId = teacherId;
    }

    if (date) {
      filter.date = normalizeDate(date);
    }
    if (startDate && endDate) {
      const start = normalizeDate(startDate);
      const end = new Date(normalizeDate(endDate));
      end.setHours(23, 59, 59, 999);
      filter.date = { $gte: start, $lte: end };
    }

    const attendance = await TeacherAttendance.find(filter)
      .populate('teacherId', 'name email')
      .sort({ date: -1 });

    res.status(200).json({
      success: true,
      data: attendance,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getParentAttendance = async (req, res) => {
  try {
    const { userId, schoolId } = req.user;
    const { startDate, endDate } = req.query;
    const normalizedSchoolId = schoolId?._id || schoolId;

    const activeSession = await AcademicSession.findOne({
      schoolId: normalizedSchoolId,
      isActive: true
    });

    if (!activeSession) {
      return res.status(400).json({
        success: false,
        message: 'No active academic session found for this school'
      });
    }

    const parent = await Parent.findOne({ userId, schoolId: normalizedSchoolId });
    if (!parent) {
      return res.status(404).json({ success: false, message: 'Parent record not found' });
    }

    if (!parent.children || parent.children.length === 0) {
      return res.status(200).json({ success: true, data: [] });
    }

    const filter = {
      _id: { $in: parent.children },
      schoolId: normalizedSchoolId,
      sessionId: activeSession._id,
    };

    const children = await Student.find(filter)
      .select('_id name rollNumber classId sectionId')
      .populate('classId', 'name')
      .populate('sectionId', 'name')
      .sort({ name: 1 });

    res.status(200).json({
      success: true,
      data: children,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getAttendanceForParent = async (req, res) => {
  try {
    const { studentId } = req.params;
    const { userId, schoolId } = req.user;
    const normalizedSchoolId = schoolId?._id || schoolId;

    const activeSession = await AcademicSession.findOne({
      schoolId: normalizedSchoolId,
      isActive: true
    });

    if (!activeSession) {
      return res.status(400).json({
        success: false,
        message: 'No active academic session found for this school'
      });
    }

    const parent = await Parent.findOne({ userId, schoolId: normalizedSchoolId });
    if (!parent) {
      return res.status(404).json({ success: false, message: 'Parent record not found' });
    }

    if (!parent.children.some(id => id.toString() === studentId.toString())) {
      return res.status(403).json({ success: false, message: 'Access denied. Student not associated with this parent.' });
    }

    const student = await Student.findById(studentId)
      .populate('classId', 'name')
      .populate('sectionId', 'name');

    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }

    const attendance = await StudentDailyAttendance.find({
      studentId,
      schoolId: normalizedSchoolId,
      sessionId: activeSession._id
    }).sort({ date: -1 });

    const records = attendance.map(att => ({
      date: att.date,
      status: att.status
    }));

    res.status(200).json({
      success: true,
      student: {
        name: student.name,
        rollNumber: student.rollNumber,
        class: student.classId.name,
        section: student.sectionId.name
      },
      data: records,
      attendance: records,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getStudentSelfAttendance = async (req, res) => {
  try {
    const { userId, schoolId } = req.user;
    const { startDate, endDate } = req.query;
    const normalizedSchoolId = schoolId?._id || schoolId;

    const activeSession = await AcademicSession.findOne({
      schoolId: normalizedSchoolId,
      isActive: true
    });

    if (!activeSession) {
      return res.status(400).json({
        success: false,
        message: 'No active academic session found for this school'
      });
    }

    const student = await Student.findOne({ userId, schoolId: normalizedSchoolId })
      .populate('classId', 'name')
      .populate('sectionId', 'name');

    if (!student) {
      return res.status(404).json({ success: false, message: 'Student record not found' });
    }

    const filter = {
      studentId: student._id,
      schoolId: normalizedSchoolId,
      sessionId: activeSession._id,
    };

    if (startDate && endDate) {
      const start = normalizeDate(startDate);
      const end = new Date(normalizeDate(endDate));
      end.setHours(23, 59, 59, 999);
      filter.date = { $gte: start, $lte: end };
    }

    const attendance = await StudentDailyAttendance.find(filter).sort({ date: -1 });

    const records = attendance.map(att => ({
      date: att.date,
      status: att.status
    }));

    res.status(200).json({
      success: true,
      student: {
        name: student.name,
        rollNumber: student.rollNumber,
        class: student.classId.name,
        section: student.sectionId.name
      },
      data: records,
      attendance: records,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const checkDuplicateAttendance = async (req, res) => {
  try {
    const { classId, sectionId, date } = req.query;
    const { schoolId } = req.user;
    const normalizedSchoolId = schoolId?._id || schoolId;

    if (!classId || !date) {
      return res.status(400).json({ success: false, message: 'classId and date are required' });
    }

    const activeSession = await AcademicSession.findOne({
      schoolId: normalizedSchoolId,
      isActive: true
    });

    if (!activeSession) {
      return res.status(400).json({ success: false, message: 'No active academic session found for this school' });
    }

    const filter = {
      schoolId: normalizedSchoolId,
      sessionId: activeSession._id,
      classId,
      date: normalizeDate(date),
    };

    if (sectionId) {
      filter.sectionId = sectionId;
    }

    const exists = await StudentDailyAttendance.exists(filter);

    return res.status(200).json({
      success: true,
      exists: !!exists,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/attendance/check-late-threshold
// Body: { checkIn: "09:15", schoolStartTime: "09:00" }
const checkLateThreshold = async (req, res) => {
  try {
    const { checkIn, schoolStartTime = '09:00' } = req.body;
    if (!checkIn) {
      return res.status(400).json({ success: false, message: 'checkIn is required' });
    }

    const [startH, startM] = schoolStartTime.split(':').map(Number);
    const [checkH, checkM] = checkIn.split(':').map(Number);
    const startMinutes = startH * 60 + startM;
    const checkMinutes = checkH * 60 + checkM;
    const diffMinutes = checkMinutes - startMinutes;

    let suggestedStatus = 'PRESENT';
    let message = 'On time';

    if (diffMinutes > 30) {
      suggestedStatus = 'LATE';
      message = `${diffMinutes} minutes late - marked as LATE`;
    } else if (diffMinutes > 0) {
      suggestedStatus = 'PRESENT';
      message = `${diffMinutes} minutes late but within grace period`;
    }

    return res.json({
      success: true,
      data: { isLate: diffMinutes > 30, diffMinutes, suggestedStatus, message },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/attendance/students/daily/teacher/:teacherId
const getStudentAttendanceByTeacher = async (req, res) => {
  try {
    const { teacherId } = req.params;
    const { date } = req.query;
    const { schoolId } = req.user;
    const normalizedSchoolId = schoolId?._id || schoolId;

    const activeSession = await AcademicSession.findOne({
      schoolId: normalizedSchoolId,
      isActive: true,
    });

    if (!activeSession) {
      return res.status(400).json({ success: false, message: 'No active session' });
    }

    const filter = {
      schoolId: normalizedSchoolId,
      sessionId: activeSession._id,
      markedBy: teacherId,
    };

    if (date) {
      filter.date = normalizeDate(date);
    }

    const records = await StudentDailyAttendance.find(filter)
      .populate('studentId', 'name rollNumber')
      .populate('classId', 'name')
      .populate('sectionId', 'name')
      .sort({ date: -1 });

    return res.json({ success: true, data: records });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/attendance/teacher/class-students?classId=&sectionId=
const getTeacherClassStudents = async (req, res) => {
  try {
    const { classId, sectionId } = req.query;
    const { userId, schoolId } = req.user;

    // ── Normalize schoolId to ObjectId ────────────────────────────────────
    const mongoose = require('mongoose');
    let normalizedSchoolId;
    try {
      normalizedSchoolId = new mongoose.Types.ObjectId(schoolId?._id || schoolId);
    } catch (_) {
      return res.status(400).json({ success: false, message: 'Invalid school ID' });
    }

    if (!classId) {
      return res.status(400).json({ success: false, message: 'classId is required' });
    }

    // ── Resolve Teacher profile from User ID ──────────────────────────────
    const Teacher = require('../models/Teacher.js');
    const teacherProfile = await Teacher.findOne({
      userId: new mongoose.Types.ObjectId(userId),
      schoolId: normalizedSchoolId,
    }).select('_id').lean();

    if (!teacherProfile) {
      return res.status(403).json({
        success: false,
        message: 'Teacher profile not found for this user',
      });
    }

    // ── Verify teacher is assigned to this class ──────────────────────────
    const assignments = await TeacherAssignment.find({
      teacherId: teacherProfile._id,
      classId:   new mongoose.Types.ObjectId(classId),
      schoolId:  normalizedSchoolId,
    }).select('sectionId').lean();

    if (!assignments.length) {
      return res.status(403).json({
        success: false,
        message: 'You are not assigned to this class',
      });
    }

    // ── Fetch students ────────────────────────────────────────────────────
    const studentFilter = {
      classId:  new mongoose.Types.ObjectId(classId),
      schoolId: normalizedSchoolId,
      status:   'ACTIVE',
    };

    if (sectionId) {
      studentFilter.sectionId = new mongoose.Types.ObjectId(sectionId);
    } else {
      const allowedSectionIds = [
        ...new Set(
          assignments
            .map((a) => a.sectionId?.toString())
            .filter(Boolean)
        ),
      ].map((id) => new mongoose.Types.ObjectId(id));

      if (allowedSectionIds.length > 0) {
        studentFilter.sectionId = { $in: allowedSectionIds };
      }
    }

    const students = await Student.find(studentFilter)
      .select('_id name rollNumber classId sectionId')
      .sort({ rollNumber: 1 })
      .lean();

    return res.json({ success: true, data: students });
  } catch (err) {
    console.error('getTeacherClassStudents error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/attendance/summary/monthly?classId=&month=YYYY-MM
const getMonthlyAttendanceSummary = async (req, res) => {
  try {
    const { classId, month } = req.query;
    const { schoolId } = req.user;
    const normalizedSchoolId = schoolId?._id || schoolId;

    if (!month) {
      return res.status(400).json({
        success: false,
        message: 'month is required (YYYY-MM)',
      });
    }

    const [year, mon] = month.split('-').map(Number);
    const startDate = new Date(year, mon - 1, 1);
    const endDate = new Date(year, mon, 0, 23, 59, 59);

    const activeSession = await AcademicSession.findOne({
      schoolId: normalizedSchoolId,
      isActive: true,
    });

    if (!activeSession) {
      return res.status(400).json({ success: false, message: 'No active session' });
    }

    const filter = {
      schoolId: normalizedSchoolId,
      sessionId: activeSession._id,
      date: { $gte: startDate, $lte: endDate },
    };

    if (classId) {
      filter.classId = classId;
    }

    const records = await StudentDailyAttendance.find(filter)
      .populate('studentId', 'name rollNumber')
      .lean();

    const studentMap = {};

    for (const rec of records) {
      const sid = rec.studentId?._id?.toString() || rec.studentId?.toString();
      if (!sid) {
        continue;
      }

      if (!studentMap[sid]) {
        studentMap[sid] = {
          studentId: sid,
          name: rec.studentId?.name || 'Unknown',
          rollNumber: rec.studentId?.rollNumber || '',
          present: 0,
          absent: 0,
          late: 0,
          leave: 0,
          total: 0,
        };
      }

      studentMap[sid].total++;
      const s = rec.status;
      if (s === 'PRESENT') studentMap[sid].present++;
      else if (s === 'ABSENT') studentMap[sid].absent++;
      else if (s === 'LATE') studentMap[sid].late++;
      else if (s === 'LEAVE' || s === 'SICK_LEAVE' || s === 'HALF_DAY') {
        studentMap[sid].leave++;
      }
    }

    const result = Object.values(studentMap).map((s) => ({
      ...s,
      percentage: s.total > 0 ? Math.round((s.present / s.total) * 100) : 0,
    }));

    return res.json({ success: true, data: result });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};




// --- END OF FUNCTION DEFINITIONS ---

// Single module.exports at the very end
module.exports = {
  markStudentDailyAttendance,
  getStudentDailyAttendance,
  getStudentAttendanceByTeacher,
  getTeacherClassStudents,
  markSubjectAttendance,
  getSubjectAttendance,
  getPeriodWiseSummary,
  markTeacherAttendance,
  getTeacherAttendance,
  getParentAttendance,
  getAttendanceForParent,
  getStudentSelfAttendance,
  markStaffAttendance,
  getStaffAttendance,
  getAttendanceSummary,
  getMonthlyAttendanceSummary,
  getStaffMembers,
  checkDuplicateAttendance,
  checkLateThreshold,
};

/**
 * GET /api/attendance/staff
 * Query: date?, startDate?, endDate?, staffId?, role?
 *
 * - Staff members see only their own records.
 * - OPERATOR / PRINCIPAL / SUPER_ADMIN see all (filterable by role / staffId).
 */
async function getStaffAttendance(req, res) {
  try {
    const { date, startDate, endDate, staffId, role: filterRole } = req.query;
    const { userId, role, schoolId } = req.user;
    const normalizedSchoolId = schoolId?._id || schoolId;

    if (!STAFF_ROLES.includes(role)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const activeSession = await AcademicSession.findOne({ schoolId: normalizedSchoolId, isActive: true });
    if (!activeSession) {
      return res.status(400).json({ success: false, message: 'No active academic session found' });
    }

    const filter = { schoolId: normalizedSchoolId, sessionId: activeSession._id };

    // Non-admin staff only see their own records
    if (!ADMIN_ROLES.includes(role)) {
      filter.staffId = userId;
    } else {
      if (staffId)     filter.staffId = staffId;
      if (filterRole)  filter.role    = filterRole;
    }

    if (date) {
      filter.date = normalizeDate(date);
    } else if (startDate && endDate) {
      const start = normalizeDate(startDate);
      const end   = new Date(normalizeDate(endDate));
      end.setHours(23, 59, 59, 999);
      filter.date = { $gte: start, $lte: end };
    }

    const records = await StaffAttendance.find(filter)
      .populate('staffId',   'name email')
      .populate('markedBy',  'name')
      .sort({ date: -1 });

    return res.status(200).json({ success: true, data: records });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}
