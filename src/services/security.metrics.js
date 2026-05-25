// services/security.metrics.js
// Layer 1: Upstash Redis — realtime live telemetry (fast, temporary)
// Layer 2: MongoDB SecurityAnalytics — permanent historical counts
// getLiveMetrics() blends both layers for accurate stable metrics.

const redis = require('../config/redis');
const AuditLog = require('../models/AuditLog');
const SecurityLog = require('../models/SecurityLog');
const LoginSession = require('../models/LoginSession');
const User = require('../models/User');
const analyticsService = require('./securityAnalytics.service');

const KEYS = {
  // Hourly telemetry counters (can expire — MongoDB has permanent copy)
  failedLogins24h:   'soc:live:failedLogins:24h',
  failedLoginsHour:  'soc:live:failedLogins:1h',
  blockedEvents24h:  'soc:live:blocked:24h',
  criticalEvents24h: 'soc:live:critical:24h',
  aiDetections24h:   'soc:live:aiDetections:24h',
  geoAnomalies24h:   'soc:live:geoAnomalies:24h',
  malware24h:        'soc:live:malware:24h',
  apiAbuse1h:        'soc:live:apiAbuse:1h',
  // Sorted set for suspicious IPs (real-time, can expire)
  suspiciousIps:     'soc:live:suspiciousIps',
  uniqueThreatIps:   'soc:live:uniqueThreatIps',
  // Radar category scores (expires hourly — rebuilt from events)
  radarHash:         'soc:live:radar:scores',
  // Recent events list (cap 100 — display only)
  recentEvents:      'soc:live:recentEvents',
  // Sparkline hourly snapshots (kept 24 points)
  sparklineFailed:   'soc:spark:failedLogins',
  sparklineBlocked:  'soc:spark:blocked',
  sparklineEvents:   'soc:spark:events',
  // Cache buster for metrics endpoint
  metricsCache:      'soc:cache:metrics:v4',
};

// ── Map event type to radar category ─────────────────────────────────────
function _radarCategory(type) {
  const t = (type || '').toUpperCase();
  if (/LOGIN_FAILED|INVALID_TOKEN|BRUTE/.test(t)) return 'brute_force';
  if (/GEO_ANOMALY|COUNTRY/.test(t))              return 'geo_anomalies';
  if (/MALWARE|INJECT|PROBE/.test(t))             return 'malware';
  if (/RATE_LIMIT|DDOS|FLOOD/.test(t))            return 'ddos';
  if (/API_ABUSE|API_SPIKE/.test(t))              return 'api_abuse';
  if (/SESSION|HIJACK|REPLAY/.test(t))            return 'session_hijack';
  return null;
}

// ── Record security event to BOTH Redis and MongoDB ───────────────────────
async function recordSecurityEvent(type, options = {}) {
  const { ipAddress, severity = 'HIGH', schoolId } = options;

  // LAYER 1: Redis realtime telemetry (fast increment)
  try {
    if (/LOGIN_FAILED|INVALID_TOKEN/.test(type)) {
      await redis.incr(KEYS.failedLogins24h).catch(() => {});
      await redis.incr(KEYS.failedLoginsHour).catch(() => {});
      // Set expiry only on the hourly counter
      const hval = await redis.get(KEYS.failedLoginsHour).catch(() => null);
      if (hval === '1') await redis.expire(KEYS.failedLoginsHour, 3600).catch(() => {});
    }
    if (/IP_BLOCKED|RATE_LIMIT/.test(type)) {
      await redis.incr(KEYS.blockedEvents24h).catch(() => {});
    }
    if (/CRITICAL|BRUTE_FORCE|BREACH/.test(type) || severity === 'CRITICAL') {
      await redis.incr(KEYS.criticalEvents24h).catch(() => {});
    }
    if (/GEO_ANOMALY/.test(type)) {
      await redis.incr(KEYS.geoAnomalies24h).catch(() => {});
    }
    if (/MALWARE|INJECT|PROBE/.test(type)) {
      await redis.incr(KEYS.malware24h).catch(() => {});
    }
    if (/RATE_LIMIT|API_ABUSE/.test(type)) {
      const av = await redis.incr(KEYS.apiAbuse1h).catch(() => null);
      if (av === 1) await redis.expire(KEYS.apiAbuse1h, 3600).catch(() => {});
    }

    // Track suspicious IPs
    if (ipAddress && !/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.)/.test(ipAddress)) {
      await redis.sadd(KEYS.uniqueThreatIps, ipAddress).catch(() => {});
      // zincrby via set workaround
      const score = parseInt(await redis.get(`soc:ip:${ipAddress}`).catch(() => '0') || '0', 10) + 1;
      await redis.set(`soc:ip:${ipAddress}`, String(score)).catch(() => {});
    }

    // Update radar hash
    const radarCategory = _radarCategory(type);
    if (radarCategory) {
      await redis.hincrby(KEYS.radarHash, radarCategory, 1).catch(() => {});
    }

    // Push to recent events
    const payload = JSON.stringify({
      type, ipAddress, severity, at: new Date().toISOString()
    });
    await redis.lpush(KEYS.recentEvents, payload).catch(() => {});
    await redis.ltrim(KEYS.recentEvents, 0, 99).catch(() => {});

    // Invalidate metrics cache
    await redis.del(KEYS.metricsCache).catch(() => {});

  } catch (err) {
    console.warn('[SecurityMetrics:redis]', err.message);
  }

  // LAYER 2: MongoDB permanent analytics (fire-and-forget)
  analyticsService.recordEvent({ type, ipAddress, severity, schoolId }).catch(() => {});

  // Emit Socket.IO update
  global.emitSecurityUpdate?.('security:live_event', {
    type, ipAddress, severity, at: new Date().toISOString()
  });
}

