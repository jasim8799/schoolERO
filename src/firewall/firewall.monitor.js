const FirewallEvent = require('../models/FirewallEvent');
const redis = require('../config/redis');
const crypto = require('crypto');
const { recordSecurityEvent } = require('../services/security.metrics');

const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX    = 100;   // 100 requests/minute per IP

// Fields that legitimately contain unrestricted text (CRUD-safe)
const SAFE_TEXT_FIELDS = new Set([
  'name', 'address', 'city', 'state', 'pincode', 'mobile', 'email', 'phone',
  'designation', 'department', 'qualification', 'subjects',
  'previousSchool', 'employeeId', 'accountNumber', 'ifscCode',
  'emergencyContactName', 'emergencyContactRelation', 'emergencyContactPhone',
  'spouseName', 'spouseMobile', 'bloodGroup', 'gender', 'occupation',
  'description', 'note', 'remarks', 'comments', 'feedback',
  'whatsappNumber', 'upiId', 'bankName', 'schoolName', 'schoolCode',
  'className', 'section', 'title', 'content', 'message',
  'street', 'landmark', 'building', 'block', 'sector', 'ward',
  'courseCode', 'courseName', 'program', 'stream'
]);

// Fields that CANNOT be included in query strings (prevent injection via URL params)
const PROTECTED_QUERY_FIELDS = new Set([
  'password', 'apiKey', 'token', 'secret', 'privateKey'
]);

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
    const hasBearerToken = req.headers.authorization?.startsWith('Bearer ');

    // Login/auth routes use per-account lockout only (app.js also skips firewall for /auth)
    if (path.startsWith('/auth')) {
      return next();
    }

    try {
      // ── Rate limit check with timeout protection (public non-auth traffic only) ───
      // IMPORTANT: Authenticated requests bypass IP-based rate limiting to allow bulk operations
      // (e.g., creating 100+ staff members). Per-account brute-force protection is handled
      // separately in auth.controller.js (accountSecurity.service.js).
      if (!hasBearerToken) {
        const rateKey = `ratelimit:${ip}:${Math.floor(Date.now() / RATE_LIMIT_WINDOW)}`;
        const redisResult = await Promise.race([
          redis.incr(rateKey),
          new Promise((resolve) => setTimeout(() => resolve(0), 500))
        ]).catch(() => 0);

        if (redisResult === 1) {
          redis.expire(rateKey, 2).catch(() => {});
        }

        if (redisResult > RATE_LIMIT_MAX) {
          console.warn(`[RATE_LIMIT] IP ${ip} exceeded limit on ${path}`);
          _logFirewallEvent(ip, 'RATE_LIMITED', path, req, 0.65, 'RATE_LIMIT_EXCEEDED', null).catch(() => {});
          recordSecurityEvent('RATE_LIMIT_EXCEEDED', { ipAddress: ip, severity: 'HIGH' }).catch(() => {});
          global.io?.of('/activity').emit('firewall:event', {
            ip, action: 'RATE_LIMITED', path, timestamp: new Date(),
          });
          return res.status(429).json({
            success: false,
            message: 'Rate limit exceeded. Please slow down.',
          });
        }
      } else {
        // Authenticated requests (Bearer token present) are trusted and skip IP-based rate limits
        // This allows authenticated admins to perform bulk operations (create 100+ staff, etc.)
        console.debug(`[FIREWALL] Authenticated request allowed for ${ip} on ${path}`);
      }

      // ── Detect injection patterns (field-level validation) ─────────────────────────────────────
      // Validate query params and body recursively
      const queryInjectionResult = _detectFieldInjection(req.query || {}, 'query', path, PROTECTED_QUERY_FIELDS);
      if (queryInjectionResult) {
        const { field, value, matchedPattern } = queryInjectionResult;
        console.warn(`[THREAT_TRACKING] Injection detected - Field: ${field}, Pattern: ${matchedPattern}, IP: ${ip}, Path: ${path}`);
        _logFirewallEvent(ip, 'BLOCKED', path, req, 0.92, 'INJECTION_DETECTED', {
          field, value: value?.substring(0, 100), matchedPattern, location: 'query'
        }).catch(() => {});
        recordSecurityEvent('INJECTION_DETECTED', { ipAddress: ip, severity: 'CRITICAL', field, path }).catch(() => {});
        return res.status(400).json({ success: false, message: 'Request blocked by firewall' });
      }

      const bodyInjectionResult = _detectFieldInjection(req.body || {}, 'body', path, SAFE_TEXT_FIELDS);
      if (bodyInjectionResult) {
        const { field, value, matchedPattern } = bodyInjectionResult;
        console.warn(`[THREAT_TRACKING] Injection detected - Field: ${field}, Pattern: ${matchedPattern}, IP: ${ip}, Path: ${path}`);
        _logFirewallEvent(ip, 'BLOCKED', path, req, 0.92, 'INJECTION_DETECTED', {
          field, value: value?.substring(0, 100), matchedPattern, location: 'body'
        }).catch(() => {});
        recordSecurityEvent('INJECTION_DETECTED', { ipAddress: ip, severity: 'CRITICAL', field, path }).catch(() => {});
        return res.status(400).json({ success: false, message: 'Request blocked by firewall' });
      }

      // ── Blocked IP check (skip for school networks and authenticated requests) ───
      // School networks (10.x, 192.168.x, 172.16-31.x, 127.x) are NEVER blocked by IP bans
      const isPrivateIp = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|::1$|::ffff:10\.|::ffff:192\.168\.)/.test(ip);
      
      if (!isPrivateIp) {
        // Only check IP ban for external IPs
        const blocked = await Promise.race([
          redis.get(`blocked:ip:${ip}`),
          new Promise((resolve) => setTimeout(() => resolve(null), 300))
        ]).catch(() => null);

        // Allow authenticated requests through (even from banned IPs — admin investigating)
        if (blocked && !hasBearerToken) {
          console.warn(`[THREAT_TRACKING] Blacklisted IP ${ip} attempted access on ${path}`);
          _logFirewallEvent(ip, 'BLOCKED', path, req, 0.95, 'IP_BLACKLISTED', null).catch(() => {});
          recordSecurityEvent('IP_BLACKLISTED', { ipAddress: ip, severity: 'HIGH' }).catch(() => {});
          return res.status(429).json({ success: false, message: 'Access temporarily restricted. Please contact support.' });
        }
      }
      // All school network IPs pass through freely
    } catch (_) {
      // Firewall failure should not block legitimate traffic.
    }

    // Track request counts (async, non-blocking)
    _trackApiRequest(ip).catch(() => {});

    next();
  };
}

