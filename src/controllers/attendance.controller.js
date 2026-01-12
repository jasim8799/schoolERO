import StudentDailyAttendance from '../models/StudentDailyAttendance.js';
import StudentSubjectAttendance from '../models/StudentSubjectAttendance.js';
import TeacherAttendance from '../models/TeacherAttendance.js';
import Student from '../models/Student.js';
import Parent from '../models/Parent.js';

export const markStudentDailyAttendance = async (req, res) => {
  try {
    const { records } = req.body;
    const { userId, schoolId, sessionId } = req.user;

    if (!records || !Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ success: false, message: 'Records array is required' });
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

export const getStudentDailyAttendance = async (req, res) => {
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

export const getMyStudentAttendance = async (req, res) => {
  try {
    const { userId, role, schoolId, sessionId } = req.user;
    const { startDate, endDate } = req.query;

    let studentIds = [];

    if (role === 'STUDENT') {
      const student = await Student.findOne({ userId: userId, schoolId: schoolId });
      if (!student) {
        return res.status(404).json({ success: false, message: 'Student record not found' });
      }
      studentIds = [student._id];
    } else if (role === 'PARENT') {
      const parent = await Parent.findOne({ userId: userId, schoolId: schoolId }).populate('children');
      if (!parent || !parent.children || parent.children.length === 0) {
        return res.status(404).json({ success: false, message: 'No children found' });
      }
      studentIds = parent.children.map((child) => child._id);
    } else {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const filter = {
      studentId: { $in: studentIds },
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

export const markSubjectAttendance = async (req, res) => {
  try {
    const { records } = req.body;
    const { userId, schoolId, sessionId } = req.user;

    if (!records || !Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ success: false, message: 'Records array is required' });
    }

    const attendanceRecords = records.map((record) => ({
      studentId: record.studentId,
      subjectId: record.subjectId,
      classId: record.classId,
      date: record.date,
      period: record.period,
      status: record.status,
      teacherId: userId,
      schoolId: schoolId,
      sessionId: sessionId,
    }));

    const result = await StudentSubjectAttendance.insertMany(attendanceRecords);

    res.status(201).json({
      success: true,
      message: 'Subject attendance marked successfully',
      data: result,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getSubjectAttendance = async (req, res) => {
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

export const markTeacherAttendance = async (req, res) => {
  try {
    const { date, status, checkIn, checkOut, teacherId: targetTeacherId } = req.body;
    const { userId, role, schoolId, sessionId } = req.user;

    let teacherId = userId;

    if (targetTeacherId && (role === 'OPERATOR' || role === 'PRINCIPAL' || role === 'SUPER_ADMIN')) {
      teacherId = targetTeacherId;
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

    res.status(200).json({
      success: true,
      message: 'Teacher attendance marked successfully',
      data: result,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getTeacherAttendance = async (req, res) => {
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
