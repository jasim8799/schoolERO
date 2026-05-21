const School = require('../models/School');
const User = require('../models/User');
const Student = require('../models/Student');
const StudentDailyAttendance = require('../models/StudentDailyAttendance');
const Payment = require('../models/Payment');
const SecurityLog = require('../models/SecurityLog');
const SchoolAnalyticsDaily = require('../models/SchoolAnalyticsDaily');
const redis = require('../config/redis');

async function runAnalyticsSnapshot() {
  const startTime = Date.now();
  const schools = await School.find({ isDeleted: false }).select('_id limits').lean();

  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  for (const school of schools) {
    const schoolId = school._id;
    try {
      const [
        studentsCount,
        teachersCount,
        attendanceDocs,
        paymentAgg,
        recentAlerts,
        activeUsers30min,
        activeUsersToday,
        apiReqCount
      ] = await Promise.all([
        Student.countDocuments({ schoolId }),
        User.countDocuments({ schoolId, role: 'TEACHER', status: 'active' }),
        StudentDailyAttendance.find({ schoolId, date: { $gte: todayStart, $lt: todayEnd } })
          .select('status')
          .lean(),
        Payment.aggregate([
          { $match: { schoolId, paymentDate: { $gte: todayStart, $lt: todayEnd } } },
          { $group: { _id: null, total: { $sum: '$amount' } } }
        ]),
        SecurityLog.countDocuments({
          schoolId,
          severity: { $in: ['WARNING', 'ERROR', 'CRITICAL'] },
          createdAt: { $gte: dayAgo }
        }),
        User.countDocuments({
          schoolId,
          status: 'active',
          lastLogin: { $gte: new Date(now.getTime() - 30 * 60000) }
        }),
        User.countDocuments({
          schoolId,
          status: 'active',
          lastLogin: { $gte: todayStart }
        }),
        redis.get(`apiRequests:${schoolId}:${todayStart.toISOString().split('T')[0]}`)
      ]);

      const presentCount = attendanceDocs.filter((a) => ['present', 'PRESENT'].includes(a.status)).length;
      const attendancePct = attendanceDocs.length
        ? Math.round((presentCount / attendanceDocs.length) * 100)
        : 0;

      const todayFeeCollection = paymentAgg[0]?.total || 0;

      const analytics = {
        studentsCount,
        teachersCount,
        onlineUsers: activeUsers30min,
        activeUsersToday,
        todayAttendancePct: attendancePct,
        todayFeeCollection,
        alertsCount: recentAlerts,
        apiRequestsToday: parseInt(apiReqCount || '0', 10),
        storageUsedBytes: 0,
        securityScore: Math.max(40, 100 - recentAlerts * 3),
        cpuUsagePct: 0.4,
        apiLatencyMs: 24,
        lastAnalyticsSync: now
      };

      await School.findByIdAndUpdate(schoolId, { $set: { analytics } });

      await SchoolAnalyticsDaily.findOneAndUpdate(
        { schoolId, date: todayStart },
        { $set: { ...analytics, date: todayStart } },
        { upsert: true }
      );
    } catch (error) {
      console.error(`[analyticsSnapshot] school=${schoolId} error=${error.message}`);
    }
  }

  console.log(`[analyticsSnapshot] Updated ${schools.length} schools in ${Date.now() - startTime}ms`);
}

module.exports = { runAnalyticsSnapshot };
