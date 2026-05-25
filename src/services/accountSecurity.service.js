// services/accountSecurity.service.js
// Enterprise account-level security engine.
// Google/GitHub/AWS model: lock the ACCOUNT, not the IP.
// IP tracking is for SOC intelligence ONLY, never for blocking.

const User = require('../models/User');
const LoginAttemptLog = require('../models/LoginAttemptLog');
const redis = require('../config/redis');

// ── Lockout thresholds ─────────────────────────────────────────────────────
const LOCKOUT_RULES = {
  // Standard roles: PRINCIPAL, OPERATOR, TEACHER, STUDENT, PARENT
  standard: [
    { afterAttempts: 3,  lockMinutes: 0,    level: 1, captcha: false }, // warn
    { afterAttempts: 5,  lockMinutes: 15,   level: 2, captcha: false }, // lock 15min
    { afterAttempts: 10, lockMinutes: 60,   level: 3, captcha: true  }, // lock 1hr + captcha
    { afterAttempts: 20, lockMinutes: 1440, level: 4, captcha: true  }, // lock 24hr
  ],
  // Super Admin: extra strict — always show captcha, longer locks
  SUPER_ADMIN: [
    { afterAttempts: 2,  lockMinutes: 0,    level: 1, captcha: true  }, // captcha immediately
    { afterAttempts: 3,  lockMinutes: 30,   level: 2, captcha: true  }, // lock 30min
    { afterAttempts: 5,  lockMinutes: 120,  level: 3, captcha: true  }, // lock 2hr
    { afterAttempts: 10, lockMinutes: 1440, level: 4, captcha: true  }, // lock 24hr
  ],
};

// ── IP intelligence thresholds (SOC monitoring only, NOT blocking) ─────────
const IP_RULES = {
  suspiciousAfterAttempts: 20,       // flag IP as suspicious in SOC
  highThreatAfterAccounts: 5,        // IP attacking 5+ accounts = high threat
  extremeBanAfterAttempts: 100,      // only at 100+ attempts consider IP ban
};

// ── Parse user agent into readable device info ─────────────────────────────
function _parseUserAgent(ua) {
  if (!ua) return { browser: 'Unknown', os: 'Unknown', deviceType: 'Unknown' };
  const browser =
    /Chrome/.test(ua) ? 'Chrome' :
    /Firefox/.test(ua) ? 'Firefox' :
    /Safari/.test(ua) && !/Chrome/.test(ua) ? 'Safari' :
    /Edge/.test(ua) ? 'Edge' :
    /MSIE|Trident/.test(ua) ? 'IE' : 'Other';
  const os =
    /Windows/.test(ua) ? 'Windows' :
    /Mac OS/.test(ua) ? 'macOS' :
    /Linux/.test(ua) ? 'Linux' :
    /Android/.test(ua) ? 'Android' :
    /iPhone|iPad/.test(ua) ? 'iOS' : 'Other';
  const deviceType = /Mobile|Android|iPhone/.test(ua) ? 'Mobile'
                   : /Tablet|iPad/.test(ua) ? 'Tablet' : 'Desktop';
  return { browser, os, deviceType };
}

// ── Check if account is currently locked ──────────────────────────────────
async function isAccountLocked(user) {
  if (!user.lockedUntil) return { locked: false };
  const now = new Date();
  if (user.lockedUntil > now) {
    const secondsLeft = Math.ceil((user.lockedUntil - now) / 1000);
    const minutesLeft = Math.ceil(secondsLeft / 60);
    return {
      locked: true,
      lockedUntil: user.lockedUntil,
      secondsLeft,
      minutesLeft,
      lockoutLevel: user.lockoutLevel || 2,
      captchaRequired: user.captchaRequired || false,
      message: minutesLeft > 60
        ? `Account locked for ${Math.ceil(minutesLeft / 60)} hour(s) due to too many failed attempts.`
        : `Account locked for ${minutesLeft} more minute(s) due to too many failed attempts.`,
    };
  }
  // Lock expired — clear it
  await User.findByIdAndUpdate(user._id, {
    $set: {
      lockedUntil: null,
      lockoutLevel: 0,
      consecutiveFailedLogins: 0,
      captchaRequired: false,
    }
  }).catch(() => {});
  return { locked: false };
}

// ── Handle a failed login attempt (account-level) ─────────────────────────
async function handleFailedLogin(user, req) {
  if (!user) return { locked: false, level: 0 };

  const rules = LOCKOUT_RULES[user.role] || LOCKOUT_RULES.standard;
  const now = new Date();

  // Increment consecutive failed count atomically
  const updated = await User.findByIdAndUpdate(
    user._id,
    {
      $inc: {
        consecutiveFailedLogins: 1,
        failedLogins: 1,
        totalFailedLoginsAllTime: 1,
      },
      $set: { lastFailedLogin: now },
    },
    { new: true }
  ).catch(() => null);

  if (!updated) return { locked: false, level: 0 };

  const attempts = updated.consecutiveFailedLogins;
  let lockResult = { locked: false, level: 0, captchaRequired: false };

  // Find matching lockout rule (highest threshold not exceeded)
  let appliedRule = null;
  for (const rule of [...rules].reverse()) {
    if (attempts >= rule.afterAttempts) {
      appliedRule = rule;
      break;
    }
  }

  if (appliedRule) {
    const lockUntil = appliedRule.lockMinutes > 0
      ? new Date(now.getTime() + appliedRule.lockMinutes * 60000)
      : null;

    await User.findByIdAndUpdate(user._id, {
      $set: {
        lockedUntil:     lockUntil,
        lockoutLevel:    appliedRule.level,
        captchaRequired: appliedRule.captcha,
      }
    }).catch(() => {});

    lockResult = {
      locked:          lockUntil != null,
      lockedUntil,
      level:           appliedRule.level,
      captchaRequired: appliedRule.captcha,
      minutesLocked:   appliedRule.lockMinutes,
    };
  }

  // Track IP intelligence (SOC only — NOT for blocking regular users)
  await _trackIpIntelligence(req?.ip, user._id, user.role).catch(() => {});

  return {
    ...lockResult,
    consecutiveAttempts: attempts,
  };
}

