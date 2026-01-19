const StudentDailyAttendance = require('../models/StudentDailyAttendance.js');
const StudentSubjectAttendance = require('../models/StudentSubjectAttendance.js');
const TeacherAttendance = require('../models/TeacherAttendance.js');
const Student = require('../models/Student.js');
const Parent = require('../models/Parent.js');
const Subject = require('../models/Subject.js');
const Teacher = require('../models/Teacher.js');
const { auditLog } = require('../utils/auditLog_new.js');

const markStudentDailyAttendance = async (req, res) => {
  try {
    const { records } = req.body;
    const { userId, schoolId, sessionId } = req.user;

    if (!records || !Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ success: false, message: 'Records array is required' });
    }

    const studentIds = records.map(record => record.studentId);
    const students = await Student.find({
      _id: { $in: studentIds },
      schoolId: schoolId,
      sessionId: sessionId
    });
    const studentMap = new Map(students.map(student => [student._id.toString(), student]));

    for (const record of records) {
      const student = studentMap.get(record.studentId.toString());
      if (!student || student.classId.toString() !== record.classId.toString() || student.sectionId.toString() !== record.sectionId.toString()) {
        return res.status(400).json({
          success: false,
          message: 'One or more students do not belong to the specified class or section'
        });
      }
    }

    const bulkOps = records.map((record) => ({
      updateOne: {
        filter: {
          studentId: record.studentId,
          date: record.date,
          schoolId: schoolId,
        },
        update: {
          $set: {
            classId: record.classId,
            sectionId: record.sectionId,
            status: record.status,
            markedBy: userId,
            schoolId: schoolId,
            sessionId: sessionId,
          },
        },
        upsert: true,
      },
    }));

    const result = await StudentDailyAttendance.bulkWrite(bulkOps);

    await auditLog({
      action: 'STUDENT_ATTENDANCE_MARKED',
      userId: req.user.userId,
      schoolId: req.user.schoolId,
      details: {
        date: records[0].date,
        totalRecords: records.length
      },
      req
    });

    res.status(200).json({
      success: true,
      message: 'Attendance marked successfully',
      data: {
        upserted: result.upsertedCount,
        modified: result.modifiedCount,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getStudentDailyAttendance = async (req, res) => {
  try {
    const { classId, sectionId, date, startDate, endDate } = req.query;
    const { schoolId, sessionId } = req.user;

    const filter = {
      schoolId: schoolId,
      sessionId: sessionId,
    };

    if (classId) filter.classId = classId;
    if (sectionId) filter.sectionId = sectionId;
    if (date) filter.date = date;

    if (startDate && endDate) {
      filter.date = { $gte: startDate, $lte: endDate };
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
};



const markSubjectAttendance = async (req, res) => {
  try {
    const { records } = req.body;
    const { userId, schoolId, sessionId, role } = req.user;

    if (role !== 'TEACHER') {
      return res.status(403).json({ success: false, message: 'Only teachers can mark subject attendance' });
    }

    if (!records || !Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ success: false, message: 'Records array is required' });
    }

    // Normalize period and validate status
    for (const record of records) {
      record.period = record.period ? Number(record.period) : null;
      if (!['PRESENT', 'ABSENT'].includes(record.status)) {
        return res.status(400).json({ success: false, message: 'Invalid status. Only PRESENT or ABSENT allowed.' });
      }
    }

    // Fetch students
    const studentIds = [...new Set(records.map(record => record.studentId))];
    const students = await Student.find({
      _id: { $in: studentIds },
      schoolId: schoolId,
      sessionId: sessionId
    });
    const studentMap = new Map(students.map(student => [student._id.toString(), student]));

    // Fetch subjects
    const subjectIds = [...new Set(records.map(record => record.subjectId))];
    const subjects = await Subject.find({
      _id: { $in: subjectIds },
      schoolId: schoolId
    });
    const subjectMap = new Map(subjects.map(subject => [subject._id.toString(), subject]));

    // Validate each record
    for (const record of records) {
      const student = studentMap.get(record.studentId.toString());
      const subject = subjectMap.get(record.subjectId.toString());

      if (!student) {
        return res.status(400).json({ success: false, message: 'One or more students do not exist or do not belong to this school/session' });
      }
      if (!subject) {
        return res.status(400).json({ success: false, message: 'One or more subjects do not exist or do not belong to this school' });
      }
      if (subject.classId.toString() !== record.classId.toString()) {
        return res.status(400).json({ success: false, message: 'Subject does not belong to the specified class' });
      }
      if (student.classId.toString() !== record.classId.toString()) {
        return res.status(400).json({ success: false, message: 'Student does not belong to the specified class' });
      }
    }

    const bulkOps = records.map((record) => ({
      updateOne: {
        filter: {
          studentId: record.studentId,
          subjectId: record.subjectId,
          date: record.date,
          period: record.period,
          schoolId: schoolId,
        },
        update: {
          $set: {
            classId: record.classId,
            status: record.status,
            teacherId: userId,
            schoolId: schoolId,
            sessionId: sessionId,
          },
        },
        upsert: true,
      },
    }));

    const result = await StudentSubjectAttendance.bulkWrite(bulkOps);

    await auditLog({
      action: 'SUBJECT_ATTENDANCE_MARKED',
      userId: req.user.userId,
      schoolId: req.user.schoolId,
      details: {
        totalRecords: records.length,
        classId: records[0].classId,
        date: records[0].date,
        markedByRole: req.user.role
      },
      req
    });

    res.status(200).json({
      success: true,
      message: 'Subject attendance marked successfully',
      data: {
        upserted: result.upsertedCount,
        modified: result.modifiedCount,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getSubjectAttendance = async (req, res) => {
  try {
    const { classId, subjectId, date, studentId } = req.query;
    const { schoolId, sessionId } = req.user;

    const filter = {
      schoolId: schoolId,
      sessionId: sessionId,
    };

    if (classId) filter.classId = classId;
    if (subjectId) filter.subjectId = subjectId;
    if (date) filter.date = date;
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

const markTeacherAttendance = async (req, res) => {
  try {
    const { date, status, checkIn, checkOut, teacherId: targetTeacherId } = req.body;
    const { userId, role, schoolId, sessionId } = req.user;

    // Role-based access
    if (role === 'STUDENT' || role === 'PARENT') {
      return res.status(403).json({ success: false, message: 'Access denied' });
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

    // Verify teacher exists and belongs to school
    const teacher = await Teacher.findOne({ userId: teacherId, schoolId });
    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Teacher not found or does not belong to this school' });
    }
    if (teacher.status !== 'active') {
      return res.status(400).json({ success: false, message: 'Teacher is not active' });
    }

    // Check if attendance already exists
    const existingAttendance = await TeacherAttendance.findOne({
      teacherId,
      date,
      schoolId
    });

    if (existingAttendance && role === 'TEACHER') {
      return res.status(400).json({ success: false, message: 'Attendance already marked for today. Contact admin to update.' });
    }

    const result = await TeacherAttendance.findOneAndUpdate(
      {
        teacherId: teacherId,
        date: date,
        schoolId: schoolId,
      },
      {
        $set: {
          status: status,
          checkIn: checkIn,
          checkOut: checkOut,
          sessionId: sessionId,
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
    const { userId, role, schoolId, sessionId } = req.user;

    if (role === 'STUDENT' || role === 'PARENT') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const filter = {
      schoolId: schoolId,
      sessionId: sessionId,
    };

    if (role === 'TEACHER' && !teacherId) {
      filter.teacherId = userId;
    } else if (teacherId) {
      filter.teacherId = teacherId;
    }

    if (date) filter.date = date;
    if (startDate && endDate) {
      filter.date = { $gte: startDate, $lte: endDate };
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
    const { userId, schoolId, sessionId } = req.user;
    const { startDate, endDate } = req.query;

    const parent = await Parent.findOne({ userId, schoolId });
    if (!parent) {
      return res.status(404).json({ success: false, message: 'Parent record not found' });
    }

    if (!parent.children || parent.children.length === 0) {
      return res.status(404).json({ success: false, message: 'No children found' });
    }

    const filter = {
      studentId: { $in: parent.children },
      schoolId: schoolId,
      sessionId: sessionId,
    };

    if (startDate && endDate) {
      filter.date = { $gte: startDate, $lte: endDate };
    }

    const attendance = await StudentDailyAttendance.find(filter)
      .populate('studentId', 'name rollNumber')
      .populate('classId', 'name')
      .populate('sectionId', 'name')
      .sort({ date: -1 });

    res.status(200).json({
      success: true,
      data: attendance,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getAttendanceForParent = async (req, res) => {
  try {
    const { studentId } = req.params;
    const { userId, schoolId, sessionId } = req.user;

    const parent = await Parent.findOne({ userId, schoolId });
    if (!parent) {
      return res.status(404).json({ success: false, message: 'Parent record not found' });
    }

    if (!parent.children.includes(studentId)) {
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
      schoolId,
      sessionId
    }).sort({ date: -1 });

    res.status(200).json({
      success: true,
      student: {
        name: student.name,
        rollNumber: student.rollNumber,
        class: student.classId.name,
        section: student.sectionId.name
      },
      attendance: attendance.map(att => ({
        date: att.date,
        status: att.status
      }))
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  markStudentDailyAttendance,
  getStudentDailyAttendance,
  markSubjectAttendance,
  getSubjectAttendance,
  markTeacherAttendance,
  getTeacherAttendance,
  getParentAttendance,
  getAttendanceForParent,
};
