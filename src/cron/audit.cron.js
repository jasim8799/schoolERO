const cron = require('node-cron');
const AuditLog = require('../models/AuditLog');
const redis = require('../config/redis');

async function runThreatRecalculation() {
  const dayAgo = new Date(Date.now() - 86400000);
  const [criticals, errors] = await Promise.all([
    AuditLog.countDocuments({ severity: 'CRITICAL', createdAt: { $gte: dayAgo } }),
    AuditLog.countDocuments({ severity: 'ERROR', createdAt: { $gte: dayAgo } }),
  ]);

  const threatScore = Math.min(0.95, criticals * 0.06 + errors * 0.02);
  await redis.setex('threat:platform:score', 3600, threatScore.toString()).catch(() => {});
  console.log(`[AuditCron] Platform threat score: ${threatScore}`);
}

async function invalidateAuditCaches() {
  const keys = await redis.keys('audit:feed:*').catch(() => []);
  if (keys.length > 0) await redis.del(...keys).catch(() => {});
}

function registerAuditCronJobs() {
  cron.schedule('*/30 * * * *', async () => {
    await runThreatRecalculation().catch(console.error);
    await invalidateAuditCaches().catch(console.error);
  });

  cron.schedule('0 * * * *', async () => {
    const { getInfrastructureMetrics } = require('../services/infrastructure.service');
    const infra = await getInfrastructureMetrics().catch(() => ({}));
    global.io?.of('/audit').emit('audit:infra', infra);
    console.log('[AuditCron] Infra metrics broadcast');
  });

  console.log('[Cron] Audit cron jobs registered');
}

module.exports = { registerAuditCronJobs };
