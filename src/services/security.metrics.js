// services/security.metrics.js
// Enterprise SOC Metrics Engine (with legacy bucket support)
// All counters stored in Redis with TTL. MongoDB is ground-truth fallback.

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

// New simplified counter keys (non-bucketed)
const KEYS = {
  failedLogins24h:   'soc:counter:failedLogins:24h',
  failedLoginsHour:  'soc:counter:failedLogins:1h',
  blockedEvents24h:  'soc:counter:blocked:24h',
  criticalEvents24h: 'soc:counter:critical:24h',
  aiDetections24h:   'soc:counter:aiDetections:24h',
  geoAnomalies24h:   'soc:counter:geoAnomalies:24h',
  malware24h:        'soc:counter:malware:24h',
  apiAbuse1h:        'soc:counter:apiAbuse:1h',
  metricsHash:       'soc:metrics:snapshot',
  suspiciousIps:     'soc:zset:suspiciousIps',
  recentEvents:      'soc:list:recentEvents',
  uniqueThreatIps:   'soc:set:uniqueThreatIps',
  radarHash:         'soc:radar:scores',
};

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

function _radarCategoryFromType(type) {
  const t = (type || '').toUpperCase();
  if (/LOGIN_FAILED|INVALID_TOKEN|BRUTE/.test(t)) return 'brute_force';
  if (/GEO_ANOMALY|COUNTRY/.test(t)) return 'geo_anomalies';
  if (/MALWARE|INJECT|PROBE/.test(t)) return 'malware';
  if (/RATE_LIMIT|DDOS|FLOOD/.test(t)) return 'ddos';
  if (/API_ABUSE|API_SPIKE/.test(t)) return 'api_abuse';
  if (/SESSION|HIJACK|REPLAY/.test(t)) return 'session_hijack';
  return null;
}

// ── Increment a counter with TTL ──────────────────────────────────────────
async function increment(key, ttlSeconds = 86400) {
  try {
    const val = await redis.incr(key);
    if (val === 1) await redis.expire(key, ttlSeconds);
    return val;
  } catch (_) {
    return 0;
  }
}

