const Student = require('../models/Student');
const User = require('../models/User');
const StudentDailyAttendance = require('../models/StudentDailyAttendance');
const TeacherAttendance = require('../models/TeacherAttendance');
const StudentFee = require('../models/StudentFee');
const FeePayment = require('../models/FeePayment');
const ExamPayment = require('../models/ExamPayment');
const StudentHostel = require('../models/StudentHostel');
const StudentTransport = require('../models/StudentTransport');
const ExamForm = require('../models/ExamForm');
const Homework = require('../models/Homework');
const Result = require('../models/Result');
const Notice = require('../models/Notice');
const { USER_ROLES } = require('../config/constants');

// Get Principal dashboard data
const getPrincipalDashboard = async (req, res) => {
  try {
    const { schoolId, sessionId } = req.user;

    // Total students
    const totalStudents = await Student.countDocuments({ schoolId, sessionId });

    // Total teachers
    const totalTeachers = await User.countDocuments({ schoolId, role: USER_ROLES.TEACHER });

    // Today attendance %
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const todayAttendances = await StudentDailyAttendance.find({
      schoolId,
      date: { $gte: today, $lt: tomorrow }
    });

    const presentCount = todayAttendances.filter(a => a.status === 'PRESENT').length;
    const todayAttendancePercent = todayAttendances.length > 0 ? ((presentCount / todayAttendances.length) * 100).toFixed(1) : 0;

    // Fee due amount
    const feeDues = await StudentFee.find({ schoolId, status: { $in: ['Due', 'Partial'] } });
    const totalFeeDue = feeDues.reduce((sum, fee) => sum + fee.dueAmount, 0);

    // Today collection
    const todayPayments = await FeePayment.find({
      schoolId,
      paymentDate: { $gte: today, $lt: tomorrow }
    });
    const todayCollection = todayPayments.reduce((sum, payment) => sum + payment.amount, 0);

    // Pending exam payments
    const pendingExamPayments = await ExamPayment.countDocuments({ schoolId, status: 'PENDING' });

    // Hostel occupancy
    const hostelStudents = await StudentHostel.countDocuments({ schoolId, status: 'ACTIVE' });
    const totalHostelCapacity = await require('../models/Room').aggregate([
      { $match: { schoolId } },
      { $group: { _id: null, total: { $sum: '$capacity' } } }
    ]);
    const hostelOccupancy = totalHostelCapacity.length > 0 ? ((hostelStudents / totalHostelCapacity[0].total) * 100).toFixed(1) : 0;

    // Transport students count
    const transportStudents = await StudentTransport.countDocuments({ schoolId, status: 'ACTIVE' });

    res.json({
      totalStudents,
      totalTeachers,
      todayAttendancePercent,
      totalFeeDue,
      todayCollection,
      pendingExamPayments,
      hostelOccupancy,
      transportStudents
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Get Operator dashboard data
const getOperatorDashboard = async (req, res) => {
  try {
    const { schoolId } = req.user;

    // Pending fee dues
    const pendingFeeDues = await StudentFee.countDocuments({ schoolId, status: { $in: ['Due', 'Partial'] } });

    // Today payments
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const todayPayments = await FeePayment.find({
      schoolId,
      paymentDate: { $gte: today, $lt: tomorrow }
    });
    const todayPaymentsCount = todayPayments.length;
    const todayPaymentsAmount = todayPayments.reduce((sum, payment) => sum + payment.amount, 0);

    // Attendance not marked
    const classes = await require('../models/Class').find({ schoolId });
    let attendanceNotMarked = 0;
    for (const cls of classes) {
      const sections = await require('../models/Section').find({ classId: cls._id });
      for (const section of sections) {
        const students = await Student.countDocuments({ classId: cls._id, sectionId: section._id, schoolId });
        const marked = await StudentDailyAttendance.countDocuments({
          classId: cls._id,
          sectionId: section._id,
          schoolId,
          date: { $gte: today, $lt: tomorrow }
        });
        if (marked < students) {
          attendanceNotMarked += (students - marked);
        }
      }
    }

    // Exam forms pending
    const pendingExamForms = await ExamForm.countDocuments({ schoolId, status: 'PENDING' });

    res.json({
      pendingFeeDues,
      todayPaymentsCount,
      todayPaymentsAmount,
      attendanceNotMarked,
      pendingExamForms
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Get Teacher dashboard data
const getTeacherDashboard = async (req, res) => {
  try {
    const { schoolId, _id: teacherId } = req.user;

    // Assigned classes (simplified - count classes teacher has attendance for)
    const assignedClasses = await StudentDailyAttendance.distinct('classId', { schoolId, markedBy: teacherId });

    // Today attendance status
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const todayAttendance = await TeacherAttendance.findOne({
      teacherId,
      date: { $gte: today, $lt: tomorrow }
    });

    // Homework count
    const homeworkCount = await Homework.countDocuments({ schoolId, createdBy: teacherId });

    res.json({
      assignedClassesCount: assignedClasses.length,
      todayAttendanceStatus: todayAttendance ? todayAttendance.status : 'NOT_MARKED',
      homeworkCount
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Get Student/Parent mobile dashboard data
const getStudentDashboard = async (req, res) => {
  try {
    const { schoolId, _id: userId, role } = req.user;

    let studentId;
    if (role === USER_ROLES.STUDENT) {
      const student = await Student.findOne({ userId, schoolId });
      studentId = student._id;
    } else if (role === USER_ROLES.PARENT) {
      // Simplified - assume parent has one child
      const student = await Student.findOne({ parentId: userId, schoolId });
      studentId = student._id;
    }

    // Attendance %
    const attendances = await StudentDailyAttendance.find({ studentId });
    const presentCount = attendances.filter(a => a.status === 'PRESENT').length;
    const attendancePercent = attendances.length > 0 ? ((presentCount / attendances.length) * 100).toFixed(1) : 0;

    // Fee due
    const fees = await StudentFee.find({ studentId });
    const totalDue = fees.reduce((sum, fee) => sum + fee.dueAmount, 0);

    // Exam status
    const results = await Result.find({ studentId }).populate('examId');
    const passedExams = results.filter(r => r.status === 'PASS').length;
    const totalExams = results.length;

    // Notices count
    const noticesCount = await Notice.countDocuments({ schoolId, targetRoles: role });

    res.json({
      attendancePercent,
      totalFeeDue: totalDue,
      examStatus: `${passedExams}/${totalExams} passed`,
      noticesCount
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Get Super Admin dashboard data
const getSuperAdminDashboard = async (req, res) => {
  try {
    // Only Super Admin can access
    if (req.user.role !== USER_ROLES.SUPER_ADMIN) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Super Admin only.'
      });
    }

    // Total schools
    const School = require('../models/School');
    const totalSchools = await School.countDocuments();

    // Total users across all schools
    const totalUsers = await User.countDocuments();

    // Total students across all schools
    const totalStudents = await Student.countDocuments();

    // Total teachers across all schools
    const totalTeachers = await User.countDocuments({ role: USER_ROLES.TEACHER });

    // Recent audit logs (last 24 hours)
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const recentLogs = await require('../models/AuditLog').countDocuments({
      createdAt: { $gte: yesterday }
    });

    // System health metrics
    const activeSessions = await require('../models/AcademicSession').countDocuments({ status: 'ACTIVE' });

    // API health metrics
    const dbStatus = require('mongoose').connection.readyState === 1 ? 'healthy' : 'unhealthy';
    const uptime = Math.floor(process.uptime()); // Uptime in seconds

    // Recent backups count (last 7 days)
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const recentBackups = await require('../models/Backup').countDocuments({
      createdAt: { $gte: weekAgo }
    });

    // Schools with issues (no recent backup)
    const schoolsWithoutRecentBackup = await School.find({
      _id: {
        $nin: await require('../models/Backup').distinct('schoolId', {
          createdAt: { $gte: weekAgo }
        })
      }
    });
    const schoolsWithIssues = schoolsWithoutRecentBackup.length;

    res.json({
      totalSchools,
      totalUsers,
      totalStudents,
      totalTeachers,
      recentLogs,
      activeSessions,
      recentBackups,
      schoolsWithIssues,
      systemHealth: {
        database: dbStatus,
        uptime: uptime,
        api: 'healthy'
      }
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = {
  getPrincipalDashboard,
  getOperatorDashboard,
  getTeacherDashboard,
  getStudentDashboard,
  getSuperAdminDashboard
};
