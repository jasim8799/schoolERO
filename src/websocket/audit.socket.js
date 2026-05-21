const AuditLog = require('../models/AuditLog');
const { getInfrastructureMetrics } = require('../services/infrastructure.service');

function initAuditSocket(io) {
  const auditNs = io.of('/audit');

  auditNs.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Auth required'));
    try {
      const jwt = require('jsonwebtoken');
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (decoded.role !== 'SUPER_ADMIN') return next(new Error('Unauthorized'));
      next();
    } catch (_) {
      next(new Error('Invalid token'));
    }
  });

  auditNs.on('connection', async (socket) => {
    console.log(`[AuditSocket] Connected: ${socket.id}`);
    try {
      const recentLogs = await AuditLog.find().sort({ createdAt: -1 }).limit(5).lean();
      socket.emit('audit:snapshot', { logs: recentLogs, timestamp: new Date() });
    } catch (err) {
      console.error('[AuditSocket] Snapshot error:', err.message);
    }
    socket.on('disconnect', () => console.log(`[AuditSocket] Disconnected: ${socket.id}`));
  });

  setInterval(async () => {
    try {
      const infra = await getInfrastructureMetrics();
      auditNs.emit('audit:infra', infra);
    } catch (err) {
      console.error('[AuditSocket] Infra error:', err.message);
    }
  }, 30000);

  global.streamAuditLog = (log) => {
    if (!log) return;
    const sev = log.severity || 'INFO';
    auditNs.emit('audit:new', { log, severity: sev, timestamp: new Date() });
    if (sev === 'CRITICAL' || sev === 'ERROR') {
      auditNs.emit('audit:critical', { log, timestamp: new Date() });
    }
  };

  return auditNs;
}

module.exports = { initAuditSocket };
