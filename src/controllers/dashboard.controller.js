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
const Exam = require('../models/Exam');
const Result = require('../models/Result');
const Bill = require('../models/Bill');
const SystemAnnouncement = require('../models/SystemAnnouncement');
const { USER_ROLES } = require('../config/constants');

function sessionFilter(req) {
  const sid = req.user?.sessionId;
  if (!sid) return {};
  return {
    $or: [
      { sessionId: sid },
      { sessionId: null },
      { sessionId: { $exists: false } },
    ],
  };
}

// Get Principal dashboard data
const getPrincipalDashboard = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const sFilter = sessionFilter(req);

    // Total students
    const totalStudents = await Student.countDocuments({ schoolId, ...sFilter });

    // Total teachers
    const totalTeachers = await User.countDocuments({ schoolId, role: USER_ROLES.TEACHER });

    // Today attendance %
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const todayAttendances = await StudentDailyAttendance.find({
      schoolId,
      ...sFilter,
      date: { $gte: today, $lt: tomorrow }
    });

    const presentCount = todayAttendances.filter(a => a.status === 'PRESENT').length;
    const todayAttendancePercent = todayAttendances.length > 0 ? ((presentCount / todayAttendances.length) * 100).toFixed(1) : 0;

    // Fee due amount
    const feeDues = await StudentFee.find({ schoolId, ...sFilter, status: { $in: ['Due', 'Partial'] } });
    const totalFeeDue = feeDues.reduce((sum, fee) => sum + fee.dueAmount, 0);

    // Today collection
    const todayPayments = await FeePayment.find({
      schoolId,
      ...sFilter,
      paymentDate: { $gte: today, $lt: tomorrow }
    });
    const todayCollection = todayPayments.reduce((sum, payment) => sum + payment.amount, 0);

    // Pending exam payments
    const pendingExamPayments = await ExamPayment.countDocuments({ schoolId, ...sFilter, status: 'PENDING' });

    const [publishedExamsCount, publishedResultExamIds, feeOverdueCount, absentToday] = await Promise.all([
      Exam.countDocuments({ schoolId, ...sFilter, status: 'Published' }),
      Result.distinct('examId', { schoolId, ...sFilter, status: 'Published' }),
      Bill.countDocuments({
        schoolId,
        ...sFilter,
        status: { $in: ['UNPAID', 'PARTIAL'] },
        dueAmount: { $gt: 0 },
        dueDate: { $lt: today },
      }),
      StudentDailyAttendance.countDocuments({
        schoolId,
        ...sFilter,
        date: { $gte: today, $lt: tomorrow },
        status: 'ABSENT',
      }),
    ]);

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
      success: true,
      data: {
        totalStudents,
        totalTeachers,
        todayAttendancePercent,
        totalFeeDue,
        feeDueCount: feeDues.length,
        feeOverdueCount,
        todayCollection,
        pendingExamPayments,
        publishedExamsCount,
        publishedResultsCount: publishedResultExamIds.length,
        absentToday,
        hostelOccupancy,
        transportStudents
      }
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Get Operator dashboard data
const getOperatorDashboard = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const sFilter = sessionFilter(req);

    // Pending fee dues
    const pendingFeeDues = await StudentFee.countDocuments({ schoolId, ...sFilter, status: { $in: ['Due', 'Partial'] } });

    // Today payments
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const todayPayments = await FeePayment.find({
      schoolId,
      ...sFilter,
      paymentDate: { $gte: today, $lt: tomorrow }
    });
    const todayPaymentsCount = todayPayments.length;
    const todayPaymentsAmount = todayPayments.reduce((sum, payment) => sum + payment.amount, 0);

    // Attendance not marked
    const classes = await require('../models/Class').find({ schoolId, ...sFilter });
    let attendanceNotMarked = 0;
    for (const cls of classes) {
      const sections = await require('../models/Section').find({ classId: cls._id, ...sFilter });
      for (const section of sections) {
        const students = await Student.countDocuments({ classId: cls._id, sectionId: section._id, schoolId, ...sFilter });
        const marked = await StudentDailyAttendance.countDocuments({
          classId: cls._id,
          sectionId: section._id,
          schoolId,
          ...sFilter,
          date: { $gte: today, $lt: tomorrow }
        });
        if (marked < students) {
          attendanceNotMarked += (students - marked);
        }
      }
    }

    // Exam forms pending
    const pendingExamForms = await ExamForm.countDocuments({ schoolId, ...sFilter, status: 'PENDING' });

    const [publishedExamsCount, publishedResultExamIds, feeOverdueCount, absentToday] = await Promise.all([
      Exam.countDocuments({ schoolId, ...sFilter, status: 'Published' }),
      Result.distinct('examId', { schoolId, ...sFilter, status: 'Published' }),
      Bill.countDocuments({
        schoolId,
        ...sFilter,
        status: { $in: ['UNPAID', 'PARTIAL'] },
        dueAmount: { $gt: 0 },
        dueDate: { $lt: today },
      }),
      StudentDailyAttendance.countDocuments({
        schoolId,
        ...sFilter,
        date: { $gte: today, $lt: tomorrow },
        status: 'ABSENT',
      }),
    ]);

    res.json({
      success: true,
      data: {
        pendingFeeDues,
        feeDueCount: pendingFeeDues,
        feeOverdueCount,
        todayPaymentsCount,
        todayPaymentsAmount,
        attendanceNotMarked,
        pendingExamForms,
        publishedExamsCount,
        publishedResultsCount: publishedResultExamIds.length,
        absentToday,
      }
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Get Teacher dashboard data
const getTeacherDashboard = async (req, res) => {
  try {
    const { schoolId, _id: teacherId } = req.user;
    const sFilter = sessionFilter(req);

    // Assigned classes (simplified - count classes teacher has attendance for)
    const assignedClasses = await StudentDailyAttendance.distinct('classId', { schoolId, ...sFilter, markedBy: teacherId });

    // Today attendance status
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const todayAttendance = await TeacherAttendance.findOne({
      teacherId,
      schoolId,
      ...sFilter,
      date: { $gte: today, $lt: tomorrow }
    });

    // Homework count
    const homeworkCount = await Homework.countDocuments({ schoolId, ...sFilter, createdBy: teacherId });

    res.json({
      success: true,
      data: {
        assignedClassesCount: assignedClasses.length,
        todayAttendanceStatus: todayAttendance ? todayAttendance.status : 'NOT_MARKED',
        homeworkCount
      }
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Get Student/Parent mobile dashboard data
const getStudentDashboard = async (req, res) => {
  try {
    const { schoolId, _id: userId, role } = req.user;
    const sFilter = sessionFilter(req);

    let studentId;
    if (role === USER_ROLES.STUDENT) {
      // First try by userId (already linked)
      let student = await Student.findOne({ userId, schoolId, ...sFilter });

      // Fallback: student created with userId as the same ObjectId value.
      if (!student) {
        student = await Student.findOne({ _id: userId, schoolId, ...sFilter }).catch(() => null);
      }

      // Fallback: try linking by mobile number (first login scenario)
      if (!student) {
        const user = await User.findById(userId).select('mobile');
        if (user?.mobile) {
          const unlinkedFilter = { $or: [{ userId: null }, { userId: { $exists: false } }] };
          const mobileQuery = sFilter.$or
            ? {
                schoolId,
                mobile: user.mobile,
                $and: [unlinkedFilter, sFilter],
              }
            : {
                schoolId,
                mobile: user.mobile,
                ...unlinkedFilter,
              };

          student = await Student.findOne(mobileQuery);
          // Auto-link if found
          if (student) {
            student.userId = userId;
            await student.save();
          }
        }
      }

      // If still not found, return default empty dashboard
      if (!student) {
        return res.json({
          success: true,
          data: {
            attendancePercent: 0,
            totalFeeDue: 0,
            examStatus: '0/0 passed',
            noticesCount: 0,
            message: 'Student profile not linked yet. Please contact your school administrator.'
          }
        });
      }

      studentId = student._id;
    } else if (role === USER_ROLES.PARENT) {
      // Find parent document by userId
      const Parent = require('../models/Parent');
      const parent = await Parent.findOne({ userId, schoolId });

      // If no parent profile found, return default empty dashboard
      if (!parent) {
        return res.json({
          success: true,
          data: {
            attendancePercent: 0,
            totalFeeDue: 0,
            examStatus: '0/0 passed',
            noticesCount: 0,
            message: 'Parent profile not found. Please contact your school administrator.'
          }
        });
      }

      // If parent has no children yet, return empty dashboard
      if (!parent.children || parent.children.length === 0) {
        return res.json({
          success: true,
          data: {
            attendancePercent: 0,
            totalFeeDue: 0,
            examStatus: '0/0 passed',
            noticesCount: 0,
            message: 'No children linked to your account yet.'
          }
        });
      }

      // Use first child (dashboard shows summary for first child)
      studentId = parent.children[0];
    }

    // Attendance %
    const attendances = await StudentDailyAttendance.find({ studentId, schoolId, ...sFilter });
    const presentCount = attendances.filter(a => a.status === 'PRESENT').length;
    const attendancePercent = attendances.length > 0 ? ((presentCount / attendances.length) * 100).toFixed(1) : 0;

    // Fee due
    const fees = await StudentFee.find({ studentId, schoolId, ...sFilter });
    const totalDue = fees.reduce((sum, fee) => sum + fee.dueAmount, 0);

    // Exam status
    const results = await Result.find({ studentId, schoolId, ...sFilter }).populate('examId');
    const passedExams = results.filter(r => r.status === 'PASS').length;
    const totalExams = results.length;

    // Notices count
    const noticesCount = await SystemAnnouncement.countDocuments({ schoolId, targetRoles: role });

    res.json({
      success: true,
      data: {
        attendancePercent,
        totalFeeDue: totalDue,
        examStatus: `${passedExams}/${totalExams} passed`,
        noticesCount
      }
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Get Super Admin dashboard data
const getSuperAdminDashboard = async (req, res) => {
  try {
    if (req.user.role !== USER_ROLES.SUPER_ADMIN) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Super Admin only.'
      });
    }

    const School = require('../models/School');
    const AuditLog = require('../models/AuditLog');
    const Backup = require('../models/Backup');
    const AcademicSession = require('../models/AcademicSession');
    const mongoose = require('mongoose');

    const now = new Date();
    const yesterday = new Date(now - 24 * 60 * 60 * 1000);
    const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);
    const thirtyDaysLater = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const sevenDaysLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const [
      totalSchools,
      totalUsers,
      totalStudents,
      totalTeachers,
      activeSessions,
      recentLogs,
    ] = await Promise.all([
      School.countDocuments(),
      User.countDocuments(),
      Student.countDocuments(),
      User.countDocuments({ role: USER_ROLES.TEACHER }),
      AcademicSession.countDocuments({ status: 'ACTIVE' }),
      AuditLog.countDocuments({ createdAt: { $gte: yesterday } }),
    ]);

    const [
      activeSubscriptions,
      expiredSubscriptions,
      expiringIn30Days,
      expiringIn7Days,
      freeTrialSchools,
    ] = await Promise.all([
      School.countDocuments({
        'subscription.status': 'active',
        'subscription.endDate': { $gte: now }
      }),
      School.countDocuments({
        $or: [
          { 'subscription.status': 'expired' },
          { 'subscription.endDate': { $lt: now } }
        ]
      }),
      School.countDocuments({
        'subscription.endDate': { $gte: now, $lte: thirtyDaysLater },
        'subscription.status': 'active'
      }),
      School.countDocuments({
        'subscription.endDate': { $gte: now, $lte: sevenDaysLater },
        'subscription.status': 'active'
      }),
      School.countDocuments({ 'subscription.plan': 'trial' }),
    ]);

    const [recentBackupsCount, schoolsWithRecentBackupIds] = await Promise.all([
      Backup.countDocuments({ createdAt: { $gte: weekAgo } }),
      Backup.distinct('schoolId', { createdAt: { $gte: weekAgo } }),
    ]);
    const schoolsWithIssues = totalSchools - schoolsWithRecentBackupIds.length;

    const [failedLogins, suspiciousActivity] = await Promise.all([
      AuditLog.countDocuments({
        action: { $in: ['LOGIN_FAILED', 'INVALID_TOKEN', 'UNAUTHORIZED_ACCESS'] },
        createdAt: { $gte: yesterday }
      }),
      AuditLog.countDocuments({
        severity: { $in: ['WARNING', 'CRITICAL', 'ERROR'] },
        createdAt: { $gte: yesterday }
      }),
    ]);

    const newSchoolsThisMonth = await School.countDocuments({
      createdAt: { $gte: monthAgo }
    });

    const dbStatus = mongoose.connection.readyState === 1 ? 'healthy' : 'unhealthy';
    const uptime = Math.floor(process.uptime());

    const recentActivity = await AuditLog.find({ createdAt: { $gte: yesterday } })
      .sort({ createdAt: -1 })
      .limit(10)
      .select('action entityType details severity createdAt ipAddress')
      .populate('userId', 'name role')
      .lean();

    const schoolsList = await School.find()
      .select('name subscription createdAt isActive')
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    res.json({
      success: true,
      data: {
        totalSchools,
        totalUsers,
        totalStudents,
        totalTeachers,
        activeSessions,
        recentLogs,
        newSchoolsThisMonth,

        activeSubscriptions,
        expiredSubscriptions,
        expiringIn30Days,
        expiringIn7Days,
        freeTrialSchools,
        pendingRenewals: expiringIn30Days,

        recentBackups: recentBackupsCount,
        schoolsWithIssues,
        failedLogins,
        suspiciousActivityCount: suspiciousActivity,

        systemHealth: {
          database: dbStatus,
          uptime,
          api: 'healthy',
          memory: process.memoryUsage().heapUsed,
          memoryTotal: process.memoryUsage().heapTotal,
        },

        recentActivity,
        schools: schoolsList,
      }
    });
  } catch (err) {
    console.error('[SuperAdminDashboard]', err);
    res.status(500).json({
      success: false,
      message: err.message || 'Internal server error'
    });
  }
};

module.exports = {
  getPrincipalDashboard,
  getOperatorDashboard,
  getTeacherDashboard,
  getStudentDashboard,
  getSuperAdminDashboard
};
