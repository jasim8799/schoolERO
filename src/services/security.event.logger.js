// services/security.event.logger.js
// Comprehensive security event logging for SOC
// Handles: AuditLog, SecurityLog, ActivityEvent, ThreatEvent, IncidentEvent

const mongoose = require('mongoose');
const AuditLog = require('../models/AuditLog');
const SecurityLog = require('../models/SecurityLog');
const ActivityEvent = require('../models/ActivityEvent');
const { recordSecurityEvent } = require('./security.metrics');
const { createIncident, createIncidentFeedItem } = require('./incident.manager');
const { logger } = require('../utils/logger');
const crypto = require('crypto');

// ──────────────────────────────────────────────────────────────────────────
// Helper Functions
// ──────────────────────────────────────────────────────────────────────────

/**
 * Calculate distance between two geographic points using Haversine formula
 * @param {number} lat1 - Latitude of point 1
 * @param {number} lon1 - Longitude of point 1
 * @param {number} lat2 - Latitude of point 2
 * @param {number} lon2 - Longitude of point 2
 * @returns {number} Distance in kilometers
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// ──────────────────────────────────────────────────────────────────────────
// LOGIN_FAILED Event Pipeline
// ──────────────────────────────────────────────────────────────────────────

/**
 * Comprehensive logging for LOGIN_FAILED events
 * Creates: AuditLog, SecurityLog, ActivityEvent, and potential threat indicators
 */
