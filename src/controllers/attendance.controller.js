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
const AcademicHistory = require('../models/AcademicHistory.js');
const { auditLog } = require('../utils/auditLog.js');

// Utility
const normalizeDate = (d) => {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  return date;
};

const STAFF_ROLES = ['TEACHER', 'OPERATOR', 'PRINCIPAL', 'SUPER_ADMIN'];
const ADMIN_ROLES = ['OPERATOR', 'PRINCIPAL', 'SUPER_ADMIN'];
const VALID_STATUSES = ['PRESENT', 'ABSENT', 'LATE', 'HALF_DAY', 'LEAVE', 'SICK_LEAVE'];
const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

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

// All function definitions (const style)

const markStudentDailyAttendance = async (req, res) => {
  try {
    const { records } = req.body;
    const { userId, schoolId, sessionId } = req.user;
    const normalizedSchoolId = schoolId?._id || schoolId;

    if (!records || !Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ success: false, message: 'Records array is required' });
    }

    if (!sessionId) {
      return res.status(400).json({
        success: false, message: 'No active academic session found for this school'
      });
    }

    const studentIds = records.map(r => r.studentId);
    const students = await Student.find({
      _id: { $in: studentIds }, schoolId: normalizedSchoolId
    });
    const studentMap = new Map(students.map(s => [s._id.toString(), s]));

    for (const record of records) {
      const student = studentMap.get(record.studentId.toString());
      if (!student) {
        return res.status(400).json({
          success: false, message: 'Student not found or does not belong to this school'
        });
      }
      if (student.classId.toString() !== record.classId.toString()) {
        return res.status(400).json({
          success: false, message: 'Student does not belong to the specified class'
        });
      }
      if (record.sectionId && student.sectionId.toString() !== record.sectionId.toString()) {
        return res.status(400).json({
          success: false, message: 'Student does not belong to the specified section'
        });
      }
    }

    const bulkOps = records.map((record) => {
      const attendanceDate = normalizeDate(record.date);
      return {
        updateOne: {
          filter: {
            studentId: record.studentId,
            date: attendanceDate,
            schoolId: normalizedSchoolId,
            sessionId,
          },
          update: {
            $set: {
              classId: record.classId,
              sectionId: record.sectionId,
              status: record.status,
              markedBy: userId,
              schoolId: normalizedSchoolId,
              sessionId,
            },
          },
          upsert: true,
        },
      };
    });

    const result = await StudentDailyAttendance.bulkWrite(bulkOps);

    try {
      const Notice = require('../models/Notice.js');
      const absentRecords = records.filter(r => r.status === 'ABSENT');
      if (absentRecords.length > 0) {
        const absentStudentIds = absentRecords.map(r => r.studentId);
        const absentStudents = await Student.find({
          _id: { $in: absentStudentIds }, schoolId: normalizedSchoolId,
        }).select('name classId');
        const parents = await Parent.find({
          children: { $in: absentStudentIds }, schoolId: normalizedSchoolId,
        });
        if (parents.length > 0 && absentStudents.length > 0) {
          const studentNames = absentStudents.map(s => s.name).join(', ');
          await Notice.create({
            schoolId: normalizedSchoolId,
            sessionId,
            title: `Absent Alert - ${records[0].date}`,
            message: `The following student(s) were marked absent today (${records[0].date}): ${studentNames}.`,
            target: 'Parents',
            classId: records[0].classId,
            announcementType: 'Notice',
            isImportant: true,
            createdBy: userId,
          });
        }
      }
    } catch (_) {}

    await auditLog({
      action: 'STUDENT_ATTENDANCE_MARKED',
      userId: req.user.userId,
      schoolId: req.user.schoolId,
      details: { date: records[0].date, totalRecords: records.length },
      req
    });

    res.status(200).json({
      success: true,
      message: 'Attendance marked successfully',
      data: { upserted: result.upsertedCount, modified: result.modifiedCount },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const markSubjectAttendance = async (req, res) => {
  try {
    const { records } = req.body;
    const { userId, role, schoolId, sessionId } = req.user;
    const normalizedSchoolId = schoolId?._id || schoolId;

    if (!records || !Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ success: false, message: 'Records array is required' });
    }

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        message: 'No active academic session found for this school',
      });
    }

    const studentIds = [...new Set(records.map((r) => r.studentId?.toString()).filter(Boolean))];
    const subjectIds = [...new Set(records.map((r) => r.subjectId?.toString()).filter(Boolean))];

    if (studentIds.length === 0 || subjectIds.length === 0) {
      return res.status(400).json({ success: false, message: 'studentId and subjectId are required in records' });
    }

    const students = await Student.find({
      _id: { $in: studentIds },
      schoolId: normalizedSchoolId,
    }).select('_id classId sectionId');
    const studentMap = new Map(students.map((s) => [s._id.toString(), s]));

    const subjects = await Subject.find({
      _id: { $in: subjectIds },
      schoolId: normalizedSchoolId,
      sessionId,
    }).select('_id classId');
    const subjectMap = new Map(subjects.map((s) => [s._id.toString(), s]));

    if (role === 'TEACHER') {
      const Teacher = require('../models/Teacher.js');
      const teacherProfile = await Teacher.findOne({
        userId,
        schoolId: normalizedSchoolId,
        sessionId,
      }).select('_id');

      if (!teacherProfile) {
        return res.status(403).json({ success: false, message: 'Teacher profile not found for this user' });
      }

      const firstRecord = records[0];
      const assignment = await TeacherAssignment.findOne({
        teacherId: teacherProfile._id,
        classId: firstRecord.classId,
        subjectId: firstRecord.subjectId,
        schoolId: normalizedSchoolId,
        sessionId,
      }).select('_id');

      if (!assignment) {
        return res.status(403).json({
          success: false,
          message: 'You are not assigned to teach this subject in this class',
        });
      }
    }

    for (const record of records) {
      if (!record.studentId || !record.classId || !record.subjectId || !record.date || !record.status) {
        return res.status(400).json({ success: false, message: 'Each record must include studentId, classId, subjectId, date, and status' });
      }
      if (!['PRESENT', 'ABSENT', 'LEAVE'].includes(record.status)) {
        return res.status(400).json({ success: false, message: 'Invalid subject attendance status' });
      }

      const student = studentMap.get(record.studentId.toString());
      if (!student) {
        return res.status(400).json({ success: false, message: 'Student not found or does not belong to this school' });
      }
      if (student.classId.toString() !== record.classId.toString()) {
        return res.status(400).json({ success: false, message: 'Student does not belong to the specified class' });
      }
      if (record.sectionId && student.sectionId.toString() !== record.sectionId.toString()) {
        return res.status(400).json({ success: false, message: 'Student does not belong to the specified section' });
      }

      const subject = subjectMap.get(record.subjectId.toString());
      if (!subject) {
        return res.status(400).json({ success: false, message: 'Subject not found for this school/session' });
      }
      if (subject.classId.toString() !== record.classId.toString()) {
        return res.status(400).json({ success: false, message: 'Subject does not belong to the specified class' });
      }
    }

    const bulkOps = records.map((record) => ({
      updateOne: {
        filter: {
          studentId: record.studentId,
          subjectId: record.subjectId,
          date: normalizeDate(record.date),
          period: record.period ? Number(record.period) : null,
          schoolId: normalizedSchoolId,
          sessionId,
        },
        update: {
          $set: {
            classId: record.classId,
            status: record.status,
            teacherId: userId,
            schoolId: normalizedSchoolId,
            sessionId,
            period: record.period ? Number(record.period) : null,
          },
        },
        upsert: true,
      },
    }));

    const result = await StudentSubjectAttendance.bulkWrite(bulkOps);

    await auditLog({
      action: 'SUBJECT_ATTENDANCE_MARKED',
      userId,
      schoolId: normalizedSchoolId,
      details: { date: records[0].date, totalRecords: records.length, subjectId: records[0].subjectId },
      req,
    });

    return res.status(200).json({
      success: true,
      message: 'Subject attendance marked successfully',
      data: {
        upserted: result.upsertedCount,
        modified: result.modifiedCount,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
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
      ...sessionFilter(req),
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
      ...sessionFilter(req),
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
      ...sessionFilter(req),
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
    const { userId, role, schoolId, sessionId } = req.user;
    const normalizedSchoolId = schoolId?._id || schoolId;

    // Role-based access
    if (role === 'STUDENT' || role === 'PARENT') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    if (!sessionId) {
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
      schoolId: normalizedSchoolId,
      sessionId,
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
        sessionId,
      },
      {
        $set: {
          status: status,
          checkIn: checkIn,
          checkOut: checkOut,
          sessionId,
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
      ...sessionFilter(req),
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
      ...sessionFilter(req),
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
      ...sessionFilter(req)
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
    const resolvedUserId = req.user.userId || req.user._id;
    const { schoolId, sessionId, isBrowsingHistory } = req.user;
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

    let student;
    let responseClassName = '';
    let responseSectionName = '';
    let responseRollNumber = '';

    if (isBrowsingHistory) {
      const baseStudent = await Student.findOne({
        userId: resolvedUserId,
        schoolId: normalizedSchoolId,
      }).select('_id name rollNumber');

      if (!baseStudent) {
        return res.status(404).json({ success: false, message: 'Student not found' });
      }

      const history = await AcademicHistory.findOne({
        studentId: baseStudent._id,
        schoolId: normalizedSchoolId,
        sessionId,
      })
        .populate('classId', 'name')
        .populate('sectionId', 'name')
        .select('classId sectionId rollNumber');

      if (!history) {
        return res.status(200).json({
          success: true,
          student: {
            name: baseStudent.name,
            rollNumber: baseStudent.rollNumber,
            class: '',
            section: '',
          },
          data: [],
          attendance: [],
        });
      }

      student = { _id: baseStudent._id, name: baseStudent.name };
      responseRollNumber = history.rollNumber || baseStudent.rollNumber || '';
      responseClassName = history.classId?.name || '';
      responseSectionName = history.sectionId?.name || '';
    } else {
      student = await Student.findOne({ userId: resolvedUserId, schoolId: normalizedSchoolId, ...sessionFilter(req) })
        .populate('classId', 'name')
        .populate('sectionId', 'name');

      if (!student) {
        return res.status(404).json({ success: false, message: 'Student record not found' });
      }

      responseRollNumber = student.rollNumber || '';
      responseClassName = student.classId?.name || '';
      responseSectionName = student.sectionId?.name || '';
    }

    const filter = {
      studentId: student._id,
      schoolId: normalizedSchoolId,
      ...sessionFilter(req),
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
        rollNumber: responseRollNumber,
        class: responseClassName,
        section: responseSectionName
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
      ...sessionFilter(req),
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
      ...sessionFilter(req),
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
    const sFilter = sessionFilter(req);

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
      ...sFilter,
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
      ...sFilter,
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
      ...sessionFilter(req),
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




const markStaffAttendance = async (req, res) => {
  try {
    const { date, status, checkIn, checkOut, staffId: targetStaffId } = req.body;
    const { userId, role, schoolId, sessionId } = req.user;
    const normalizedSchoolId = schoolId?._id || schoolId;

    if (!STAFF_ROLES.includes(role)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    if (!date || !status) {
      return res.status(400).json({ success: false, message: 'date and status are required' });
    }

    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status value' });
    }

    if (checkIn && !TIME_REGEX.test(checkIn)) {
      return res.status(400).json({ success: false, message: 'Invalid checkIn time format. Use HH:mm.' });
    }
    if (checkOut && !TIME_REGEX.test(checkOut)) {
      return res.status(400).json({ success: false, message: 'Invalid checkOut time format. Use HH:mm.' });
    }

    if (!sessionId) {
      return res.status(400).json({ success: false, message: 'No active academic session found' });
    }

    let staffId = userId;
    if (ADMIN_ROLES.includes(role)) {
      if (targetStaffId) {
        staffId = targetStaffId;
      }
    } else {
      if (targetStaffId && targetStaffId.toString() !== userId.toString()) {
        return res.status(403).json({ success: false, message: 'You can only mark your own attendance' });
      }
      const today = new Date().toISOString().split('T')[0];
      if (date !== today) {
        return res.status(400).json({ success: false, message: 'Teachers can only mark attendance for today' });
      }
    }

    const staffUser = await User.findOne({
      _id: staffId,
      schoolId: normalizedSchoolId,
      role: { $in: STAFF_ROLES },
    }).select('_id role');

    if (!staffUser) {
      return res.status(404).json({ success: false, message: 'Staff user not found in this school' });
    }

    const attendanceDate = normalizeDate(date);

    const attendance = await StaffAttendance.findOneAndUpdate(
      {
        staffId,
        date: attendanceDate,
        schoolId: normalizedSchoolId,
        sessionId,
      },
      {
        $set: {
          role: staffUser.role,
          status,
          checkIn,
          checkOut,
          markedBy: userId,
          schoolId: normalizedSchoolId,
          sessionId,
        },
      },
      {
        upsert: true,
        new: true,
      }
    );

    await auditLog({
      action: 'STAFF_ATTENDANCE_MARKED',
      userId,
      schoolId: normalizedSchoolId,
      details: {
        staffId,
        date,
        status,
        markedByRole: role,
      },
      req,
    });

    return res.status(200).json({
      success: true,
      message: 'Staff attendance marked successfully',
      data: attendance,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /api/attendance/staff
 * Query: date?, startDate?, endDate?, staffId?, role?
 *
 * - Staff members see only their own records.
 * - OPERATOR / PRINCIPAL / SUPER_ADMIN see all (filterable by role / staffId).
 */
const getStaffAttendance = async (req, res) => {
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

    const filter = { schoolId: normalizedSchoolId, ...sessionFilter(req) };

    if (!ADMIN_ROLES.includes(role)) {
      filter.staffId = userId;
    } else {
      if (staffId) filter.staffId = staffId;
      if (filterRole) filter.role = filterRole;
    }

    if (date) {
      filter.date = normalizeDate(date);
    } else if (startDate && endDate) {
      const start = normalizeDate(startDate);
      const end = new Date(normalizeDate(endDate));
      end.setHours(23, 59, 59, 999);
      filter.date = { $gte: start, $lte: end };
    }

    const records = await StaffAttendance.find(filter)
      .populate('staffId', 'name email role')
      .populate('markedBy', 'name')
      .sort({ date: -1 });

    return res.status(200).json({ success: true, data: records });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const getStaffMembers = async (req, res) => {
  try {
    const { role, schoolId } = req.user;
    const normalizedSchoolId = schoolId?._id || schoolId;

    if (!STAFF_ROLES.includes(role)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const users = await User.find({
      schoolId: normalizedSchoolId,
      role: { $in: STAFF_ROLES },
      status: { $regex: /^active$/i },
    })
      .select('_id name email role employeeId designation mobile')
      .sort({ name: 1 })
      .lean();

    return res.status(200).json({ success: true, data: users });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const getAttendanceSummary = async (req, res) => {
  try {
    const { date } = req.query;
    const { schoolId } = req.user;
    const normalizedSchoolId = schoolId?._id || schoolId;

    const activeSession = await AcademicSession.findOne({
      schoolId: normalizedSchoolId,
      isActive: true,
    });
    if (!activeSession) {
      return res.status(400).json({ success: false, message: 'No active academic session found' });
    }

    const targetDate = normalizeDate(date || new Date().toISOString().split('T')[0]);

    const totalStudents = await Student.countDocuments({
      schoolId: normalizedSchoolId,
      ...sessionFilter(req),
      status: { $regex: /^active$/i },
    });

    const attendanceAgg = await StudentDailyAttendance.aggregate([
      {
        $match: {
          schoolId: normalizedSchoolId,
          ...sessionFilter(req),
          date: targetDate,
        },
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
        },
      },
    ]);

    const counters = {
      PRESENT: 0,
      ABSENT: 0,
      LATE: 0,
      HALF_DAY: 0,
      LEAVE: 0,
      SICK_LEAVE: 0,
    };

    for (const row of attendanceAgg) {
      counters[row._id] = row.count;
    }

    const presentCount = counters.PRESENT;
    const absentCount = counters.ABSENT;
    const lateCount = counters.LATE;
    const leaveCount = counters.HALF_DAY + counters.LEAVE + counters.SICK_LEAVE;
    const markedCount = presentCount + absentCount + lateCount + leaveCount;

    return res.status(200).json({
      success: true,
      data: {
        date: targetDate,
        totalStudents,
        presentCount,
        absentCount,
        lateCount,
        leaveCount,
        markedCount,
        unmarkedCount: Math.max(0, totalStudents - markedCount),
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

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
