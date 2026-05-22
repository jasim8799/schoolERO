const FirewallEvent = require('../models/FirewallEvent');
const redis = require('../config/redis');
const crypto = require('crypto');
const { recordSecurityEvent } = require('../services/security.metrics');

const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX    = 100;   // 100 requests/minute per IP

function _generateFirewallId() {
  return `FW-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
}

/**
 * Express middleware: per-IP rate limiting, injection detection, and IP blacklist enforcement.
 * Non-blocking firewall event logging to MongoDB.
 */
function firewallMiddleware() {
  return async (req, res, next) => {
    const ip   = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || '0.0.0.0';
    const path = req.path;

    try {
      // ── Rate limit check with timeout protection ───────────────────────
      const rateKey = `ratelimit:${ip}:${Math.floor(Date.now() / RATE_LIMIT_WINDOW)}`;
      const redisResult = await Promise.race([
        redis.incr(rateKey),
        new Promise((resolve) => setTimeout(() => resolve(0), 500))
      ]).catch(() => 0);

      if (redisResult === 1) {
        redis.expire(rateKey, 2).catch(() => {});
      }

      if (redisResult > RATE_LIMIT_MAX) {
        _logFirewallEvent(ip, 'RATE_LIMITED', path, req, 0.65, 'RATE_LIMIT_EXCEEDED').catch(() => {});
        recordSecurityEvent('RATE_LIMIT_EXCEEDED', { ipAddress: ip, severity: 'HIGH' }).catch(() => {});
        global.io?.of('/activity').emit('firewall:event', {
          ip, action: 'RATE_LIMITED', path, timestamp: new Date(),
        });
        return res.status(429).json({
          success: false,
          message: 'Rate limit exceeded. Please slow down.',
        });
      }

      // ── Detect injection patterns ─────────────────────────────────────
      const body    = JSON.stringify(req.body  || {});
      const query   = JSON.stringify(req.query || {});
      const combined = `${path}${body}${query}`;
      if (_detectInjection(combined)) {
        _logFirewallEvent(ip, 'BLOCKED', path, req, 0.92, 'INJECTION_DETECTED').catch(() => {});
        recordSecurityEvent('INJECTION_DETECTED', { ipAddress: ip, severity: 'CRITICAL' }).catch(() => {});
        return res.status(400).json({ success: false, message: 'Request blocked by firewall' });
      }

      // ── Blocked IP check with timeout protection ──────────────────────
      const blocked = await Promise.race([
        redis.get(`blocked:ip:${ip}`),
        new Promise((resolve) => setTimeout(() => resolve(null), 300))
      ]).catch(() => null);

      if (blocked) {
        _logFirewallEvent(ip, 'BLOCKED', path, req, 0.95, 'IP_BLACKLISTED').catch(() => {});
        recordSecurityEvent('IP_BLACKLISTED', { ipAddress: ip, severity: 'HIGH' }).catch(() => {});
        return res.status(403).json({ success: false, message: 'Access denied' });
      }
    } catch (_) {
      // Firewall failure should not block legitimate traffic.
    }

    // Track request counts (async, non-blocking)
    _trackApiRequest(ip).catch(() => {});

    next();
  };
}

async function _logFirewallEvent(ip, action, path, req, riskScore, reason) {
  await FirewallEvent.create({
    eventId:      _generateFirewallId(),
    ipAddress:    ip,
    action,
    reason,
    requestPath:  path,
    method:       req.method,
    userAgent:    req.headers?.['user-agent']?.substring(0, 200),
    riskScore,
    ruleTriggered: reason,
  });
}

/**
 * Injection pattern detection.
 * Uses read-only regex matching — no dynamic code execution.
 */
function _detectInjection(input) {
  const sqlPattern  = /(\bSELECT\b|\bINSERT\b|\bDROP\b|\bUNION\b|\bOR\b\s+['"\d])/i;
  const nosqlPattern = /\$where|\$ne|\$gt|\$lt|\$regex.*eval/i;
  const xssPattern  = /<script|javascript:|onerror=|onload=/i;
  return sqlPattern.test(input) || nosqlPattern.test(input) || xssPattern.test(input);
}

async function _trackApiRequest() {
  const dayKey = `api:requests:${new Date().toISOString().split('T')[0]}`;
  await redis.incr(dayKey);
  await redis.expire(dayKey, 86400);
}

/**
 * Block an IP address in Redis for a given duration.
 * Also writes a FirewallEvent record for audit trail.
 */
async function blockIp(ipAddress, durationHours = 1, reason = 'Admin block') {
  await redis.setex(`blocked:ip:${ipAddress}`, durationHours * 3600, reason);
  recordSecurityEvent('IP_BLOCKED', { ipAddress, severity: 'CRITICAL' }).catch(() => {});
  await _logFirewallEvent(
    ipAddress,
    'BLOCKED',
    '/admin/block',
    { method: 'POST', headers: {} },
    1.0,
    'ADMIN_BLOCK',
  );
}

module.exports = { firewallMiddleware, blockIp };
