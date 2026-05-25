// services/securityAnalytics.service.js
// Permanent MongoDB analytics layer.
// All counters are atomic $inc — safe for concurrent requests.
// NEVER uses Redis for permanent data.

const SecurityAnalytics = require('../models/SecurityAnalytics');

// Get today's date key in UTC: '2026-05-25'
function _todayKey() {
  return new Date().toISOString().slice(0, 10);
}

// ── Atomic increment for today's analytics document ───────────────────────
async function increment(field, amount = 1) {
  try {
    await SecurityAnalytics.findOneAndUpdate(
      { date: _todayKey() },
      { $inc: { [field]: amount } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  } catch (err) {
    // Log but never throw — analytics must never break the main request
    console.warn(`[SecurityAnalytics:increment] ${field}: ${err.message}`);
  }
}

// ── Record a full security event atomically ───────────────────────────────
async function recordEvent(event) {
  const {
    type,
    ipAddress,
    severity = 'HIGH',
    schoolId,
    country,
    city,
  } = event;

  const updateFields = { $inc: { totalSecurityEvents: 1 } };

  // Map event type to the right counter
  if (/LOGIN_FAILED|INVALID_TOKEN/.test(type)) {
    updateFields.$inc.totalFailedLogins = 1;
  }
  if (/IP_BLOCKED/.test(type)) {
    updateFields.$inc.totalBlockedIps = 1;
    updateFields.$inc.totalFirewallBlocks = 1;
  }
  if (/RATE_LIMIT|FIREWALL/.test(type)) {
    updateFields.$inc.totalFirewallBlocks = 1;
    updateFields.$inc.totalRateLimitHits = 1;
  }
  if (/BRUTE_FORCE/.test(type)) {
    updateFields.$inc.totalBruteForce = 1;
    updateFields.$inc.totalThreats = 1;
  }
  if (/GEO_ANOMALY/.test(type)) {
    updateFields.$inc.totalGeoAnomalies = 1;
    updateFields.$inc.totalThreats = 1;
  }
  if (/MALWARE|INJECT|PROBE/.test(type)) {
    updateFields.$inc.totalMalwareAttempts = 1;
    updateFields.$inc.totalThreats = 1;
  }
  if (/SESSION|HIJACK/.test(type)) {
    updateFields.$inc.totalSessionHijack = 1;
    updateFields.$inc.totalThreats = 1;
  }
  if (severity === 'CRITICAL') {
    updateFields.$inc.totalAiDetections = 1;
  }

  // Track unique suspicious IPs (external only)
  if (ipAddress && !/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.)/.test(ipAddress)) {
    updateFields.$inc.totalSuspiciousIps = 1;
    updateFields.$addToSet = { uniqueThreatIps: ipAddress };
  }

  // Track schools affected
  if (schoolId) {
    if (!updateFields.$addToSet) updateFields.$addToSet = {};
    updateFields.$addToSet.schoolsAffected = schoolId.toString();
  }

  try {
    await SecurityAnalytics.findOneAndUpdate(
      { date: _todayKey() },
      updateFields,
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  } catch (err) {
    console.warn(`[SecurityAnalytics:recordEvent] ${err.message}`);
  }
}

// ── Get today's permanent analytics ──────────────────────────────────────
async function getTodayAnalytics() {
  try {
    const doc = await SecurityAnalytics.findOne({ date: _todayKey() }).lean();
    return doc || { date: _todayKey() };
  } catch (err) {
    return { date: _todayKey() };
  }
}

// ── Get analytics for last N days (for sparklines) ────────────────────────
async function getAnalyticsHistory(days = 7) {
  try {
    const dates = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - i);
      dates.push(d.toISOString().slice(0, 10));
    }
    const docs = await SecurityAnalytics.find({ date: { $in: dates } }).lean();
    const map = Object.fromEntries(docs.map((d) => [d.date, d]));
    // Return in chronological order, defaulting to 0 for missing days
    return dates.map((date) => map[date] || {
      date,
      totalFailedLogins: 0,
      totalFirewallBlocks: 0,
      totalThreats: 0,
    });
  } catch (err) {
    return [];
  }
}

// ── Seed Redis from today's MongoDB analytics (fixes cold start) ──────────
async function seedRedisFromMongo(redis) {
  try {
    const today = await getTodayAnalytics();
    if (!today || !today.totalFailedLogins) return;

    const KEYS = require('./security.metrics').KEYS;
    const currentRedis = await redis.get(KEYS.failedLogins24h).catch(() => '0');
    const redisVal = parseInt(currentRedis || '0', 10);
    const mongoVal = today.totalFailedLogins || 0;

    // Only seed if Redis is lower (handles cold start, not overwrite live data)
    if (redisVal < mongoVal) {
      await redis.set(KEYS.failedLogins24h, String(mongoVal)).catch(() => {});
      console.log(`[SecurityAnalytics] Redis seeded from MongoDB: failedLogins=${mongoVal}`);
    }
    if (today.totalFirewallBlocks > 0) {
      const currentBlocked = parseInt(await redis.get(KEYS.blockedEvents24h).catch(() => '0') || '0', 10);
      if (currentBlocked < today.totalFirewallBlocks) {
        await redis.set(KEYS.blockedEvents24h, String(today.totalFirewallBlocks)).catch(() => {});
      }
    }
  } catch (err) {
    console.warn('[SecurityAnalytics:seedRedis]', err.message);
  }
}

module.exports = {
  increment,
  recordEvent,
  getTodayAnalytics,
  getAnalyticsHistory,
  seedRedisFromMongo,
  _todayKey,
};
