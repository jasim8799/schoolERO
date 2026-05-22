const cron = require('node-cron');
const os = require('os');

const School = require('../models/School');
const User = require('../models/User');
const Student = require('../models/Student');
const AuditLog = require('../models/AuditLog');
const LoginSession = require('../models/LoginSession');
const redis = require('../config/redis');
const { runHealthScanAllSchools } = require('../services/school.health.service');

async function runSchoolAnalyticsUpdate() {
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 86400000);

  const [studentCounts, teacherCounts, activeSessions, alertCounts] = await Promise.all([
    Student.aggregate([
      { $group: { _id: '$schoolId', count: { $sum: 1 } } }
    ]).catch(() => []),
    User.aggregate([
      { $match: { role: 'TEACHER', isDeleted: { $ne: true } } },
      { $group: { _id: '$schoolId', count: { $sum: 1 } } }
    ]).catch(() => []),
    LoginSession.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: '$schoolId', count: { $sum: 1 } } }
    ]).catch(() => []),
    AuditLog.aggregate([
      { $match: { createdAt: { $gte: dayAgo }, severity: { $in: ['WARNING', 'ERROR', 'CRITICAL'] } } },
      { $group: { _id: '$schoolId', count: { $sum: 1 } } }
    ]).catch(() => [])
  ]);

  const studentMap = Object.fromEntries(studentCounts.map((r) => [r._id?.toString(), r.count]));
  const teacherMap = Object.fromEntries(teacherCounts.map((r) => [r._id?.toString(), r.count]));
  const sessionMap = Object.fromEntries(activeSessions.map((r) => [r._id?.toString(), r.count]));
  const alertMap = Object.fromEntries(alertCounts.map((r) => [r._id?.toString(), r.count]));

  const dbStart = Date.now();
  await School.findOne().select('_id').lean().catch(() => {});
  const dbLatencyMs = Math.max(1, Date.now() - dbStart);

  const cpuLoad = Math.min(99, Math.round(os.loadavg()[0] * 10));

  const schools = await School.find({ isDeleted: { $ne: true } }).select('_id').lean();
  const bulkOps = schools.map((s) => {
    const id = s._id.toString();
    return {
      updateOne: {
        filter: { _id: s._id },
        update: {
          $set: {
            'analytics.studentsCount': studentMap[id] || 0,
            'analytics.teachersCount': teacherMap[id] || 0,
            'analytics.onlineUsers': sessionMap[id] || 0,
            'analytics.alertsCount': alertMap[id] || 0,
            'analytics.apiLatencyMs': dbLatencyMs + 10,
            'analytics.cpuUsagePct': cpuLoad / 100,
            'analytics.lastAnalyticsSync': now
          }
        }
      }
    };
  });

  if (bulkOps.length > 0) {
    await School.bulkWrite(bulkOps, { ordered: false }).catch(console.error);
  }

  const keys = await redis.keys('schools:list:*').catch(() => []);
  if (keys.length > 0) {
    await Promise.all(keys.map((k) => redis.del(k))).catch(() => {});
  }

  await redis.del('schools:totals:v2').catch(() => {});

  console.log(`[SchoolAnalyticsCron] Updated ${bulkOps.length} schools`);
}

function registerSchoolAnalyticsCronJobs() {
  cron.schedule('*/5 * * * *', () => {
    runSchoolAnalyticsUpdate().catch(console.error);
  });

  cron.schedule('*/15 * * * *', () => {
    runHealthScanAllSchools().catch(console.error);
  });

  setTimeout(() => runSchoolAnalyticsUpdate().catch(console.error), 8000);
  setTimeout(() => runHealthScanAllSchools().catch(console.error), 15000);

  console.log('[Cron] School analytics cron registered');
}

module.exports = { registerSchoolAnalyticsCronJobs, runSchoolAnalyticsUpdate };
