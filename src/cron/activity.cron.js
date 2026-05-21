const cron    = require('node-cron');
const redis   = require('../config/redis');
const os      = require('os');

/**
 * Collect OS + DB metrics and persist to InfrastructureMetric.
 */
async function collectInfraMetrics() {
  const InfrastructureMetric = require('../models/InfrastructureMetric');
  const mongoose             = require('mongoose');

  const cpuLoad  = os.loadavg()[0];
  const totalMem = os.totalmem();
  const freeMem  = os.freemem();
  const dbStart  = Date.now();

  await mongoose.connection.db.admin().ping().catch(() => {});

  await InfrastructureMetric.create({
    cpuUsagePct: Math.round(cpuLoad * 10),
    ramUsagePct: Math.round(((totalMem - freeMem) / totalMem) * 100),
    dbLatencyMs: Date.now() - dbStart,
    backupStatus: await redis.get('backup:lastStatus').catch(() => 'PENDING'),
  }).catch(() => {});
}

/**
 * Invalidate all activity feed cache keys so the next request
 * gets fresh data from MongoDB.
 */
async function invalidateActivityCaches() {
  const keys = await redis.keys('activity:feed:*').catch(() => []);
  if (keys.length > 0) await redis.del(...keys).catch(() => {});
}

/**
 * Register all SIEM-related cron jobs.
 * Call once at application startup (after io is ready).
 */
function registerActivityCronJobs() {
  // Every 5 minutes: collect infrastructure metrics
  cron.schedule('*/5 * * * *', async () => {
    await collectInfraMetrics().catch(console.error);
  });

  // Every 15 minutes: refresh activity caches
  cron.schedule('*/15 * * * *', async () => {
    await invalidateActivityCaches().catch(console.error);
  });

  // Hourly: push diagnostics snapshot to all SOC clients
  cron.schedule('0 * * * *', async () => {
    try {
      const { runDiagnostics } = require('../diagnostics/infrastructure.diagnostics');
      const diag = await runDiagnostics();
      global.io?.of('/activity').emit('diagnostics:update', diag);
    } catch (err) {
      console.error('[CRON] Diagnostics broadcast failed:', err.message);
    }
  });

  // Daily 3 AM: log active Redis IP blocks (TTL handles expiry automatically)
  cron.schedule('0 3 * * *', async () => {
    try {
      const blockedKeys = await redis.keys('blocked:ip:*').catch(() => []);
      console.log(`[CRON] Activity cleanup: ${blockedKeys.length} IP blocks still active`);
    } catch (err) {
      console.error('[CRON] Daily cleanup error:', err.message);
    }
  });

  console.log('[Cron] Activity/SIEM cron jobs registered');
}

module.exports = { registerActivityCronJobs };
