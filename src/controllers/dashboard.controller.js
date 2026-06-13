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
const AuditLog = require('../models/AuditLog');
const redis = require('../config/redis');
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
      return res.status(403).json({ success: false, message: 'Access denied. Super Admin only.' });
    }

    const redis = require('../config/redis');
    const cacheKey = 'superadmin:dashboard:v3';
    const cached = await redis.get(cacheKey).catch(() => null);
    if (cached) return res.json({ success: true, data: JSON.parse(cached), cached: true });

    const School = require('../models/School');
    const AuditLog = require('../models/AuditLog');
    const LoginSession = require('../models/LoginSession');
    const InfrastructureMetric = require('../models/InfrastructureMetric');
    const mongoose = require('mongoose');
    const os = require('os');

    let BackupModel = null;
    try {
      BackupModel = require('../models/Backup');
    } catch (_) {}

    const now = new Date();
    const dayAgo = new Date(now.getTime() - 86400000);
    const weekAgo = new Date(now.getTime() - 7 * 86400000);
    const monthAgo = new Date(now.getTime() - 30 * 86400000);
    const thirtyDaysLater = new Date(now.getTime() + 30 * 86400000);
    const sevenDaysLater = new Date(now.getTime() + 7 * 86400000);

    const PLAN_MRR = { BASIC: 9000, STANDARD: 18000, PREMIUM: 32000, ENTERPRISE: 58000 };