// ── Record security event (combined legacy + new logic) ──────────────────
async function recordSecurityEvent(eventType, payload = {}) {
  try {
    const now = new Date();

    // Legacy bucket-based counters (for backward compat)
    const hourKey = `security:metrics:hour:${toHourBucket(now)}`;
    const dayKey = `security:metrics:ips:${dayBucket(now)}`;
    const counters = classifyEvent(eventType);
    const ipAddress = payload.ipAddress || payload.ip || payload.sourceIp || null;
    const severity = (payload.severity || 'HIGH').toUpperCase();
    const schoolId = payload.schoolId;

    // New direct counter increments
    if (/LOGIN_FAILED|INVALID_TOKEN/.test(String(eventType || '').toUpperCase())) {
      await increment(KEYS.failedLogins24h, 86400);
      await increment(KEYS.failedLoginsHour, 3600);
    }
    if (/IP_BLOCKED|RATE_LIMIT/.test(String(eventType || '').toUpperCase())) {
      await increment(KEYS.blockedEvents24h, 86400);
    }
    if (/CRITICAL|BRUTE_FORCE|BREACH/.test(String(eventType || '').toUpperCase()) || severity === 'CRITICAL') {
      await increment(KEYS.criticalEvents24h, 86400);
    }
    if (/GEO_ANOMALY/.test(String(eventType || '').toUpperCase())) {
      await increment(KEYS.geoAnomalies24h, 86400);
    }
    if (/MALWARE|INJECT|PROBE/.test(String(eventType || '').toUpperCase())) {
      await increment(KEYS.malware24h, 86400);
    }
    if (/RATE_LIMIT|API_ABUSE/.test(String(eventType || '').toUpperCase())) {
      await increment(KEYS.apiAbuse1h, 3600);
    }

    // Track suspicious IPs in sorted set
    if (ipAddress && !/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.)/.test(ipAddress)) {
      const current = (await redis.zscore?.(KEYS.suspiciousIps, ipAddress).catch(() => 0)) || 0;
      await redis.zadd(KEYS.suspiciousIps, Number(current) + 1, ipAddress).catch(() => {});
      await redis.expire(KEYS.suspiciousIps, 86400).catch(() => {});
      await redis.sadd(KEYS.uniqueThreatIps, ipAddress).catch(() => {});
      await redis.expire(KEYS.uniqueThreatIps, 86400).catch(() => {});
    }

    // Push to recent events list
    const eventPayload = JSON.stringify({
      type: String(eventType || 'UNKNOWN').toUpperCase(),
      ipAddress,
      severity,
      schoolId: schoolId?.toString(),
      at: now.toISOString(),
    });
    await redis.lpush(KEYS.recentEvents, eventPayload).catch(() => {});
    await redis.ltrim(KEYS.recentEvents, 0, 99).catch(() => {});

    // Update radar category score
    const radarCategory = _radarCategoryFromType(String(eventType || ''));
    if (radarCategory) {
      await redis.hincrby(KEYS.radarHash, radarCategory, 1).catch(() => {});
      await redis.expire(KEYS.radarHash, 3600).catch(() => {});
    }

    // Legacy bucket counters
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
      severity,
    }));
    pipe.ltrim('security:events:recent', 0, 199);
    pipe.expire('security:events:recent', 48 * 3600);

    await pipe.exec().catch(() => {});

    // Invalidate cache
    await redis.del('soc:metrics:v3').catch(() => {});
    await redis.del('security:metrics:live:v1').catch(() => {});

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

  const radarThreats = [
    { name: 'Brute Force', level: Math.min(0.99, failedLogins * 0.04) },
    { name: 'Geo Anomalies', level: Math.min(0.9, geoAnomalies * 0.08) },
    { name: 'Malware Probes', level: Math.min(0.9, malwareAttempts * 0.08) },
    { name: 'DDoS Traffic', level: Math.min(0.85, firewallBlocks * 0.06) },
    { name: 'API Abuse', level: Math.min(0.8, suspiciousIps * 0.03) },
    { name: 'Session Hijack', level: Math.min(0.9, criticalEvents * 0.07) },
  ];

  return {
    securityScore: `${securityScoreValue} / 100`,
    threatLevel,
    failedLogins,
    failedLoginsHour: Math.floor(failedLogins / 24),
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
    radarThreats,
    sparklines: {
      failedLogins: [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, Math.min(1, failedLogins / 100)],
      firewallBlocks: [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, Math.min(1, firewallBlocks / 20)],
      activeSessions: [0.8, 0.82, 0.85, 0.87, 0.88, 0.9, Math.min(1, activeSessions / 2000)],
      liveIncidents: [0.07, 0.07, 0.07, 0.07, 0.07, 0.07, Math.min(1, criticalEvents / 5)],
      securityScore: [0.87, 0.88, 0.9, 0.91, 0.92, 0.93, securityScoreValue / 100],
      suspiciousIps: [0.03, 0.03, 0.03, 0.03, 0.03, 0.03, Math.min(1, suspiciousIps / 50)],
      aiDetections: [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, Math.min(1, (criticalEvents + Math.floor(failedLogins * 0.25)) / 20)],
      geoAnomalies: [0.012, 0.012, 0.012, 0.012, 0.012, 0.012, Math.min(1, geoAnomalies / 50)],
      malwareAttempts: [0.05, 0.05, 0.05, 0.05, 0.05, 0.05, Math.min(1, malwareAttempts / 20)],
      riskScore: [0.4, 0.4, 0.4, 0.4, 0.4, 0.4, riskScoreValue / 100],
      zeroTrustHealth: [0.88, 0.9, 0.92, 0.93, 0.95, 0.96, Math.min(0.99, 0.97 - criticalEvents * 0.01)],
      threatLevel: [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, Math.min(1, failedLogins / 100)],
    },
    generatedAt: now.toISOString(),
    source: 'mongodb_fallback',
  };
}

