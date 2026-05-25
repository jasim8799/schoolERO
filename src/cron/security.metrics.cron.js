const cron = require('node-cron');
const redis = require('../config/redis');
const { getLiveMetrics, dailyCounterReset, snapshotHourlySparkline } = require('../services/security.metrics');
const { seedRedisFromMongo } = require('../services/securityAnalytics.service');
const { broadcastSecurityMetrics } = require('../socket/security.socket');

async function runSecurityMetricsRefresh() {
  const metrics = await getLiveMetrics();
  await redis.setex('security:metrics:snapshot:latest', 300, JSON.stringify(metrics)).catch(() => {});
  broadcastSecurityMetrics(metrics);
  return metrics;
}

function registerSecurityMetricsCronJobs() {
  // ── Every 5 minutes: Invalidate metrics cache (force refresh) ────────────
  cron.schedule('*/5 * * * *', async () => {
    try {
      await redis.del('soc:cache:metrics:v4').catch(() => {});
      console.log('[SecurityMetricsCron] Metrics cache invalidated');
    } catch (err) {
      console.error('[SecurityMetricsCron:cache] error:', err.message);
    }
  });

  // ── Every hour at :00 — Snapshot hourly telemetry to sparkline ──────────
  cron.schedule('0 * * * *', async () => {
    try {
      await snapshotHourlySparkline();
      console.log('[SecurityMetricsCron:hourly] Sparkline snapshot recorded');
    } catch (err) {
      console.error('[SecurityMetricsCron:hourly] error:', err.message);
    }
  });

  // ── Every day at midnight UTC — Reset Redis 24h counters ───────────────
  cron.schedule('0 0 * * *', async () => {
    try {
      await dailyCounterReset();
      console.log('[SecurityMetricsCron:daily] Daily Redis counters reset, MongoDB preserved');
    } catch (err) {
      console.error('[SecurityMetricsCron:daily] error:', err.message);
    }
  });

  // ── Startup: Cold-start seed Redis from MongoDB after 10s delay ────────
  // This recovers counters after dyno restart when Redis is empty
  setTimeout(async () => {
    try {
      await seedRedisFromMongo(redis);
      console.log('[SecurityMetricsCron:startup] Cold-start: seeded Redis from MongoDB');
    } catch (err) {
      console.error('[SecurityMetricsCron:startup] error:', err.message);
    }
  }, 10000);

  console.log('[Cron] Security metrics cron jobs registered (5min cache, hourly snapshot, daily reset, startup seed)');
}

module.exports = {
  registerSecurityMetricsCronJobs,
  runSecurityMetricsRefresh,
};