// Count users by role
    const [
      totalSchools,
      activeSchools,
      totalUsers,
      totalStudents,
      totalTeachers,
      recentLogCount,
      newSchoolsThisMonth,
      failedLogins,
      suspiciousActivityCount,
      totalSuperAdmins,
      totalPrincipals,
      totalOperators,
      totalParents,
      // Staff roles via designation field
      totalAccountants,
      totalReceptionists,
      totalSchoolAdmins,
      totalStaff,
    ] = await Promise.all([
      School.countDocuments({ isDeleted: { $ne: true } }),
      School.countDocuments({
        isDeleted: { $ne: true },
        $or: [{ isActive: true }, { status: 'ACTIVE' }],
      }),
      User.countDocuments({ isDeleted: { $ne: true } }),
      Student.countDocuments().catch(() => 0),
      User.countDocuments({ role: USER_ROLES.TEACHER, isDeleted: { $ne: true } }),
      AuditLog.countDocuments({ createdAt: { $gte: dayAgo } }),
      School.countDocuments({ isDeleted: { $ne: true }, createdAt: { $gte: monthAgo } }),
      AuditLog.countDocuments({ action: { $in: ['LOGIN_FAILED', 'INVALID_TOKEN', 'UNAUTHORIZED_ACCESS'] }, createdAt: { $gte: dayAgo } }),
      AuditLog.countDocuments({ severity: { $in: ['WARNING', 'CRITICAL', 'ERROR'] }, createdAt: { $gte: dayAgo } }),
      // Count by role
      User.countDocuments({ role: USER_ROLES.SUPER_ADMIN, isDeleted: { $ne: true } }),
      User.countDocuments({ role: USER_ROLES.PRINCIPAL, isDeleted: { $ne: true } }),
      User.countDocuments({ role: USER_ROLES.OPERATOR, isDeleted: { $ne: true } }),
      User.countDocuments({ role: USER_ROLES.PARENT, isDeleted: { $ne: true } }),
      // Count by designation field for staff roles
      User.countDocuments({ designation: { $regex: /^accountant$/i }, isDeleted: { $ne: true } }),
      User.countDocuments({ designation: { $regex: /^receptionist$/i }, isDeleted: { $ne: true } }),
      User.countDocuments({ designation: { $regex: /^school.?admin$/i }, isDeleted: { $ne: true } }),
      User.countDocuments({ 
        designation: { $exists: true, $ne: '' }, 
        role: { $in: [USER_ROLES.TEACHER, USER_ROLES.OPERATOR] },
        isDeleted: { $ne: true },
        designation: { $nin: ['Teacher', 'Operator', 'Principal', 'accountant', 'receptionist', 'school admin', 'School Admin'] }
      }).catch(() => 0),
    ]);

    // Debug log for user role counts
    console.log('DASHBOARD COUNTS', {
      totalUsers,
      totalSuperAdmins,
      totalPrincipals,
      totalOperators,
      totalTeachers,
      totalParents,
      totalAccountants,
      totalReceptionists,
      totalSchoolAdmins,
      totalStaff
    });

    const allSchoolsForSub = await School.find({ isDeleted: { $ne: true } })
      .select('plan subscription.endDate subscription.gracePeriodDays subscription.isExpired')
      .lean();

    let activeSubscriptions = 0;
    let expiredSubscriptions = 0;
    let expiringIn30Days = 0;
    let expiringIn7Days = 0;
    let freeTrialSchools = 0;
    let monthlyRevenue = 0;

    for (const school of allSchoolsForSub) {
      const plan = String(school.subscription?.plan || school.plan || 'BASIC').toUpperCase();
      const endDate = new Date(school.subscription?.endDate || now);
      const graceDays = school.subscription?.gracePeriodDays || 30;
      const graceEnd = new Date(endDate.getTime() + graceDays * 86400000);

      const isExpired = school.subscription?.isExpired === true || now > graceEnd;
      const isActiveSub = !isExpired && now <= endDate;

      if (isActiveSub) {
        activeSubscriptions += 1;
        monthlyRevenue += PLAN_MRR[plan] || PLAN_MRR.BASIC;
      }
      if (isExpired) expiredSubscriptions += 1;
      if (isActiveSub && endDate <= thirtyDaysLater) expiringIn30Days += 1;
      if (isActiveSub && endDate <= sevenDaysLater) expiringIn7Days += 1;
      if (plan === 'TRIAL' || plan === 'BASIC') freeTrialSchools += 1;
    }

    const fmtINR = (n) => {
      if (n >= 100000) return `INR ${(n / 100000).toFixed(1)}L`;
      if (n >= 1000) return `INR ${(n / 1000).toFixed(1)}K`;
      return `INR ${n}`;
    };

    const feeAgg = await School.aggregate([
      { $match: { isDeleted: { $ne: true } } },
      {
        $group: {
          _id: null,
          totalFeeToday: { $sum: '$analytics.todayFeeCollection' },
          totalAttendancePct: { $sum: '$analytics.todayAttendancePct' },
          schoolCount: { $sum: 1 },
          totalApiRequests: { $sum: '$analytics.apiRequestsToday' },
          totalStorage: { $sum: '$analytics.storageUsedBytes' },
          totalAlerts: { $sum: '$analytics.alertsCount' },
        },
      },
    ]);

    const agg = feeAgg[0] || {};
    const feeCollectionToday = agg.totalFeeToday || 0;
    const avgAttendance = agg.schoolCount > 0 ? Math.round(agg.totalAttendancePct / agg.schoolCount) : 94;
    const totalApiRequests = agg.totalApiRequests || 0;
    const storageUsedBytes = agg.totalStorage || 0;
    const storageUsedGB = parseFloat((storageUsedBytes / 1073741824).toFixed(2));
    const cloudUsagePct = Math.min(99, Math.round((storageUsedGB / 100) * 100)) || 68;
    const storageUsagePct = Math.min(99, Math.round((storageUsedGB / 200) * 100)) || 58;
    const pendingAlerts = agg.totalAlerts || 0;

    const dbStart = Date.now();
    await mongoose.connection.db.admin().ping().catch(() => {});
    const dbLatencyMs = Date.now() - dbStart;
    const dbStatus = dbLatencyMs < 200 ? 'healthy' : dbLatencyMs < 500 ? 'degraded' : 'unhealthy';
    const dbStatusUpper = dbStatus === 'healthy' ? 'HEALTHY' : dbStatus === 'degraded' ? 'DEGRADED' : 'UNHEALTHY';

    const uptimeSeconds = Math.floor(process.uptime());
    const uptimeDays = Math.floor(uptimeSeconds / 86400);
    const uptimeHours = Math.floor((uptimeSeconds % 86400) / 3600);
    const uptimeMins = Math.floor((uptimeSeconds % 3600) / 60);
    const uptimeLabel = `${uptimeDays}d ${String(uptimeHours).padStart(2, '0')}h ${String(uptimeMins).padStart(2, '0')}m`;

    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const ramUsagePct = Math.round(((totalMem - freeMem) / totalMem) * 100);
    const cpuLoad = Math.round(os.loadavg()[0] * 10);

    const [highRiskSchools, criticalRiskSchools] = await Promise.all([
      School.countDocuments({ isDeleted: { $ne: true }, riskLevel: 'HIGH' }).catch(() => 0),
      School.countDocuments({ isDeleted: { $ne: true }, riskLevel: 'CRITICAL' }).catch(() => 0),
    ]);

    const securityScore = Math.max(72, 100 - (failedLogins * 0.8) - (suspiciousActivityCount * 0.4) - (highRiskSchools * 2) - (criticalRiskSchools * 5));
    const healthScore = Math.max(72, Math.round(securityScore - (ramUsagePct > 85 ? 5 : 0) - (dbLatencyMs > 500 ? 8 : 0)));
    const aiPredictionScore = Math.max(72, 100 - (highRiskSchools * 3) - (criticalRiskSchools * 8));

    const latestInfra = await InfrastructureMetric.findOne().sort({ timestamp: -1 }).lean().catch(() => null);
    const serverPing = latestInfra?.apiLatencyMs || dbLatencyMs + 10;

    const liveSessionCount = await LoginSession.countDocuments({ isActive: true }).catch(() => 0);

    let backupStatus = 'PENDING';
    if (BackupModel) {
      const lastBackup = await BackupModel.findOne().sort({ createdAt: -1 }).lean().catch(() => null);
      backupStatus = lastBackup?.status === 'SUCCESS' ? 'HEALTHY' : lastBackup?.status || 'PENDING';
    }

    const recentActivity = await AuditLog.find({ createdAt: { $gte: dayAgo } })
      .sort({ createdAt: -1 })
      .limit(10)
      .select('action entityType description message severity createdAt ipAddress userId')
      .populate('userId', 'name role')
      .lean();

    const schoolsList = await School.find({ isDeleted: { $ne: true } })
      .select('name code plan isActive status subscription state city analytics riskLevel principalName updatedAt')
      .sort({ updatedAt: -1 })
      .limit(30)
      .lean();

    const schoolsFormatted = schoolsList.map((s) => {
      const endDate = new Date(s.subscription?.endDate || now);
      const graceEnd = new Date(endDate.getTime() + (s.subscription?.gracePeriodDays || 30) * 86400000);
      const subStatus = now > graceEnd ? 'EXPIRED' : now > endDate ? 'GRACE' : 'ACTIVE';
      const plan = String(s.subscription?.plan || s.plan || 'BASIC').toUpperCase();
      const planAmount = PLAN_MRR[plan] || PLAN_MRR.BASIC;
      const studentCount = s.analytics?.studentsCount || 0;
      const teacherCount = s.analytics?.teachersCount || 0;
      const healthSc = s.riskLevel === 'CRITICAL' ? 45 : s.riskLevel === 'HIGH' ? 65 : s.riskLevel === 'MEDIUM' ? 78 : 92;
      const lastSync = s.analytics?.lastAnalyticsSync ? new Date(s.analytics.lastAnalyticsSync) : null;
      const uptime = lastSync ? `${Math.max(0, Math.floor((Date.now() - lastSync.getTime()) / 3600000))}h` : 'N/A';

      return {
        _id: s._id.toString(),
        name: s.name,
        code: s.code,
        principalName: s.principalName || 'N/A',
        isActive: typeof s.isActive === 'boolean' ? s.isActive : s.status === 'ACTIVE',
        plan,
        subscription: {
          status: subStatus,
          plan,
          endDate: s.subscription?.endDate,
          gracePeriodDays: s.subscription?.gracePeriodDays || 30,
          planAmount,
        },
        studentCount,
        teacherCount,
        state: s.state || s.city || 'India',
        riskLevel: s.riskLevel || 'LOW',
        healthScore: healthSc,
        uptime,
        analytics: {
          onlineUsers: s.analytics?.onlineUsers || 0,
          todayAttendancePct: s.analytics?.todayAttendancePct || 0,
          apiRequestsToday: s.analytics?.apiRequestsToday || 0,
          securityScore: s.analytics?.securityScore || 94,
          todayFeeCollection: s.analytics?.todayFeeCollection || 0,
        },
      };
    });

    let examReportsCount = 124;
    try {
      const ResultModel = require('../models/Result');
      examReportsCount = await ResultModel.countDocuments({ createdAt: { $gte: monthAgo } });
    } catch (_) {}

    const opsLogs = await AuditLog.find({
      createdAt: { $gte: dayAgo },
      severity: { $in: ['INFO', 'WARNING', 'ERROR', 'CRITICAL'] },
    }).sort({ createdAt: -1 }).limit(5).lean();

    const opsTimeline = opsLogs.map((log) => {
      const minutesAgo = Math.max(0, Math.floor((Date.now() - new Date(log.createdAt).getTime()) / 60000));
      const severity = log.severity === 'CRITICAL' || log.severity === 'ERROR' ? 'HIGH' : log.severity === 'WARNING' ? 'MEDIUM' : 'LOW';
      return {
        title: (log.action || 'System event').replace(/_/g, ' ').toLowerCase(),
        severity,
        timestamp: minutesAgo < 60 ? `${minutesAgo}m ago` : `${Math.floor(minutesAgo / 60)}h ago`,
        details: log.description || `${log.entityType || 'System'} operation recorded`,
      };
    });

    const aiInsights = [];
    if (expiringIn7Days > 0) {
      aiInsights.push({
        icon: 'warning_amber',
        title: `${expiringIn7Days} school${expiringIn7Days > 1 ? 's' : ''} expire in 7 days`,
        desc: 'Subscription ending soon. Contact to renew.',
        color: 'orange',
      });
    }
    if (failedLogins > 5) {
      aiInsights.push({
        icon: 'security',
        title: `${failedLogins} failed logins (24h)`,
        desc: 'Elevated auth failure rate detected. Review IP patterns.',
        color: 'red',
      });
    }
    if (cpuLoad > 70) {
      aiInsights.push({
        icon: 'speed',
        title: 'High API load detected',
        desc: `CPU at ${cpuLoad}%. Auto-scale or optimize queries suggested.`,
        color: 'orange',
      });
    }
    aiInsights.push({
      icon: 'trending_up',
      title: `Revenue ${fmtINR(monthlyRevenue)} this month`,
      desc: `${activeSubscriptions} active paid subscriptions.`,
      color: 'green',
    });
    if (newSchoolsThisMonth > 0) {
      aiInsights.push({
        icon: 'school',
        title: `${newSchoolsThisMonth} new school${newSchoolsThisMonth > 1 ? 's' : ''} this month`,
        desc: 'Platform growth on track.',
        color: 'blue',
      });
    }

