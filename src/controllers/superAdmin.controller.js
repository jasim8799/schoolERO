const mongoose = require('mongoose');
const os = require('os');
const School = require('../models/School');
const SecurityLog = require('../models/SecurityLog');
const InfrastructureMetric = require('../models/InfrastructureMetric');
const BackupRecord = require('../models/BackupRecord');
const LoginSession = require('../models/LoginSession');
const redis = require('../config/redis');

// GET /api/admin/dashboard
const getDashboard = async (req, res) => {
  try {
    const cacheKey = 'superadmin:dashboard:v2';
    const cached = await redis.get(cacheKey);
    if (cached) {
      return res.json({ success: true, data: JSON.parse(cached), cached: true });
    }

    const now = new Date();
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const [
      totalSchools,
      activeSubscriptions,
      expiredSubscriptions,
      trialSchools,
      gracePeriodSchools
    ] = await Promise.all([
      School.countDocuments({ isDeleted: false }),
      School.countDocuments({
        isDeleted: false,
        status: 'active',
        'subscription.endDate': { $gt: now }
      }),
      School.countDocuments({
        isDeleted: false,
        'subscription.endDate': { $lte: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) }
      }),
      School.countDocuments({
        isDeleted: false,
        plan: 'BASIC',
        'subscription.endDate': { $gt: now, $lte: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000) }
      }),
      School.countDocuments({
        isDeleted: false,
        'subscription.endDate': {
          $lte: now,
          $gt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
        }
      })
    ]);

    const [schoolAgg] = await School.aggregate([
      { $match: { isDeleted: false } },
      {
        $group: {
          _id: null,
          totalOnlineUsers: { $sum: '$analytics.onlineUsers' },
          totalAttendanceToday: { $sum: '$analytics.todayAttendancePct' },
          totalFeeToday: { $sum: '$analytics.todayFeeCollection' },
          totalApiRequests: { $sum: '$analytics.apiRequestsToday' },
          totalStorage: { $sum: '$analytics.storageUsedBytes' },
          totalAlerts: { $sum: '$analytics.alertsCount' },
          avgSecurityScore: { $avg: '$analytics.securityScore' },
          totalOnlineStaff: { $sum: '$analytics.teachersCount' },
          schoolCount: { $sum: 1 }
        }
      }
    ]);

    const [failedLogins24h, activeDevices, latestInfra, lastBackup, highRiskSchools, criticalRiskSchools] =
      await Promise.all([
        SecurityLog.countDocuments({ eventType: 'LOGIN_FAILED', createdAt: { $gte: dayAgo } }),
        LoginSession.countDocuments({
          isActive: true,
          lastActiveAt: { $gte: new Date(now.getTime() - 30 * 60 * 1000) }
        }),
        InfrastructureMetric.findOne().sort({ timestamp: -1 }).lean(),
        BackupRecord.findOne().sort({ createdAt: -1 }).lean(),
        School.countDocuments({ isDeleted: false, riskLevel: 'HIGH' }),
        School.countDocuments({ isDeleted: false, riskLevel: 'CRITICAL' })
      ]);

    const dbStart = Date.now();
    await School.findOne().select('_id').lean();
    const dbLatencyMs = Date.now() - dbStart;

    const memInfo = process.memoryUsage();
    const cpuLoad = os.loadavg()[0];
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const ramUsagePct = Math.round(((totalMem - freeMem) / totalMem) * 100);

    const backupStatus = lastBackup
      ? (lastBackup.status === 'SUCCESS' ? 'HEALTHY' : (lastBackup.status || 'PENDING'))
      : 'PENDING';

    const aiHealthScore = Math.max(0, 100 - highRiskSchools * 3 - criticalRiskSchools * 8);

    const agg = schoolAgg || {};

    const data = {
      metrics: {
        totalSchools,
        activeSubscriptions,
        expiredSubscriptions,
        trialSchools,
        gracePeriodSchools,
        activeOnlineUsers: agg.totalOnlineUsers || 0,
        attendanceToday: agg.schoolCount ? Math.round(agg.totalAttendanceToday / agg.schoolCount) : 0,
        feeCollectionToday: agg.totalFeeToday || 0,
        apiRequestsToday: agg.totalApiRequests || 0,
        storageUsageBytes: agg.totalStorage || 0,
        storageUsageGB: parseFloat((((agg.totalStorage || 0) / 1073741824)).toFixed(2)),
        securityScore: Math.round(agg.avgSecurityScore || 94),
        pendingAlerts: agg.totalAlerts || 0,
        onlineStaff: agg.totalOnlineStaff || 0,
        cpuUsagePct: Math.round(cpuLoad * 10),
        ramUsagePct,
        databaseLoadMs: dbLatencyMs,
        serverLatencyMs: latestInfra?.apiLatencyMs || 24,
        activeDevices,
        failedLoginAttempts: failedLogins24h,
        backupStatus,
        aiPredictionHealth: aiHealthScore
      },
      systemInfo: {
        nodeVersion: process.version,
        platform: os.platform(),
        uptime: `${Math.round(process.uptime() / 3600)}h`,
        memoryUsed: `${Math.round(memInfo.heapUsed / 1024 / 1024)}MB`
      },
      generatedAt: now
    };

    await redis.setex(cacheKey, 30, JSON.stringify(data));
    return res.json({ success: true, data });
  } catch (error) {
    console.error('[getDashboard]', error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/admin/schools
const getAllSchoolsEnhanced = async (req, res) => {
  try {
    const { status, plan, sort = 'updatedAt', page = 1, limit = 50, search, riskLevel } = req.query;
    const query = { isDeleted: false };

    if (status && status !== 'ALL') {
      if (status === 'ACTIVE') query['subscription.endDate'] = { $gt: new Date() };
      if (status === 'EXPIRED') query['subscription.endDate'] = { $lte: new Date(Date.now() - 30 * 86400000) };
      if (status === 'GRACE') {
        query['subscription.endDate'] = {
          $lte: new Date(),
          $gt: new Date(Date.now() - 30 * 86400000)
        };
      }
      if (status === 'TRIAL') query.plan = 'BASIC';
    }

    if (plan && plan !== 'ALL') query.plan = plan;
    if (riskLevel && riskLevel !== 'ALL') query.riskLevel = riskLevel;

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { code: { $regex: search, $options: 'i' } },
        { city: { $regex: search, $options: 'i' } }
      ];
    }

    const sortMap = {
      Activity: { 'analytics.lastAnalyticsSync': -1 },
      Health: { healthScore: -1 },
      Revenue: { 'analytics.todayFeeCollection': -1 },
      Security: { 'analytics.securityScore': -1 },
      Students: { 'analytics.studentsCount': -1 }
    };

    const sortObj = sortMap[sort] || { updatedAt: -1 };
    const skip = (Math.max(1, parseInt(page, 10)) - 1) * Math.max(1, parseInt(limit, 10));
    const cap = Math.min(200, Math.max(1, parseInt(limit, 10)));

    const [schools, total] = await Promise.all([
      School.find(query).sort(sortObj).skip(skip).limit(cap).lean(),
      School.countDocuments(query)
    ]);

    const data = schools.map((s) => {
      const now = new Date();
      const endDate = new Date(s.subscription?.endDate || now);
      const graceEnd = new Date(endDate.getTime() + ((s.subscription?.gracePeriodDays || 30) * 86400000));
      const subscriptionStatus = now > graceEnd ? 'EXPIRED' : now > endDate ? 'GRACE' : 'ACTIVE';

      return {
        ...s,
        subscription: {
          ...(s.subscription || {}),
          status: subscriptionStatus,
        },
        studentsCount: s.analytics?.studentsCount || 0,
        teachersCount: s.analytics?.teachersCount || 0,
        onlineUsers: s.analytics?.onlineUsers || 0,
        todayAttendance: s.analytics?.todayAttendancePct || 0,
        alertsCount: s.analytics?.alertsCount || 0,
        todayCollection: s.analytics?.todayFeeCollection || 0,
        apiLatencyMs: s.analytics?.apiLatencyMs || 24,
        securityScore: s.analytics?.securityScore || 94,
        cpuUsage: s.analytics?.cpuUsagePct || 0.4,
        storageUsage: s.analytics?.storageUsedBytes || 0,
        storageLimit: s.limits?.storageLimit || 1073741824,
        apiRequestsToday: s.analytics?.apiRequestsToday || 0,
        subscriptionStatus
      };
    });

    return res.json({ success: true, count: data.length, total, data });
  } catch (error) {
    console.error('[getAllSchoolsEnhanced]', error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { getDashboard, getAllSchoolsEnhanced };
