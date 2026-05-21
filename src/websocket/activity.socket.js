const AuditLog     = require('../models/AuditLog');
const LoginSession = require('../models/LoginSession');
const FirewallEvent = require('../models/FirewallEvent');

/**
 * Initialize the /activity Socket.IO namespace.
 * Requires SUPER_ADMIN JWT in socket handshake auth.
 * Broadcasts a live snapshot every 8 seconds to all connected SOC clients.
 */
function initActivitySocket(io) {
  const activityNs = io.of('/activity');

  // ── JWT auth guard ──────────────────────────────────────────────────────
  activityNs.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Auth required'));
    try {
      const jwt     = require('jsonwebtoken');
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (decoded.role !== 'SUPER_ADMIN') return next(new Error('Unauthorized'));
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  // ── Connection handler ──────────────────────────────────────────────────
  activityNs.on('connection', async (socket) => {
    console.log(`[ActivitySocket] Connected: ${socket.id}`);
    try {
      socket.emit('activity:snapshot', await _buildLiveSnapshot());
    } catch (err) {
      console.error('[ActivitySocket] Snapshot error:', err.message);
    }
    socket.on('disconnect', () => console.log(`[ActivitySocket] Disconnected: ${socket.id}`));
  });

  // ── Live broadcast every 8 seconds ──────────────────────────────────────
  setInterval(async () => {
    try {
      const snapshot = await _buildLiveSnapshot();
      activityNs.emit('activity:snapshot', snapshot);
    } catch (err) {
      console.error('[ActivitySocket] Broadcast error:', err.message);
    }
  }, 8000);

  // ── Global broadcast helpers (called by other modules) ──────────────────
  global.broadcastSecurityEvent  = (event) => activityNs.emit('security:event', event);
  global.broadcastFirewallEvent  = (event) => activityNs.emit('firewall:event', event);
  global.broadcastActivityAlert  = (alert) => activityNs.emit('activity:alert', alert);

  /**
   * Stream a critical audit log entry live to connected SOC dashboards.
   * Called by utils/auditLog.js after persisting a log.
   */
  global.streamAuditEvent = (log) => {
    if (!log) return;
    const action     = (log.action || '').toUpperCase();
    const isCritical = /CRITICAL|BREACH|FAILED|BLOCK/.test(action);
    if (isCritical) {
      activityNs.emit('activity:live', {
        event:     log.description || log.action?.replace(/_/g, ' '),
        severity:  /CRITICAL|BREACH/.test(action) ? 'CRITICAL' : 'ERROR',
        source:    'Audit Engine',
        ipAddress: log.ipAddress || '10.0.0.1',
        timestamp: new Date(),
      });
    }
  };

  return activityNs;
}

async function _buildLiveSnapshot() {
  const dayAgo  = new Date(Date.now() - 86400000);
  const hourAgo = new Date(Date.now() - 3600000);

  const [recentLogs, activeSessions, firewallBlocked, criticals] = await Promise.all([
    AuditLog.find({ createdAt: { $gte: hourAgo } }).sort({ createdAt: -1 }).limit(5).lean(),
    LoginSession.countDocuments({ isActive: true }),
    FirewallEvent.countDocuments({ action: 'BLOCKED', createdAt: { $gte: dayAgo } }),
    AuditLog.countDocuments({ action: { $regex: /CRITICAL|BREACH/i }, createdAt: { $gte: dayAgo } }),
  ]);

  return {
    timestamp:      new Date(),
    activeSessions,
    firewallBlocked,
    criticalAlerts: criticals,
    recentEvents:   recentLogs.map((log) => ({
      event:    log.description || log.action?.replace(/_/g, ' '),
      severity: /FAILED|INVALID|BLOCK/i.test(log.action || '') ? 'ERROR' : 'INFO',
      time:     log.createdAt,
    })),
  };
}

module.exports = { initActivitySocket };