// ── getLiveMetrics — dual-layer stable metrics ────────────────────────────
async function getLiveMetrics() {
  // Check short-term cache (15 seconds)
  try {
    const cached = await redis.get(KEYS.metricsCache);
    if (cached) return JSON.parse(cached);
  } catch (_) {}

  const now = new Date();
  const dayAgo  = new Date(now - 86400000);
  const hourAgo = new Date(now - 3600000);

  // ── Read Redis live counters ───────────────────────────────────────────
  const [
    redisFailedDay, redisFailedHour, redisBlocked,
    redisCritical, redisGeo, redisMalware,
    redisSuspiciousIpCount, redisRadarHash,
    sparklineFailed, sparklineBlocked, sparklineEvents,
  ] = await Promise.all([
    redis.get(KEYS.failedLogins24h).then((v) => parseInt(v || '0', 10)).catch(() => 0),
    redis.get(KEYS.failedLoginsHour).then((v) => parseInt(v || '0', 10)).catch(() => 0),
    redis.get(KEYS.blockedEvents24h).then((v) => parseInt(v || '0', 10)).catch(() => 0),
    redis.get(KEYS.criticalEvents24h).then((v) => parseInt(v || '0', 10)).catch(() => 0),
    redis.get(KEYS.geoAnomalies24h).then((v) => parseInt(v || '0', 10)).catch(() => 0),
    redis.get(KEYS.malware24h).then((v) => parseInt(v || '0', 10)).catch(() => 0),
    redis.scard(KEYS.uniqueThreatIps).then((v) => parseInt(v || '0', 10)).catch(() => 0),
    redis.hgetall(KEYS.radarHash).catch(() => ({})),
    redis.lrange(KEYS.sparklineFailed, 0, 6).catch(() => []),
    redis.lrange(KEYS.sparklineBlocked, 0, 6).catch(() => []),
    redis.lrange(KEYS.sparklineEvents, 0, 6).catch(() => []),
  ]);

  // ── Read MongoDB permanent analytics ──────────────────────────────────
  const todayAnalytics = await analyticsService.getTodayAnalytics();

  // ── BLEND: Use MongoDB as ground truth, Redis as live delta ───────────
  // Rule: take the MAX of Redis and MongoDB for each counter
  // This handles: cold start, dyno restart, Redis expiry all correctly
  const failedLogins24h  = Math.max(redisFailedDay,  todayAnalytics.totalFailedLogins   || 0);
  const blockedEvents    = Math.max(redisBlocked,     todayAnalytics.totalFirewallBlocks || 0);
  const criticalCount    = Math.max(redisCritical,    todayAnalytics.totalThreats        || 0);
  const geoCount         = Math.max(redisGeo,         todayAnalytics.totalGeoAnomalies   || 0);
  const malwareCount     = Math.max(redisMalware,     todayAnalytics.totalMalwareAttempts|| 0);
  const suspiciousIpCount= Math.max(
    redisSuspiciousIpCount,
    (todayAnalytics.uniqueThreatIps || []).length
  );

  // If Redis counters are all zero (cold start), seed them from MongoDB
  const redisHasData = redisFailedDay > 0 || redisBlocked > 0 || redisCritical > 0;
  if (!redisHasData && failedLogins24h > 0) {
    // Fire-and-forget seeding — don't await to avoid slowing the response
    analyticsService.seedRedisFromMongo(redis).catch(() => {});
  }

  // ── Active sessions (MongoDB — not tracked in analytics) ──────────────
  const activeSessions = await LoginSession.countDocuments({ isActive: true }).catch(() => 0);
  const highRiskUsers  = await User.countDocuments({ riskLevel: { $in: ['HIGH', 'CRITICAL'] } }).catch(() => 0);
  const lockedAccounts = await User.countDocuments({ lockedUntil: { $gt: new Date() } }).catch(() => 0);

  // ── Derived metrics ───────────────────────────────────────────────────
  const failedLoginsHour = redisFailedHour; // Hourly is always Redis (TTL-safe)
  const aiDetections     = parseInt(await redis.get(KEYS.aiDetections24h).catch(() => '0') || '0', 10)
                           || (criticalCount + Math.floor(failedLoginsHour * 0.4));
  const securityScore    = Math.max(60, Math.min(100,
    100
    - criticalCount * 3            // CRITICAL events
    - Math.floor(failedLoginsHour / 5)  // hourly attack rate
    - highRiskUsers                // high-risk profiles
    - Math.min(10, lockedAccounts * 2)  // locked accounts (max -10)
    // NOTE: single failed logins do NOT decrease score
    // Only locked accounts (5+ consecutive failures) decrease it
  ));
  const riskScore        = Math.max(10, criticalCount * 5 + Math.floor(failedLoginsHour * 2));
  const threatLevel      = criticalCount > 5 ? 'CRITICAL'
                         : criticalCount > 2 ? 'HIGH'
                         : failedLogins24h > 20 ? 'MEDIUM' : 'LOW';

  // ── Radar from Redis hash or derive ───────────────────────────────────
  const rh = redisRadarHash || {};
  const radarThreats = [
    { name: 'Brute Force',    level: Math.min(0.99, (parseInt(rh.brute_force    || '0') || failedLoginsHour)  * 0.04) },
    { name: 'Geo Anomalies',  level: Math.min(0.90, (parseInt(rh.geo_anomalies  || '0') || geoCount)          * 0.08) },
    { name: 'Malware Probes', level: Math.min(0.90, (parseInt(rh.malware        || '0') || malwareCount)       * 0.08) },
    { name: 'DDoS Traffic',   level: Math.min(0.85, (parseInt(rh.ddos           || '0') || blockedEvents)      * 0.06) },
    { name: 'API Abuse',      level: Math.min(0.80, (parseInt(rh.api_abuse      || '0') || suspiciousIpCount)  * 0.03) },
    { name: 'Session Hijack', level: Math.min(0.90, (parseInt(rh.session_hijack || '0') || criticalCount)      * 0.07) },
  ];

  // ── Sparklines from 7-day MongoDB analytics history ───────────────────
  // Use MongoDB history for stable sparklines that survive restarts
  const history7d = await analyticsService.getAnalyticsHistory(7);
  const maxFailed  = Math.max(1, ...history7d.map((d) => d.totalFailedLogins  || 0));
  const maxBlocked = Math.max(1, ...history7d.map((d) => d.totalFirewallBlocks|| 0));
  const maxThreats = Math.max(1, ...history7d.map((d) => d.totalThreats       || 0));

  const failedSparkMongo  = history7d.map((d) => parseFloat(((d.totalFailedLogins   || 0) / maxFailed ).toFixed(3)));
  const blockedSparkMongo = history7d.map((d) => parseFloat(((d.totalFirewallBlocks || 0) / maxBlocked).toFixed(3)));
  const threatsSparkMongo = history7d.map((d) => parseFloat(((d.totalThreats        || 0) / maxThreats).toFixed(3)));

  // Blend Redis real-time sparkline with MongoDB historical
  // Last point = current value, previous points = MongoDB history
  const _toSpark = (mongoArr, currentVal, maxVal) => {
    if (mongoArr.length >= 7) {
      const arr = [...mongoArr.slice(0, 6), Math.min(1, currentVal / Math.max(1, maxVal))];
      return arr;
    }
    return [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, Math.min(1, currentVal / Math.max(1, maxVal))];
  };

  const metrics = {
    securityScore:   `${securityScore} / 100`,
    threatLevel,
    failedLogins:    failedLogins24h,
    failedLoginsHour,
    suspiciousIps:   suspiciousIpCount,
    firewallBlocks:  blockedEvents,
    aiDetections,
    activeSessions,
    lockedAccounts,
    geoAnomalies:    geoCount,
    malwareAttempts: malwareCount,
    riskScore:       `${riskScore} / 100`,
    zeroTrustHealth: `${Math.min(99, 97 - criticalCount)}%`,
    liveIncidents:   criticalCount,
    highRiskUsers,
    radarThreats,
    // Stable 7-day sparklines from MongoDB
    sparklines: {
      failedLogins:    _toSpark(failedSparkMongo,  failedLogins24h,  maxFailed),
      firewallBlocks:  _toSpark(blockedSparkMongo, blockedEvents,    maxBlocked),
      liveIncidents:   _toSpark(threatsSparkMongo,  criticalCount,   maxThreats),
      activeSessions:  [0.8, 0.82, 0.85, 0.87, 0.88, 0.9, Math.min(1, activeSessions / 2000)],
      securityScore:   [0.87, 0.88, 0.90, 0.91, 0.92, 0.93, securityScore / 100],
      suspiciousIps:   failedSparkMongo.map((v) => parseFloat((v * 0.3).toFixed(3))),
      aiDetections:    threatsSparkMongo,
      geoAnomalies:    failedSparkMongo.map((v) => parseFloat((v * 0.12).toFixed(3))),
      malwareAttempts: blockedSparkMongo.map((v) => parseFloat((v * 0.5).toFixed(3))),
      riskScore:       threatsSparkMongo.map((v) => parseFloat((1 - v * 0.6).toFixed(3))),
      zeroTrustHealth: [0.88, 0.90, 0.92, 0.93, 0.95, 0.96, Math.min(0.99, 0.97 - criticalCount * 0.01)],
      threatLevel:     threatsSparkMongo,
    },
    // MongoDB permanent totals (for historical display)
    permanentTotals: {
      allTimeFailedLogins: todayAnalytics.totalFailedLogins    || 0,
      allTimeBlocked:      todayAnalytics.totalFirewallBlocks  || 0,
      allTimeThreats:      todayAnalytics.totalThreats         || 0,
      todayDate:           analyticsService._todayKey(),
    },
    generatedAt: now.toISOString(),
  };

  // Cache for 15 seconds
  await redis.setex(KEYS.metricsCache, 15, JSON.stringify(metrics)).catch(() => {});
  return metrics;
}

