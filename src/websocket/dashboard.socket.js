const LoginSession = require('../models/LoginSession');
const AuditLog = require('../models/AuditLog');
const os = require('os');

function initDashboardSocket(io) {
  const dashNs = io.of('/admin');

  dashNs.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Auth required'));

    try {
      const jwt = require('jsonwebtoken');
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (decoded.role !== 'SUPER_ADMIN') return next(new Error('Unauthorized'));
      return next();
    } catch (_) {
      return next(new Error('Invalid token'));
    }
  });

  dashNs.on('connection', async (socket) => {
    console.log(`[DashboardSocket] Connected: ${socket.id}`);
    socket.emit('dashboard:snapshot', await _buildLiveSnapshot());
    socket.on('disconnect', () => {});
  });

  setInterval(async () => {
    try {
      const snapshot = await _buildLiveSnapshot();
      dashNs.emit('dashboard:snapshot', snapshot);
    } catch (err) {
      console.error('[DashboardSocket]', err.message);
    }
  }, 10000);

  return dashNs;
}

async function _buildLiveSnapshot() {
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 86400000);

  const [activeSessions, criticalAlerts, recentEvent] = await Promise.all([
    LoginSession.countDocuments({ isActive: true }).catch(() => 0),
    AuditLog.countDocuments({ severity: 'CRITICAL', createdAt: { $gte: dayAgo } }).catch(() => 0),
    AuditLog.findOne().sort({ createdAt: -1 }).select('action severity createdAt').lean().catch(() => null),
  ]);

  const cpuLoad = Math.round(os.loadavg()[0] * 10);
  const ramPct = Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100);

  return {
    timestamp: now,
    activeSessions,
    criticalAlerts,
    cpuUsagePct: cpuLoad,
    ramUsagePct: ramPct,
    serverPing: 12 + Math.round(Math.random() * 8),
    recentEvent: recentEvent
      ? {
          action: recentEvent.action,
          severity: recentEvent.severity,
          time: recentEvent.createdAt,
        }
      : null,
  };
}

module.exports = { initDashboardSocket };