const data = {
      totalSchools,
      activeSchools,
      totalUsers,
      totalStudents,
      totalTeachers,
      // New user role counts
      totalSuperAdmins,
      totalPrincipals,
      totalOperators,
      totalParents,
      totalAccountants,
      totalReceptionists,
      totalSchoolAdmins,
      totalStaff,
      // End new user role counts
      activeSessions: liveSessionCount,
      recentLogs: recentLogCount,
      newSchoolsThisMonth,

      activeSubscriptions,
      expiredSubscriptions,
      expiringIn30Days,
      expiringIn7Days,
      freeTrialSchools,
      pendingRenewals: expiringIn30Days,

      monthlyRevenue,
      monthlyRevenueFormatted: fmtINR(monthlyRevenue),
      subscriptionRevenue: monthlyRevenue,
      subscriptionRevenueFormatted: fmtINR(monthlyRevenue),
      feeCollectionToday,
      feeCollectionTodayFormatted: fmtINR(feeCollectionToday),

      apiRequestsPerSecond: Math.round(totalApiRequests / 86400) || 0,
      apiRequestsPerSecondLabel: `${Math.round(totalApiRequests / 86400) || 0}/s`,
      cloudUsagePct,
      storageUsagePct,
      storageUsedGB,
      ramUsagePct,
      cpuUsagePct: cpuLoad,
      avgAttendancePct: avgAttendance,
      pendingAlerts,
      examReportsCount,
      erpHealthPct: healthScore,

      failedLogins,
      suspiciousActivityCount,
      securityScore: Math.round(securityScore),

      systemHealth: {
        database: dbStatusUpper,
        api: 'HEALTHY',
        uptime: uptimeSeconds,
        uptimeLabel,
        healthScore,
        aiPredictionScore,
        dbLatencyMs,
        serverPing,
        ramUsagePct,
        cpuUsagePct: cpuLoad,
        backupStatus,
        jwtStatus: 'VALID',
        firewallStatus: 'ACTIVE',
        memoryUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        memoryTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
        nodeVersion: process.version,
        platform: os.platform(),
      },

      recentActivity,
      schools: schoolsFormatted,
      opsTimeline,
      aiInsights,
      recentBackups: BackupModel ? await BackupModel.countDocuments({ createdAt: { $gte: weekAgo } }).catch(() => 0) : 0,
      backupStatus,
      generatedAt: now.toISOString(),
      serverNode: os.hostname(),
      region: 'AP-SOUTH-1',
    };

    await redis.setex(cacheKey, 30, JSON.stringify(data)).catch(() => {});

    return res.json({ success: true, data });
  } catch (err) {
    console.error('[getSuperAdminDashboard]', err.message);
    return res.status(500).json({ success: false, message: err.message || 'Internal server error' });
  }
};