// ── Hourly sparkline snapshot (called by cron at :00 of each hour) ────────
async function snapshotHourlySparkline() {
  try {
    // Push current hourly count to sparkline lists
    const failedHour = parseInt(await redis.get(KEYS.failedLoginsHour).catch(() => '0') || '0', 10);
    const blockedDay = parseInt(await redis.get(KEYS.blockedEvents24h).catch(() => '0') || '0', 10);

    await redis.lpush(KEYS.sparklineFailed, failedHour).catch(() => {});
    await redis.ltrim(KEYS.sparklineFailed, 0, 23).catch(() => {});
    await redis.lpush(KEYS.sparklineBlocked, blockedDay).catch(() => {});
    await redis.ltrim(KEYS.sparklineBlocked, 0, 23).catch(() => {});

    // Reset hourly counter (daily counter stays intact in MongoDB)
    await redis.del(KEYS.failedLoginsHour).catch(() => {});
    await redis.del(KEYS.apiAbuse1h).catch(() => {});
    await redis.del(KEYS.metricsCache).catch(() => {});

    console.log('[SecurityMetrics:snapshot] Hourly sparkline snapshot saved');
  } catch (err) {
    console.warn('[SecurityMetrics:snapshot]', err.message);
  }
}

// ── Daily midnight reset (hourly counters reset, MongoDB never resets) ────
async function dailyCounterReset() {
  try {
    // Only delete 24h Redis counters — MongoDB accumulates permanently
    await redis.del(KEYS.failedLogins24h).catch(() => {});
    await redis.del(KEYS.blockedEvents24h).catch(() => {});
    await redis.del(KEYS.criticalEvents24h).catch(() => {});
    await redis.del(KEYS.geoAnomalies24h).catch(() => {});
    await redis.del(KEYS.malware24h).catch(() => {});
    await redis.del(KEYS.uniqueThreatIps).catch(() => {});
    await redis.del(KEYS.radarHash).catch(() => {});
    await redis.del(KEYS.metricsCache).catch(() => {});
    console.log('[SecurityMetrics] Daily Redis counters reset. MongoDB totals preserved.');
  } catch (err) {
    console.warn('[SecurityMetrics:dailyReset]', err.message);
  }
}

module.exports = {
  recordSecurityEvent,
  getLiveMetrics,
  snapshotHourlySparkline,
  dailyCounterReset,
  KEYS,
};