async function _logFirewallEvent(ip, action, path, req, riskScore, reason, details = {}) {
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
    userId:       req.user?.userId || null,
    userRole:     req.user?.role || null,
    schoolId:     req.user?.schoolId || null,
    details:      details, // Field name, matched pattern, etc.
  });
}

/**
 * Recursively validate fields in an object for injection patterns.
 * Skips non-string values (numbers, dates, ObjectIds, etc.)
 * 
 * @param {Object} obj - Object to validate
 * @param {String} source - 'query' or 'body'
 * @param {String} path - Request path
 * @param {Set} safeFields - Fields that allow unrestricted text
 * @returns {null|Object} - { field, value, matchedPattern } if injection found, else null
 */
function _detectFieldInjection(obj, source, path, safeFields) {
  for (const [fieldName, fieldValue] of Object.entries(obj)) {
    // Skip non-string values
    if (typeof fieldValue !== 'string') {
      continue;
    }

    // Skip empty strings
    if (!fieldValue.trim()) {
      continue;
    }

    // For query params, never allow suspicious patterns
    if (source === 'query') {
      const injectionResult = _testInjectionPatterns(fieldValue, fieldName, true);
      if (injectionResult) {
        return { field: fieldName, value: fieldValue, matchedPattern: injectionResult };
      }
    }
    
    // For body fields in SAFE_TEXT_FIELDS, only check for the most severe attacks
    if (source === 'body' && safeFields.has(fieldName)) {
      const severeInjectionResult = _testSevereInjectionPatterns(fieldValue, fieldName);
      if (severeInjectionResult) {
        return { field: fieldName, value: fieldValue, matchedPattern: severeInjectionResult };
      }
    } 
    // For non-SAFE fields, apply full injection detection
    else if (source === 'body' && !safeFields.has(fieldName)) {
      const injectionResult = _testInjectionPatterns(fieldValue, fieldName, false);
      if (injectionResult) {
        return { field: fieldName, value: fieldValue, matchedPattern: injectionResult };
      }
    }
  }

  return null; // No injection detected
}

