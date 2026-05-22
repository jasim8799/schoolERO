const cron = require('node-cron');
const redis = require('../config/redis');
const { getLiveMetrics } = require('../services/security.metrics');
const { broadcastSecurityMetrics } = require('../socket/security.socket');

async function runSecurityMetricsRefresh() {
  const metrics = await getLiveMetrics();
  await redis.setex('security:metrics:snapshot:latest', 300, JSON.stringify(metrics)).catch(() => {});
  broadcastSecurityMetrics(metrics);
  return metrics;
}

function registerSecurityMetricsCronJobs() {
  // Near-real-time dashboard refresh cadence for SOC clients.
  cron.schedule('* * * * *', async () => {
    await runSecurityMetricsRefresh().catch((err) => {
      console.error('[SecurityMetricsCron] refresh error:', err.message);
    });
  });

  // Snapshot persistence (hourly) for quick trend reconstruction.
  cron.schedule('0 * * * *', async () => {
    try {
      const metrics = await getLiveMetrics();
      const hour = new Date().toISOString().slice(0, 13);
      await redis.hset(`security:metrics:snapshots:${hour.slice(0, 10)}`, hour, JSON.stringify(metrics)).catch(() => {});
      await redis.expire(`security:metrics:snapshots:${hour.slice(0, 10)}`, 7 * 86400).catch(() => {});
    } catch (err) {
      console.error('[SecurityMetricsCron] snapshot error:', err.message);
    }
  });

  setTimeout(() => {
    runSecurityMetricsRefresh().catch(() => {});
  }, 4000);

  console.log('[Cron] Security metrics cron jobs registered');
}

module.exports = {
  registerSecurityMetricsCronJobs,
  runSecurityMetricsRefresh,
};
