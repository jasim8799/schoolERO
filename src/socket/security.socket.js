const { getLiveMetrics } = require('../services/security.metrics');

function initSecuritySocket(io) {
  const nsp = io.of('/security');

  nsp.on('connection', async (socket) => {
    socket.on('security:subscribe', () => {
      socket.join('security:global');
    });

    try {
      const metrics = await getLiveMetrics();
      socket.emit('security:metrics', metrics);
    } catch (_) {}
  });

  return nsp;
}

function broadcastSecurityMetrics(metrics) {
  if (!global.io) return;
  global.io.of('/security').to('security:global').emit('security:metrics', metrics);
  global.io.emit('security:metrics_update', { metrics, threatLevel: metrics?.threatLevel || 'LOW' });
}

module.exports = {
  initSecuritySocket,
  broadcastSecurityMetrics,
};