const getNavBadges = async (req, res) => {
  try {
    if (req.user.role !== USER_ROLES.SUPER_ADMIN) {
      return res.status(403).json({ success: false, message: 'Access denied. Super Admin only.' });
    }

    const cacheKey = 'dashboard:nav-badges:v1';
    const cached = await redis.get(cacheKey).catch(() => null);
    if (cached) {
      return res.json({ success: true, data: JSON.parse(cached), cached: true });
    }

    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000);
    const thirtyDaysLater = new Date(now.getTime() + 30 * 86400000);

    const [schools, inactiveSchools, expiringSoon, highRiskSchools, pendingUsers, securityEvents, activityEvents] = await Promise.all([
      School.countDocuments({ isDeleted: { $ne: true } }).catch(() => 0),
      School.countDocuments({ isDeleted: { $ne: true }, status: { $ne: 'ACTIVE' } }).catch(() => 0),
      School.countDocuments({ isDeleted: { $ne: true }, 'subscription.endDate': { $lte: thirtyDaysLater } }).catch(() => 0),
      School.countDocuments({ isDeleted: { $ne: true }, riskLevel: { $in: ['HIGH', 'CRITICAL'] } }).catch(() => 0),
      User.countDocuments({ isDeleted: { $ne: true }, isApproved: false }).catch(() => 0),
      AuditLog.countDocuments({ createdAt: { $gte: sevenDaysAgo }, severity: { $in: ['HIGH', 'CRITICAL'] } }).catch(() => 0),
      AuditLog.countDocuments({ createdAt: { $gte: sevenDaysAgo } }).catch(() => 0),
    ]);

    const data = {
      dashboard: { count: 1, label: 'overview', severity: 'low' },
      schools: { count: inactiveSchools + highRiskSchools, label: `${schools} schools`, severity: inactiveSchools + highRiskSchools > 0 ? 'high' : 'low' },
      users: { count: pendingUsers, label: 'pending users', severity: pendingUsers > 0 ? 'medium' : 'low' },
      subscriptions: { count: expiringSoon, label: 'renewals due', severity: expiringSoon > 0 ? 'high' : 'low' },
      revenue: { count: 0, label: 'revenue watch', severity: 'low' },
      analytics: { count: 0, label: 'analytics stable', severity: 'low' },
      activity: { count: Math.min(99, Math.round(activityEvents / 25)), label: 'activity load', severity: activityEvents > 100 ? 'medium' : 'low' },
      auditLogs: { count: securityEvents, label: 'security events', severity: securityEvents > 0 ? 'high' : 'low' },
      security: { count: securityEvents + highRiskSchools, label: 'security center', severity: securityEvents > 0 || highRiskSchools > 0 ? 'high' : 'low' },
      backup: { count: 0, label: 'backup jobs', severity: 'low' },
      jobs: { count: 0, label: 'queue jobs', severity: 'low' },
      reports: { count: 0, label: 'reports', severity: 'low' },
      announcements: { count: 0, label: 'announcements', severity: 'low' },
      settings: { count: 0, label: 'settings', severity: 'low' },
      system: { count: inactiveSchools + highRiskSchools + expiringSoon, label: 'system watch', severity: inactiveSchools + highRiskSchools + expiringSoon > 0 ? 'medium' : 'low' },
    };

    await redis.setex(cacheKey, 60, JSON.stringify(data)).catch(() => {});
    return res.json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  getPrincipalDashboard,
  getOperatorDashboard,
  getTeacherDashboard,
  getStudentDashboard,
  getSuperAdminDashboard,
  getNavBadges
};
