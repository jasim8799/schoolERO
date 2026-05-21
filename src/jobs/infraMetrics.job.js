const os = require('os');
const mongoose = require('mongoose');
const InfrastructureMetric = require('../models/InfrastructureMetric');
const School = require('../models/School');
const LoginSession = require('../models/LoginSession');
const redis = require('../config/redis');

async function collectInfraMetrics() {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const cpuLoad = os.loadavg()[0];

  const dbStart = Date.now();
  const dbStats = await mongoose.connection.db.stats();
  const dbLatencyMs = Date.now() - dbStart;

  const [activeSchools, onlineUsers] = await Promise.all([
    School.countDocuments({ isDeleted: false, status: 'active' }),
    LoginSession.countDocuments({
      isActive: true,
      lastActiveAt: { $gte: new Date(Date.now() - 30 * 60000) }
    })
  ]);

  const requestsPerMin = parseInt((await redis.get('stats:requestsLastMin')) || '0', 10);
  const avgLatency = parseInt((await redis.get('stats:avgLatency')) || '24', 10);
  const errorRate = parseFloat((await redis.get('stats:errorRate')) || '0');

  await InfrastructureMetric.create({
    timestamp: new Date(),
    cpuUsagePct: Math.round(cpuLoad * 10),
    ramUsagePct: Math.round(((totalMem - freeMem) / totalMem) * 100),
    dbConnectionsActive: mongoose.connection?.client?.topology?.s?.servers?.size || 0,
    dbLatencyMs,
    apiLatencyMs: avgLatency,
    requestsPerMin,
    errorRate,
    activeSchools,
    onlineUsers,
    queueJobsPending: 0,
    cacheHitRate: 0,
    storageUsedGB: Math.round((dbStats.dataSize || 0) / 1073741824),
    backupStatus: (await redis.get('backup:lastStatus')) || 'PENDING'
  });
}

module.exports = { collectInfraMetrics };
