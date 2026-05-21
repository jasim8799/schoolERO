const SecurityLog = require('../models/SecurityLog');
const redis = require('../config/redis');

async function logSecurityEvent(payload = {}) {
  const doc = await SecurityLog.create({
    eventType: payload.eventType || 'LOGIN_FAILED',
    severity: payload.severity || 'INFO',
    schoolId: payload.schoolId || null,
    userId: payload.userId || null,
    ipAddress: payload.ipAddress || null,
    userAgent: payload.userAgent || null,
    deviceHash: payload.deviceHash || null,
    details: payload.details || {}
  });

  if (doc.severity === 'CRITICAL') {
    global.broadcastSecurityAlert && global.broadcastSecurityAlert({
      id: doc._id,
      eventType: doc.eventType,
      severity: doc.severity,
      ipAddress: doc.ipAddress,
      createdAt: doc.createdAt,
      details: doc.details
    });
  }

  return doc;
}

async function setBlockedIp(ipAddress, ttlSeconds = 3600) {
  if (!ipAddress) return;
  await redis.setex(`blocked:ip:${ipAddress}`, ttlSeconds, '1');
}

async function clearBlockedIp(ipAddress) {
  if (!ipAddress) return;
  await redis.del(`blocked:ip:${ipAddress}`);
}

module.exports = {
  logSecurityEvent,
  setBlockedIp,
  clearBlockedIp
};