/**
 * Test ONLY the most critical injection patterns (for SAFE_TEXT_FIELDS).
 * These are patterns that are NEVER legitimate in any text field.
 */
function _testSevereInjectionPatterns(value, fieldName) {
  // XSS patterns (always dangerous)
  if (/<script[^>]*>|javascript:|onerror=|onload=|onclick=/i.test(value)) {
    return 'XSS_DETECTED';
  }

  // Mongo/NoSQL injection with code execution
  if (/\$where.*function|\beval\s*\(|\bFunction\s*\(|\bexec\s*\(/i.test(value)) {
    return 'CODE_EXECUTION_DETECTED';
  }

  // SQL injection - catch actual SQL attack syntax (DROP, UNION, INSERT...VALUES)
  // These patterns detect actual SQL commands being injected, not just keywords in text
  if (/\b(DROP\s+TABLE|DELETE\s+FROM|UNION\s+SELECT|INSERT\s+INTO.*VALUES)\b/i.test(value)) {
    return 'SQL_INJECTION_DETECTED';
  }

  // Command injection patterns
  if (/[;&|`$(){}\\]/i.test(value) && /bash|sh|cmd|powershell|rm\s+-rf|rm\s+-fr|del\s+/i.test(value)) {
    return 'COMMAND_INJECTION_DETECTED';
  }

  // Prototype pollution
  if (/(__proto__|constructor\.prototype|prototype\.)/i.test(value)) {
    return 'PROTOTYPE_POLLUTION_DETECTED';
  }

  return null;
}

/**
 * Test ALL injection patterns (for non-SAFE fields).
 * This is stricter and catches SQL-style attacks even in field names.
 */
function _testInjectionPatterns(value, fieldName, strictMode) {
  // XSS patterns (always dangerous)
  if (/<script[^>]*>|javascript:|onerror=|onload=|onclick=/i.test(value)) {
    return 'XSS_DETECTED';
  }

  // Mongo/NoSQL injection patterns
  if (/\$where.*function|\beval\s*\(|\$ne.*true|\$gt.*null|\$regex.*eval/i.test(value)) {
    return 'NOSQL_INJECTION_DETECTED';
  }

  // SQL injection - refined to avoid false positives in CRUD operations
  // Only flag if it looks like actual SQL attack syntax, not just the word "SELECT"
  if (strictMode || !value.match(/^[a-zA-Z0-9\s.,'&\-]+$/)) {
    // Only in strict mode or when value contains suspicious characters
    if (/(\bDROP\b.*\bTABLE\b|\bDELETE\b.*\bFROM\b|\bUNION\b.*\bSELECT\b|\bINSERT\b.*\bINTO\b.*\bVALUES\b)/i.test(value)) {
      return 'SQL_INJECTION_DETECTED';
    }

    // Command injection patterns
    if (/[;&|`$(){}\\]/i.test(value) && /bash|sh|cmd|powershell|rm\s+-rf|rm\s+-fr|del\s+/i.test(value)) {
      return 'COMMAND_INJECTION_DETECTED';
    }

    // Prototype pollution
    if (/(__proto__|constructor\.prototype|prototype\.)/i.test(value)) {
      return 'PROTOTYPE_POLLUTION_DETECTED';
    }
  }

  return null;
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