async function logLoginFailed({
  userId,
  email,
  mobile,
  ipAddress,
  userAgent,
  schoolId,
  reason = 'INVALID_CREDENTIALS',
  severity = 'HIGH',
  riskScore = 0.6,
  req,
  lockoutTriggered = false,
  lockoutLevel = 0,
} = {}) {
  try {
    const now = new Date();
    const eventId = crypto.randomBytes(8).toString('hex');
    const correlationId = crypto.randomBytes(12).toString('hex');
    const deviceHash = _hashDevice(userAgent, ipAddress);
    
    // Parse geo and device info
    const geoInfo = _parseGeoFromIp(ipAddress);
    const deviceInfo = _parseUserAgent(userAgent);

    // ── 1. AuditLog Entry ────────────────────────────────────────────────
    const auditLog = await AuditLog.create({
      userId: userId ? mongoose.Types.ObjectId(userId) : null,
      role: 'SYSTEM', // Failed login often indicates unknown user
      action: 'LOGIN_FAILED',
      entityType: 'LOGIN_ATTEMPT',
      entityId: eventId,
      ipAddress,
      userAgent,
      details: {
        email,
        mobile,
        reason,
        lockoutTriggered,
        lockoutLevel,
        deviceHash,
        attemptNumber: 1, // Will be incremented in accountSecurity service
      },
      severity,
      description: `Failed login attempt - ${reason}${lockoutTriggered ? ' (Account locked)' : ''}`,
      createdAt: now,
    }).catch(err => {
      logger.error('AuditLog creation failed:', err.message);
      return null;
    });

    // ── 2. SecurityLog Entry ─────────────────────────────────────────────
    const securityLog = await SecurityLog.create({
      schoolId: schoolId ? mongoose.Types.ObjectId(schoolId) : null,
      userId: userId ? mongoose.Types.ObjectId(userId) : null,
      eventType: 'LOGIN_FAILED',
      severity: _mapSeverity(severity),
      ipAddress,
      userAgent,
      deviceHash,
      geoCountry: geoInfo.country,
      geoCity: geoInfo.city,
      geoLat: geoInfo.latitude,
      geoLon: geoInfo.longitude,
      isVPN: geoInfo.vpn,
      details: {
        email,
        mobile,
        reason,
        lockoutTriggered,
        lockoutLevel,
        browser: deviceInfo.browser,
        os: deviceInfo.os,
        deviceType: deviceInfo.deviceType,
        riskScore,
      },
      resolved: false,
      createdAt: now,
    }).catch(err => {
      logger.error('SecurityLog creation failed:', err.message);
      return null;
    });

    // ── 3. ActivityEvent Entry ───────────────────────────────────────────
    const activityEvent = await ActivityEvent.create({
      eventId,
      correlationId,
      event: `Failed Login - ${reason}`,
      type: 'auth',
      source: 'auth.controller',
      icon: 'lock_person',
      severity: _mapActivityEventSeverity(severity),
      status: lockoutTriggered ? 'BLOCKED' : 'MONITORING',
      aiScore: riskScore,
      threat: riskScore > 0.5 ? riskScore : 0,
      aiAnalysis: _generateAiAnalysis(reason, lockoutTriggered, riskScore),
      aiConfidence: 0.85,
      ipAddress,
      geoCountry: geoInfo.country,
      geoCity: geoInfo.city,
      asnInfo: geoInfo.asn,
      vpnDetected: geoInfo.vpn,
      response: lockoutTriggered ? 'ACCOUNT_LOCKED' : 'MONITORING',
      responseType: lockoutTriggered ? 'AUTOMATED' : 'NONE',
      schoolId: schoolId ? mongoose.Types.ObjectId(schoolId) : null,
      userId: userId ? mongoose.Types.ObjectId(userId) : null,
      sourceLogId: auditLog ? auditLog._id : null,
      isIncident: severity === 'CRITICAL' || lockoutTriggered,
      escalationLevel: lockoutTriggered ? 1 : 0,
      entityType: 'LOGIN_ATTEMPT',
      action: 'LOGIN_FAILED',
      description: `Failed login - ${reason}${lockoutTriggered ? ' - Account locked' : ''}`,
      metadata: {
        email,
        mobile,
        lockoutLevel,
        deviceHash,
        browser: deviceInfo.browser,
        os: deviceInfo.os,
      },
      createdAt: now,
    }).catch(err => {
      logger.error('ActivityEvent creation failed:', err.message);
      return null;
    });

    // ── 4. Redis Metrics Update ──────────────────────────────────────────
    await recordSecurityEvent('LOGIN_FAILED', {
      ipAddress,
      severity,
      schoolId,
      email,
      lockoutTriggered,
      riskScore,
    }).catch(err => {
      logger.error('Redis metric update failed:', err.message);
    });

    // ── 5. Detect brute force and create threat indicators ───────────────
    if (lockoutTriggered || lockoutLevel >= 2) {
      const threatLevel = lockoutLevel >= 3 ? 'CRITICAL' : lockoutLevel >= 2 ? 'HIGH' : 'MEDIUM';
      await _createBruteForceIndicator({
        ipAddress,
        email,
        schoolId,
        severity: threatLevel,
        lockoutLevel,
        lockoutTriggered,
        activityEventId: activityEvent?._id,
        correlationId,
      }).catch(err => {
        logger.error('Brute force indicator creation failed:', err.message);
      });
      // Create incident for brute force
      await createIncident({
        incidentType: 'BRUTE_FORCE',
        title: `Brute Force Attack Detected - ${email || 'Unknown User'}`,
        description: `Multiple failed login attempts detected from IP ${ipAddress}. Lockout level: ${lockoutLevel}`,
        severity: threatLevel,
        riskScore: Math.min(lockoutLevel / 4, 1),
        aiConfidence: 0.92,
        schoolId,
        userId: userId ? mongoose.Types.ObjectId(userId) : null,
        ipAddress,
        country: geoInfo.country,
        city: geoInfo.city,
        latitude: geoInfo.latitude,
        longitude: geoInfo.longitude,
        targetSystem: 'Authentication',
        threatCategories: ['Account Takeover', 'Credential Access'],
        mitreTactics: ['credential-access', 'execution'],
        detectionMethod: 'RULE_MATCH',
        correlationId,
      }).catch(err => {
        logger.error('Incident creation for brute force failed:', err.message);
      });    }

    // ── 6. Detect geo anomaly if new location ────────────────────────────
    if (userId && !geoInfo.isPrivate) {
      await _checkGeoAnomaly({
        userId,
        schoolId,
        ipAddress,
        country: geoInfo.country,
        city: geoInfo.city,
        latitude: geoInfo.latitude,
        longitude: geoInfo.longitude,
        activityEventId: activityEvent?._id,
        correlationId,
      }).catch(err => {
        logger.error('Geo anomaly check failed:', err.message);
      });
    }

    logger.info(`[SECURITY] LOGIN_FAILED logged: eventId=${eventId}, email=${email}, severity=${severity}`);

    return {
      eventId,
      correlationId,
      auditLogId: auditLog?._id,
      securityLogId: securityLog?._id,
      activityEventId: activityEvent?._id,
    };
  } catch (err) {
    logger.error('Security event logging failed:', err.message);
    return null;
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Brute Force Detection & Incident Creation
// ──────────────────────────────────────────────────────────────────────────

async function _createBruteForceIndicator({
  ipAddress,
  email,
  schoolId,
  severity,
  lockoutLevel,
  lockoutTriggered,
  activityEventId,
  correlationId,
}) {
  try {
    // Check if this IP already has brute force indicators in Redis
    const redis = require('../config/redis');
    const bruteForceKey = `security:bruteforce:${ipAddress}`;
    const attempts = await redis.incr(bruteForceKey).catch(() => 0);
    
    // Set 24-hour expiry
    if (attempts === 1) {
      await redis.expire(bruteForceKey, 86400).catch(() => {});
    }

    // Create or update threat activity
    const threatData = {
      ipAddress,
      email,
      attempts,
      severity,
      lockoutLevel,
      activityEventId,
      correlationId,
      timestamp: new Date(),
    };

    await recordSecurityEvent('BRUTE_FORCE_DETECTED', {
      ipAddress,
      severity,
      schoolId,
      riskScore: Math.min(attempts / 50, 1), // Normalize to 0-1
      lockoutLevel,
    }).catch(() => {});

    logger.warn(`[SECURITY] Brute force detected: IP=${ipAddress}, attempts=${attempts}, severity=${severity}`);

    return threatData;
  } catch (err) {
    logger.error('Brute force indicator creation error:', err.message);
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Geo Anomaly Detection
// ──────────────────────────────────────────────────────────────────────────

async function _checkGeoAnomaly({
  userId,
  schoolId,
  ipAddress,
  country,
  city,
  latitude,
  longitude,
  activityEventId,
  correlationId,
}) {
  try {
    const SecurityLog = require('../models/SecurityLog');
    const redis = require('../config/redis');

    // Get user's last login locations (last 7 days)
    const lastLogins = await SecurityLog.find({
      userId: mongoose.Types.ObjectId(userId),
      eventType: 'LOGIN_SUCCESS',
      createdAt: { $gte: new Date(Date.now() - 7 * 86400000) },
    })
      .select('geoCountry geoCity geoLat geoLon createdAt')
      .limit(10)
      .sort({ createdAt: -1 });

    if (lastLogins.length === 0) {
      // First login or no recent logins - log as baseline
      return;
    }

    // Check for impossible travel or suspicious pattern
    const lastLocation = lastLogins[0];
    const timeDiffHours = (Date.now() - lastLocation.createdAt) / 3600000;
    
    // Calculate distance between locations
    const distance = lastLocation.geoLat && lastLocation.geoLon
      ? calculateDistance(lastLocation.geoLat, lastLocation.geoLon, latitude, longitude)
      : 0;

    // Speed of travel = distance / time
    const maxSpeed = 900; // km/hour (typical flight speed)
    const requiredHours = distance / maxSpeed;
    const isImpossibleTravel = timeDiffHours < requiredHours && distance > 50;

    // New country = anomaly
    const isNewCountry = country !== lastLocation.geoCountry;

    if (isImpossibleTravel || isNewCountry) {
      const anomalyKey = `security:geo:${userId}:${country}`;
      const count = await redis.incr(anomalyKey).catch(() => 1);
      if (count === 1) {
        await redis.expire(anomalyKey, 86400).catch(() => {});
      }

      await recordSecurityEvent('GEO_ANOMALY', {
        ipAddress,
        severity: isImpossibleTravel ? 'CRITICAL' : 'HIGH',
        schoolId,
        userId,
        details: {
          isImpossibleTravel,
          isNewCountry,
          distance,
          timeDiffHours,
          previousCountry: lastLocation.geoCountry,
        },
      }).catch(() => {});

      logger.warn(`[SECURITY] Geo anomaly: userId=${userId}, country=${country}, impossible=${isImpossibleTravel}`);
    }
  } catch (err) {
    logger.error('Geo anomaly check error:', err.message);
  }
}

// ──────────────────────────────────────────────────────────────────────────
// LOGIN_SUCCESS Event Pipeline
// ──────────────────────────────────────────────────────────────────────────

async function logLoginSuccess({
  userId,
  userRole,
  ipAddress,
  userAgent,
  schoolId,
  req,
} = {}) {
  try {
    const now = new Date();
    const eventId = crypto.randomBytes(8).toString('hex');
    const deviceHash = _hashDevice(userAgent, ipAddress);
    const geoInfo = _parseGeoFromIp(ipAddress);
    const deviceInfo = _parseUserAgent(userAgent);

    // SecurityLog entry
    await SecurityLog.create({
      schoolId: schoolId ? mongoose.Types.ObjectId(schoolId) : null,
      userId: userId ? mongoose.Types.ObjectId(userId) : null,
      eventType: 'LOGIN_SUCCESS',
      severity: 'INFO',
      ipAddress,
      userAgent,
      deviceHash,
      geoCountry: geoInfo.country,
      geoCity: geoInfo.city,
      geoLat: geoInfo.latitude,
      geoLon: geoInfo.longitude,
      isVPN: geoInfo.vpn,
      details: {
        browser: deviceInfo.browser,
        os: deviceInfo.os,
        deviceType: deviceInfo.deviceType,
      },
      createdAt: now,
    }).catch(err => logger.error('LoginSuccess SecurityLog failed:', err.message));

    // ActivityEvent entry
    await ActivityEvent.create({
      eventId,
      event: 'Login Success',
      type: 'auth',
      source: 'auth.controller',
      icon: 'verified_user',
      severity: 'INFO',
      status: 'RESOLVED',
      aiScore: 0.1,
      ipAddress,
      geoCountry: geoInfo.country,
      geoCity: geoInfo.city,
      schoolId: schoolId ? mongoose.Types.ObjectId(schoolId) : null,
      userId: userId ? mongoose.Types.ObjectId(userId) : null,
      description: `${userRole} login successful`,
      createdAt: now,
    }).catch(err => logger.error('LoginSuccess ActivityEvent failed:', err.message));

  } catch (err) {
    logger.error('Login success logging failed:', err.message);
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Helper Functions
// ──────────────────────────────────────────────────────────────────────────

function _hashDevice(userAgent, ipAddress) {
  const data = `${userAgent}:${ipAddress}`;
  return crypto.createHash('sha256').update(data).digest('hex');
}

function _parseGeoFromIp(ipAddress) {
  // IP-based geo lookup (placeholder - in production use MaxMind GeoIP2)
  if (!ipAddress || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.)/.test(ipAddress)) {
    return {
      country: 'Private Network',
      city: 'Internal VPC',
      latitude: 0,
      longitude: 0,
      asn: 'PRIVATE',
      vpn: false,
      isPrivate: true,
    };
  }

  // Simulate geolocation based on IP octet
  const octets = ipAddress.split('.').map(Number);
  const countries = [
    { country: 'United States', city: 'New York', lat: 40.7128, lon: -74.0060 },
    { country: 'India', city: 'Mumbai', lat: 19.0760, lon: 72.8777 },
    { country: 'United Kingdom', city: 'London', lat: 51.5074, lon: -0.1278 },
    { country: 'Germany', city: 'Berlin', lat: 52.5200, lon: 13.4050 },
    { country: 'Australia', city: 'Sydney', lat: -33.8688, lon: 151.2093 },
    { country: 'China', city: 'Shanghai', lat: 31.2304, lon: 121.4737 },
    { country: 'Canada', city: 'Toronto', lat: 43.6532, lon: -79.3832 },
    { country: 'Japan', city: 'Tokyo', lat: 35.6762, lon: 139.6503 },
  ];
  const idx = ((octets[0] || 0) + (octets[1] || 0)) % countries.length;
  const loc = countries[idx];

  return {
    country: loc.country,
    city: loc.city,
    latitude: loc.lat,
    longitude: loc.lon,
    asn: `AS${Math.floor(Math.random() * 65000)}`,
    vpn: Math.random() > 0.92, // 8% chance
    isPrivate: false,
  };
}

function _parseUserAgent(ua) {
  if (!ua) return { browser: 'Unknown', os: 'Unknown', deviceType: 'Unknown' };
  const browser = /Chrome/.test(ua) ? 'Chrome'
                : /Firefox/.test(ua) ? 'Firefox'
                : /Safari/.test(ua) ? 'Safari'
                : /Edge/.test(ua) ? 'Edge'
                : 'Other';
  const os = /Windows/.test(ua) ? 'Windows'
           : /Mac OS/.test(ua) ? 'macOS'
           : /Linux/.test(ua) ? 'Linux'
           : /Android/.test(ua) ? 'Android'
           : /iPhone|iPad/.test(ua) ? 'iOS'
           : 'Other';
  const deviceType = /Mobile|Android/.test(ua) ? 'Mobile'
                   : /Tablet|iPad/.test(ua) ? 'Tablet'
                   : 'Desktop';
  return { browser, os, deviceType };
}

function _mapSeverity(severity) {
  return {
    'LOW': 'WARNING',
    'MEDIUM': 'WARNING',
    'HIGH': 'ERROR',
    'CRITICAL': 'CRITICAL',
  }[severity] || 'WARNING';
}

function _mapActivityEventSeverity(severity) {
  return severity; // Already in correct format
}

function _generateAiAnalysis(reason, lockoutTriggered, riskScore) {
  let analysis = '';
  
  if (reason === 'INVALID_CREDENTIALS') {
    analysis = 'Invalid credentials provided. ';
  } else if (reason === 'ACCOUNT_INACTIVE') {
    analysis = 'User account is currently inactive. ';
  } else if (reason === 'USER_NOT_FOUND') {
    analysis = 'User account does not exist. ';
  }

  if (lockoutTriggered) {
    analysis += 'Account has been locked due to excessive failed attempts. ';
  }

  if (riskScore > 0.7) {
    analysis += 'High risk pattern detected: multiple failed attempts from same IP. Recommend user verification.';
  } else if (riskScore > 0.5) {
    analysis += 'Medium risk detected. Monitor for escalation.';
  } else {
    analysis += 'Standard failed login attempt.';
  }

  return analysis;
}

// ──────────────────────────────────────────────────────────────────────────
// Exports
// ──────────────────────────────────────────────────────────────────────────

module.exports = {
  logLoginFailed,
  logLoginSuccess,
};
