const jwt = require('jsonwebtoken');
const os = require('os');
const School = require('../models/School');
const SecurityLog = require('../models/SecurityLog');
const AuditLog = require('../models/AuditLog');
const { config } = require('../config/env');

function initDashboardSocket(io) {
  const adminNs = io.of('/admin');

  adminNs.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Authentication required'));

    try {
      const decoded = jwt.verify(token, config.jwt.secret);
      if (decoded.role !== 'SUPER_ADMIN') return next(new Error('Super Admin only'));
      socket.userId = decoded.userId || decoded.id;
      return next();
    } catch (_error) {
      return next(new Error('Invalid token'));
    }
  });

  adminNs.on('connection', async (socket) => {
    socket.emit('dashboard:snapshot', await buildLiveSnapshot());

    socket.on('subscribe:school', (schoolId) => {
      socket.join(`school:${schoolId}`);
    });
  });

  setInterval(async () => {
    try {
      const snapshot = await buildLiveSnapshot();
      adminNs.emit('dashboard:snapshot', snapshot);
    } catch (error) {
      console.error('[dashboard.socket] snapshot error', error.message);
    }
  }, 10000);

  global.broadcastSecurityAlert = (alert) => {
    adminNs.emit('security:alert', alert);
  };

  return adminNs;
}

async function buildLiveSnapshot() {
  const [schoolAgg] = await School.aggregate([
    { $match: { isDeleted: false } },
    {
      $group: {
        _id: null,
        totalOnlineUsers: { $sum: '$analytics.onlineUsers' },
        totalFeeToday: { $sum: '$analytics.todayFeeCollection' },
        totalAlerts: { $sum: '$analytics.alertsCount' },
        avgHealthScore: { $avg: '$healthScore' }
      }
    }
  ]);

  const [recentSecurityEvents, recentAuditLogs, latestAlerts] = await Promise.all([
    SecurityLog.find({ severity: { $in: ['WARNING', 'CRITICAL'] } })
      .sort({ createdAt: -1 })
      .limit(5)
      .lean(),
    AuditLog.find()
      .sort({ createdAt: -1 })
      .limit(10)
      .populate('userId', 'name role')
      .lean(),
    School.find({ 'analytics.alertsCount': { $gt: 0 } })
      .select('name code analytics.alertsCount')
      .limit(5)
      .lean()
  ]);

  const totalMem = os.totalmem();
  const freeMem = os.freemem();

  return {
    timestamp: new Date(),
    live: {
      onlineUsers: schoolAgg?.totalOnlineUsers || 0,
      feeToday: schoolAgg?.totalFeeToday || 0,
      pendingAlerts: schoolAgg?.totalAlerts || 0,
      avgHealthScore: Math.round(schoolAgg?.avgHealthScore || 90),
      cpuPct: Math.round(os.loadavg()[0] * 10),
      ramPct: Math.round(((totalMem - freeMem) / totalMem) * 100)
    },
    recentSecurityEvents: recentSecurityEvents.map((event) => ({
      type: event.eventType,
      severity: event.severity,
      ip: event.ipAddress,
      time: event.createdAt
    })),
    recentActivity: recentAuditLogs.map((log) => ({
      action: log.action,
      user: log.userId?.name || 'System',
      role: log.userId?.role,
      time: log.createdAt,
      description: log.description
    })),
    schoolAlerts: latestAlerts
  };
}

module.exports = { initDashboardSocket };