// ── Reset failed login count on successful login ──────────────────────────
async function handleSuccessfulLogin(user, req) {
  await User.findByIdAndUpdate(user._id, {
    $set: {
      consecutiveFailedLogins: 0,
      lockedUntil:             null,
      lockoutLevel:            0,
      captchaRequired:         false,
      lastLogin:               new Date(),
      lastKnownIp:             req?.ip || null,
      lastKnownDevice:         req?.headers?.['user-agent']?.slice(0, 100) || 'Unknown',
    },
    $inc: {
      successLogins: 1,
      totalLogins: 1,
    },
  }).catch(() => {});
}

// ── Log every attempt to permanent audit trail ────────────────────────────
async function logAttempt(options) {
  const {
    userId, email, mobile, role, schoolId,
    result, req,
    lockoutTriggered = false, lockoutLevel = 0,
    lockoutUntil = null, captchaRequired = false,
  } = options;

  const ua = req?.headers?.['user-agent'] || '';
  const { browser, os, deviceType } = _parseUserAgent(ua);
  const ipAddress = req?.ip || req?.connection?.remoteAddress || null;

  // Get IP stats for this log entry (from Redis — no MongoDB query)
  const ipKey = `ip:attempts:${ipAddress}`;
  const ipCount = parseInt(await redis.get(ipKey).catch(() => '0') || '0', 10);
  const ipAccountsKey = `ip:accounts:${ipAddress}`;
  const ipAccounts = parseInt(await redis.get(ipAccountsKey).catch(() => '0') || '0', 10);

  LoginAttemptLog.create({
    userId, email, mobile, role, schoolId,
    result, lockoutTriggered, lockoutLevel, lockoutUntil, captchaRequired,
    ipAddress,
    userAgent: ua.slice(0, 300),
    browser, os, deviceType,
    ipAttemptCount: ipCount,
    ipAccountsTargeted: ipAccounts,
    ipIsSuspicious: ipCount >= IP_RULES.suspiciousAfterAttempts,
  }).catch(() => {});
}

// ── IP intelligence tracking (SOC monitoring — no user blocking) ──────────
async function _trackIpIntelligence(ipAddress, userId, userRole) {
  if (!ipAddress) return;
  const isPrivate = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.)/.test(ipAddress);

  // Track attempt count (24h window)
  const ipKey = `ip:attempts:${ipAddress}`;
  const count = await redis.incr(ipKey).catch(() => 0);
  if (count === 1) await redis.expire(ipKey, 86400).catch(() => {});

  // Track unique accounts targeted by this IP (24h window)
  const ipAccountsKey = `ip:accounts:${ipAddress}`;
  await redis.sadd(ipAccountsKey, userId.toString()).catch(() => {});
  await redis.expire(ipAccountsKey, 86400).catch(() => {});
  const uniqueAccounts = await redis.scard(ipAccountsKey).catch(() => 0);

  // Classify IP threat level for SOC (informational only)
  let ipThreatLevel = 'LOW';
  if (count >= IP_RULES.extremeBanAfterAttempts || uniqueAccounts >= IP_RULES.highThreatAfterAccounts) {
    ipThreatLevel = 'CRITICAL';
  } else if (count >= IP_RULES.suspiciousAfterAttempts) {
    ipThreatLevel = 'HIGH';
  } else if (count >= 10) {
    ipThreatLevel = 'MEDIUM';
  }

  // Only flag external IPs for SOC monitoring
  if (!isPrivate && count >= IP_RULES.suspiciousAfterAttempts) {
    // Record in SecurityAnalytics for SOC dashboard — NOT in firewall block list
    const analyticsService = require('./securityAnalytics.service');
    analyticsService.recordEvent({
      type: 'SUSPICIOUS_IP_DETECTED',
      ipAddress,
      severity: ipThreatLevel === 'CRITICAL' ? 'CRITICAL' : 'HIGH',
    }).catch(() => {});

    // Emit SOC alert (super admin dashboard only)
    global.emitSecurityUpdate?.('security:suspicious_ip', {
      ipAddress,
      attackCount: count,
      uniqueAccounts,
      threatLevel: ipThreatLevel,
      at: new Date().toISOString(),
    });
  }

  return { count, uniqueAccounts, ipThreatLevel };
}

// ── Check if IP should be banned (extreme cases only) ─────────────────────
// This is NOT called for normal failed logins — only extreme attacks
async function shouldBanIp(ipAddress) {
  if (!ipAddress) return false;
  const isPrivate = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.)/.test(ipAddress);
  if (isPrivate) return false; // NEVER ban school networks

  const ipKey = `ip:attempts:${ipAddress}`;
  const count = parseInt(await redis.get(ipKey).catch(() => '0') || '0', 10);

  return count >= IP_RULES.extremeBanAfterAttempts;
}

// ── Check if IP is already banned (admin-applied only) ───────────────────
async function isIpBanned(ipAddress) {
  if (!ipAddress) return false;
  const isPrivate = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.)/.test(ipAddress);
  if (isPrivate) return false; // NEVER check school networks

  const banned = await redis.get(`blocked:ip:${ipAddress}`).catch(() => null);
  return banned !== null;
}

module.exports = {
  isAccountLocked,
  handleFailedLogin,
  handleSuccessfulLogin,
  logAttempt,
  shouldBanIp,
  isIpBanned,
  _parseUserAgent,
};