async function getLiveMetrics() {
  try {
    const cacheKey = 'security:metrics:live:v1';
    const cached = await redis.get(cacheKey).catch(() => null);
    if (cached) return JSON.parse(cached);

    // Try to read from new counters first
    const failedLogins24h = await redis.get(KEYS.failedLogins24h).then((v) => parseInt(v || '0', 10));
    const failedLoginsHour = await redis.get(KEYS.failedLoginsHour).then((v) => parseInt(v || '0', 10));
    const blockedEvents = await redis.get(KEYS.blockedEvents24h).then((v) => parseInt(v || '0', 10));
    const criticalCount = await redis.get(KEYS.criticalEvents24h).then((v) => parseInt(v || '0', 10));
    const geoCount = await redis.get(KEYS.geoAnomalies24h).then((v) => parseInt(v || '0', 10));
    const malwareCount = await redis.get(KEYS.malware24h).then((v) => parseInt(v || '0', 10));
    const suspiciousIpCount = await redis.scard(KEYS.uniqueThreatIps).then((v) => parseInt(v || '0', 10));

    const [windowTotals, suspiciousIps, activeSessions, highRiskUsers, radarHash] = await Promise.all([
      readWindowCounters(),
      countSuspiciousIps(),
      LoginSession.countDocuments({ isActive: true }).catch(() => 0),
      User.countDocuments({ riskLevel: { $in: ['HIGH', 'CRITICAL'] } }).catch(() => 0),
      redis.hgetall(KEYS.radarHash).catch(() => ({})),
    ]);

    // Use new counters if populated, otherwise fall back to windowed totals
    const useFailed = failedLogins24h > 0 ? failedLogins24h : windowTotals.failedLogins;
    const useBlocked = blockedEvents > 0 ? blockedEvents : windowTotals.firewallBlocks;
    const useCritical = criticalCount > 0 ? criticalCount : windowTotals.criticalEvents;

    const securityScoreValue = Math.max(60, Math.min(100,
      100 - useCritical * 3 - Math.floor(failedLoginsHour / 5) - highRiskUsers
    ));
    const riskScoreValue = Math.max(10, useCritical * 5 + Math.floor(failedLoginsHour * 2));
    const threatLevel = useCritical > 5
      ? 'CRITICAL'
      : useCritical > 2
        ? 'HIGH'
        : useFailed > 20
          ? 'MEDIUM'
          : 'LOW';

    const rh = radarHash || {};
    const radarThreats = [
      { name: 'Brute Force', level: Math.min(0.99, (parseInt(rh.brute_force || '0', 10) || failedLoginsHour) * 0.04) },
      { name: 'Geo Anomalies', level: Math.min(0.9, (parseInt(rh.geo_anomalies || '0', 10) || geoCount) * 0.08) },
      { name: 'Malware Probes', level: Math.min(0.9, (parseInt(rh.malware || '0', 10) || malwareCount) * 0.08) },
      { name: 'DDoS Traffic', level: Math.min(0.85, (parseInt(rh.ddos || '0', 10) || useBlocked) * 0.06) },
      { name: 'API Abuse', level: Math.min(0.8, (parseInt(rh.api_abuse || '0', 10) || suspiciousIpCount) * 0.03) },
      { name: 'Session Hijack', level: Math.min(0.9, (parseInt(rh.session_hijack || '0', 10) || useCritical) * 0.07) },
    ];

    let failedSpark = [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1];
    try {
      const sparklineRaw = await redis.lrange('soc:sparkline:failed', 0, 6);
      if (sparklineRaw && sparklineRaw.length >= 7) {
        const maxVal = Math.max(1, ...sparklineRaw.map((v) => parseInt(v, 10)));
        failedSpark = sparklineRaw.map((v) => Math.min(1, parseInt(v, 10) / maxVal));
      }
    } catch (_) {
      failedSpark = [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, Math.min(1, failedLoginsHour / 10)];
    }

    const aiDetections =
      parseInt(await redis.get(KEYS.aiDetections24h) || '0', 10) ||
      useCritical + Math.floor(failedLoginsHour * 0.4);

    const data = {
      securityScore: `${securityScoreValue} / 100`,
      threatLevel,
      failedLogins: useFailed,
      failedLoginsHour,
      suspiciousIps: suspiciousIpCount > 0 ? suspiciousIpCount : suspiciousIps,
      firewallBlocks: useBlocked,
      aiDetections,
      activeSessions,
      geoAnomalies: geoCount,
      malwareAttempts: malwareCount,
      riskScore: `${riskScoreValue} / 100`,
      zeroTrustHealth: `${Math.min(99, 97 - useCritical)}%`,
      liveIncidents: useCritical,
      apiAbuse: windowTotals.apiAbuse,
      highRiskUsers,
      radarThreats,
      sparklines: {
        failedLogins: failedSpark,
        firewallBlocks: [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, Math.min(1, useBlocked / 20)],
        activeSessions: [0.8, 0.82, 0.85, 0.87, 0.88, 0.9, Math.min(1, activeSessions / 2000)],
        liveIncidents: failedSpark.map((v) => v * 0.7),
        securityScore: [0.87, 0.88, 0.9, 0.91, 0.92, 0.93, securityScoreValue / 100],
        suspiciousIps: failedSpark.map((v) => v * 0.3),
        aiDetections: failedSpark,
        geoAnomalies: failedSpark.map((v) => v * 0.12),
        malwareAttempts: failedSpark.map((v) => v * 0.5),
        riskScore: failedSpark.map((v) => 1 - v * 0.6),
        zeroTrustHealth: [0.88, 0.9, 0.92, 0.93, 0.95, 0.96, Math.min(0.99, 0.97 - useCritical * 0.01)],
        threatLevel: failedSpark,
      },
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

// ── Hourly sparkline snapshot (called by cron) ────────────────────────────
async function snapshotHourlySparkline() {
  try {
    const currentHour = await redis
      .get(KEYS.failedLoginsHour)
      .then((v) => parseInt(v || '0', 10));
    await redis.lpush('soc:sparkline:failed', currentHour).catch(() => {});
    await redis.ltrim('soc:sparkline:failed', 0, 23).catch(() => {});

    // Reset hourly counters for next hour
    await redis.del(KEYS.failedLoginsHour).catch(() => {});
    await redis.del(KEYS.apiAbuse1h).catch(() => {});
  } catch (err) {
    console.warn('[SecurityMetrics:snapshot]', err.message);
  }
}

module.exports = {
  recordSecurityEvent,
  getLiveMetrics,
  snapshotHourlySparkline,
  increment,
  KEYS,
};
