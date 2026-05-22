const AuditLog = require('../models/AuditLog');
const LoginSession = require('../models/LoginSession');
const SecurityLog = require('../models/SecurityLog');
const User = require('../models/User');
const redis = require('../config/redis');

const HOUR_MS = 3600000;
const DAY_MS = 86400000;
const HISTORY_HOURS = 24;

function toHourBucket(date = new Date()) {
  const d = new Date(date);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}${String(d.getUTCHours()).padStart(2, '0')}`;
}

function dayBucket(date = new Date()) {
  const d = new Date(date);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}

function classifyEvent(type = '') {
  const t = String(type).toUpperCase();
  return {
    failedLogins: ['LOGIN_FAILED', 'INVALID_TOKEN'].includes(t) ? 1 : 0,
    firewallBlocks: ['IP_BLOCKED', 'RATE_LIMIT_EXCEEDED', 'INJECTION_DETECTED', 'IP_BLACKLISTED', 'BLOCKED'].includes(t) ? 1 : 0,
    apiAbuse: ['RATE_LIMIT_EXCEEDED', 'API_ABUSE', 'DDOS_TRAFFIC'].includes(t) ? 1 : 0,
    malwareAttempts: /MALWARE|INJECT|PROBE/.test(t) ? 1 : 0,
    geoAnomalies: t === 'GEO_ANOMALY' ? 1 : 0,
    liveIncidents: ['UNAUTHORIZED_ACCESS', 'BRUTE_FORCE_DETECTED', 'SECURITY_CRITICAL'].includes(t) ? 1 : 0,
    aiDetections: ['AI_DETECTION', 'BRUTE_FORCE_DETECTED', 'ANOMALY_DETECTED'].includes(t) ? 1 : 0,
    criticalEvents: ['UNAUTHORIZED_ACCESS', 'BRUTE_FORCE_DETECTED', 'SECURITY_CRITICAL'].includes(t) ? 1 : 0,
  };
}

async function recordSecurityEvent(eventType, payload = {}) {
  try {
    const now = new Date();
    const hourKey = `security:metrics:hour:${toHourBucket(now)}`;
    const dayKey = `security:metrics:ips:${dayBucket(now)}`;
    const counters = classifyEvent(eventType);
    const ipAddress = payload.ipAddress || payload.ip || payload.sourceIp || null;

    const pipe = redis.pipeline();
    Object.entries(counters).forEach(([field, value]) => {
      if (value > 0) pipe.hincrby(hourKey, field, value);
    });

    pipe.expire(hourKey, 48 * 3600);

    if (ipAddress) {
      pipe.sadd(dayKey, ipAddress);
      pipe.expire(dayKey, 48 * 3600);
    }

    pipe.lpush('security:events:recent', JSON.stringify({
      type: String(eventType || 'UNKNOWN').toUpperCase(),
      ipAddress,
      at: now.toISOString(),
      severity: String(payload.severity || '').toUpperCase() || 'MEDIUM',
    }));
    pipe.ltrim('security:events:recent', 0, 199);
    pipe.expire('security:events:recent', 48 * 3600);

    await pipe.exec();
    console.log(`[SECURITY_METRIC] Recorded ${String(eventType || 'UNKNOWN').toUpperCase()} event`);
    return true;
  } catch (_) {
    console.warn('[SECURITY_METRIC] Failed to record security event to Redis adapter');
    return false;
  }
}

async function readWindowCounters() {
  const now = Date.now();
  const buckets = [];
  for (let i = 0; i < HISTORY_HOURS; i += 1) {
    buckets.push(toHourBucket(new Date(now - i * HOUR_MS)));
  }

  const hashes = await Promise.all(
    buckets.map((b) => redis.hgetall(`security:metrics:hour:${b}`).catch(() => null))
  );

  const totals = {
    failedLogins: 0,
    firewallBlocks: 0,
    apiAbuse: 0,
    malwareAttempts: 0,
    geoAnomalies: 0,
    liveIncidents: 0,
    aiDetections: 0,
    criticalEvents: 0,
  };

  for (const h of hashes) {
    if (!h) continue;
    Object.keys(totals).forEach((k) => {
      totals[k] += Number(h[k] || 0);
    });
  }

  return totals;
}

async function countSuspiciousIps() {
  try {
    const today = dayBucket(new Date());
    const yesterday = dayBucket(new Date(Date.now() - DAY_MS));
    const [a, b] = await Promise.all([
      redis.smembers(`security:metrics:ips:${today}`).catch(() => []),
      redis.smembers(`security:metrics:ips:${yesterday}`).catch(() => []),
    ]);
    const merged = [...new Set([...(a || []), ...(b || [])])];
    return merged.filter((ip) => ip && !/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.)/.test(String(ip))).length;
  } catch (_) {
    return 0;
  }
}

async function buildFallbackMetrics() {
  const now = new Date();
  const dayAgo = new Date(now.getTime() - DAY_MS);
  const hourAgo = new Date(now.getTime() - HOUR_MS);

  const [
    failedLogins,
    activeSessions,
    firewallBlocks,
    criticalEvents,
    highRiskUsers,
    geoAnomalies,
    apiAbuse,
    malwareAttempts,
  ] = await Promise.all([
    AuditLog.countDocuments({ createdAt: { $gte: dayAgo }, action: { $in: ['LOGIN_FAILED', 'INVALID_TOKEN'] } }).catch(() => 0),
    LoginSession.countDocuments({ isActive: true }).catch(() => 0),
    AuditLog.countDocuments({ createdAt: { $gte: dayAgo }, action: { $in: ['IP_BLOCKED', 'RATE_LIMIT_EXCEEDED'] } }).catch(() => 0),
    AuditLog.countDocuments({ createdAt: { $gte: dayAgo }, severity: 'CRITICAL' }).catch(() => 0),
    User.countDocuments({ riskLevel: { $in: ['HIGH', 'CRITICAL'] } }).catch(() => 0),
    SecurityLog.countDocuments({ eventType: 'GEO_ANOMALY', createdAt: { $gte: dayAgo } }).catch(() => 0),
    AuditLog.countDocuments({ createdAt: { $gte: hourAgo }, action: 'RATE_LIMIT_EXCEEDED' }).catch(() => 0),
    AuditLog.countDocuments({ createdAt: { $gte: dayAgo }, action: { $regex: /MALWARE|INJECT|PROBE/i } }).catch(() => 0),
  ]);

  const suspiciousIps = await AuditLog.distinct('ipAddress', {
    createdAt: { $gte: dayAgo },
    action: { $in: ['LOGIN_FAILED', 'INVALID_TOKEN', 'UNAUTHORIZED_ACCESS'] }
  }).then((ips) => ips.filter((ip) => ip && !/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.)/.test(ip)).length).catch(() => 0);

  const securityScoreValue = Math.max(60, Math.min(100,
    100 - criticalEvents * 3 - Math.floor(failedLogins / 8) - highRiskUsers
  ));
  const riskScoreValue = Math.max(10, criticalEvents * 5 + Math.floor(failedLogins * 0.4));
  const threatLevel = criticalEvents > 5 ? 'CRITICAL' : criticalEvents > 2 ? 'HIGH' : failedLogins > 20 ? 'MEDIUM' : 'LOW';

  return {
    securityScore: `${securityScoreValue} / 100`,
    threatLevel,
    failedLogins,
    suspiciousIps,
    firewallBlocks,
    aiDetections: criticalEvents + Math.floor(failedLogins * 0.25),
    activeSessions,
    geoAnomalies,
    malwareAttempts,
    riskScore: `${riskScoreValue} / 100`,
    zeroTrustHealth: `${Math.min(99, 97 - criticalEvents)}%`,
    liveIncidents: criticalEvents,
    apiAbuse,
    highRiskUsers,
    generatedAt: now.toISOString(),
    source: 'mongodb_fallback',
  };
}

async function getLiveMetrics() {
  try {
    const cacheKey = 'security:metrics:live:v1';
    const cached = await redis.get(cacheKey).catch(() => null);
    if (cached) return JSON.parse(cached);

    const [windowTotals, suspiciousIps, activeSessions, highRiskUsers] = await Promise.all([
      readWindowCounters(),
      countSuspiciousIps(),
      LoginSession.countDocuments({ isActive: true }).catch(() => 0),
      User.countDocuments({ riskLevel: { $in: ['HIGH', 'CRITICAL'] } }).catch(() => 0),
    ]);

    const securityScoreValue = Math.max(60, Math.min(100,
      100 - windowTotals.criticalEvents * 3 - Math.floor(windowTotals.failedLogins / 8) - highRiskUsers
    ));
    const riskScoreValue = Math.max(10, windowTotals.criticalEvents * 5 + Math.floor(windowTotals.failedLogins * 0.4));
    const threatLevel = windowTotals.criticalEvents > 5
      ? 'CRITICAL'
      : windowTotals.criticalEvents > 2
        ? 'HIGH'
        : windowTotals.failedLogins > 20
          ? 'MEDIUM'
          : 'LOW';

    const data = {
      securityScore: `${securityScoreValue} / 100`,
      threatLevel,
      failedLogins: windowTotals.failedLogins,
      suspiciousIps,
      firewallBlocks: windowTotals.firewallBlocks,
      aiDetections: windowTotals.aiDetections,
      activeSessions,
      geoAnomalies: windowTotals.geoAnomalies,
      malwareAttempts: windowTotals.malwareAttempts,
      riskScore: `${riskScoreValue} / 100`,
      zeroTrustHealth: `${Math.min(99, 97 - windowTotals.criticalEvents)}%`,
      liveIncidents: windowTotals.liveIncidents,
      apiAbuse: windowTotals.apiAbuse,
      highRiskUsers,
      generatedAt: new Date().toISOString(),
      source: 'redis_live',
    };

    await redis.setex(cacheKey, 15, JSON.stringify(data)).catch(() => {});
    console.log('[REDIS_ANALYTICS] Live security metrics refreshed from Redis-backed counters');
    return data;
  } catch (_) {
    console.warn('[SECURITY_METRIC] Falling back to MongoDB metrics path');
    return buildFallbackMetrics();
  }
}

module.exports = {
  recordSecurityEvent,
  getLiveMetrics,
};
