const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { HTTP_STATUS, USER_ROLES } = require('../config/constants');
const User = require('../models/User');
const School = require('../models/School');
const LoginSession = require('../models/LoginSession');
const SecurityLog = require('../models/SecurityLog');
const UserActivityLog = require('../models/UserActivityLog');
const redis = require('../config/redis');
const { config } = require('../config/env');

// Verify JWT token and attach user to request
const authenticate = async (req, res, next) => {
  try {
    // Get token from header
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({
        success: false,
        message: 'Access denied. No token provided.'
      });
    }

    const token = authHeader.split(' ')[1];

    // Blocked IP check (brute-force protection)
    const blocked = await redis.get(`blocked:ip:${req.ip}`);
    if (blocked) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({
        success: false,
        message: 'Access blocked due to suspicious activity'
      });
    }

    // Verify token
    const decoded = jwt.verify(token, config.jwt.secret);

    // Token blacklist check
    if (decoded.jti) {
      const blacklistedToken = await redis.get(`blacklist:token:${decoded.jti}`);
      if (blacklistedToken) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          success: false,
          message: 'Session has been terminated'
        });
      }
    }

    // Check if user exists and is active
    const userId = decoded.userId || decoded.id;

    const userBlacklisted = await redis.get(`blacklist:user:${userId}`);
    if (userBlacklisted) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({
        success: false,
        message: 'Session revoked. Please login again.'
      });
    }

    const user = await User.findById(userId).select('-password');
    if (!user) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({
        success: false,
        message: 'User not found'
      });
    }

    if (user.status !== 'active') {
      return res.status(HTTP_STATUS.FORBIDDEN).json({
        success: false,
        message: 'User account is inactive'
      });
    }

    // Attach user info to request
    req.user = {
      _id: user._id,
      userId: user._id,
      name: user.name,
      role: user.role?.toUpperCase(),
      schoolId: user.schoolId ? user.schoolId.toString() : null,
      sessionId: decoded.sessionId || null,
      jti: decoded.jti || null
    };

    // Check for force logout (skip for SUPER_ADMIN and users without schoolId)
    if (req.user.role !== USER_ROLES.SUPER_ADMIN && req.user.schoolId) {
      const school = await School.findById(req.user.schoolId);
      if (
        school &&
        school.forceLogoutAt &&
        decoded.iat * 1000 < new Date(school.forceLogoutAt).getTime()
      ) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          success: false,
          message: 'You have been logged out by the school administrator'
        });
      }
    }

    const deviceHash = getDeviceHash(req);
    req.deviceHash = deviceHash;

    // Session heartbeat update (non-blocking)
    if (decoded.jti) {
      LoginSession.findOneAndUpdate(
        { sessionToken: decoded.jti, isActive: true },
        {
          $set: {
            lastActiveAt: new Date(),
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'] || ''
          }
        }
      ).catch(() => {});
    }

    // Throttle user last-login writes via Redis (5 minute window)
    const activeKey = `user:lastActive:${user._id}`;
    const recentlyUpdated = await redis.get(activeKey);
    if (!recentlyUpdated) {
      User.findByIdAndUpdate(user._id, { lastLogin: new Date() }).catch(() => {});
      await redis.setex(activeKey, 300, '1');
    }

    // Track per-school API request counters for dashboard analytics
    if (req.user.schoolId) {
      const dayKey = new Date().toISOString().split('T')[0];
      const reqKey = `apiRequests:${req.user.schoolId}:${dayKey}`;
      redis.incr(reqKey).catch(() => {});
      redis.expire(reqKey, 86400).catch(() => {});
    }

    next();
  } catch (error) {
    return res.status(HTTP_STATUS.UNAUTHORIZED).json({
      success: false,
      message: 'Invalid or expired token'
      // Remove error details in production for security
    });
  }
};

function getDeviceHash(req) {
  const ua = req.headers['user-agent'] || '';
  const ip = req.ip || '';
  return crypto.createHash('sha256').update(`${ua}${ip}`).digest('hex').substring(0, 16);
}

async function postLoginActions(user, req, token) {
  const payload = jwt.decode(token) || {};
  const deviceHash = getDeviceHash(req);
  const userAgent = req.headers['user-agent'] || '';

  const existingDevice = await LoginSession.findOne({ userId: user._id, deviceHash }).lean();
  const isNewDevice = !existingDevice;

  await LoginSession.create({
    userId: user._id,
    schoolId: user.schoolId,
    sessionToken: payload.jti,
    deviceHash,
    deviceName: userAgent.substring(0, 100),
    ipAddress: req.ip,
    userAgent,
    expiresAt: payload.exp ? new Date(payload.exp * 1000) : new Date(Date.now() + 7 * 86400000)
  });

  await User.findByIdAndUpdate(user._id, {
    $set: {
      lastLogin: new Date(),
      lastKnownIp: req.ip || null,
      lastKnownDevice: userAgent.substring(0, 100) || 'Unknown',
      lastKnownLocation: 'N/A',
      lastFailedLogin: null,
      lockedUntil: null,
    },
    $inc: {
      successLogins: 1,
      totalLogins: 1,
      activeSessions: 1,
      sessionTokens: 1,
      liveDevices: isNewDevice ? 1 : 0,
    },
    $push: {
      loginHistory: {
        ipAddress: req.ip,
        userAgent,
        deviceHash,
        loginAt: new Date(),
        status: 'SUCCESS',
      },
      deviceTracking: {
        deviceHash,
        userAgent,
        ipAddress: req.ip,
        lastSeen: new Date(),
      },
    },
  }).catch(() => {});

  await SecurityLog.create({
    schoolId: user.schoolId,
    userId: user._id,
    eventType: isNewDevice ? 'DEVICE_NEW' : 'LOGIN_SUCCESS',
    severity: isNewDevice ? 'WARNING' : 'INFO',
    ipAddress: req.ip,
    userAgent,
    deviceHash,
    details: { role: user.role, newDevice: isNewDevice }
  });

  await UserActivityLog.create({
    userId: user._id,
    schoolId: user.schoolId,
    action: 'LOGIN_SUCCESS',
    category: 'AUTH',
    ipAddress: req.ip,
    deviceHash,
    userAgent,
    riskLevel: isNewDevice ? 'MEDIUM' : 'LOW',
    metadata: { newDevice: isNewDevice },
  }).catch(() => {});

  await redis.del(`bruteforce:${req.ip}`);
}

async function handleFailedLogin(req, schoolId, userId) {
  const bruteKey = `bruteforce:${req.ip}`;
  const attempts = await redis.incr(bruteKey);
  await redis.expire(bruteKey, 900);

  await SecurityLog.create({
    schoolId,
    userId,
    eventType: 'LOGIN_FAILED',
    severity: attempts >= 5 ? 'CRITICAL' : 'WARNING',
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
    details: { attempts }
  });

  if (userId) {
    const update = {
      $inc: { failedLogins: 1 },
      $set: { lastFailedLogin: new Date() },
      $push: {
        loginHistory: {
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'] || '',
          deviceHash: getDeviceHash(req),
          loginAt: new Date(),
          status: 'FAILED',
        },
      },
    };

    if (attempts >= 5) {
      update.$set.lockedUntil = new Date(Date.now() + 15 * 60000);
    }

    await User.findByIdAndUpdate(userId, update).catch(() => {});

    await UserActivityLog.create({
      userId,
      schoolId,
      action: 'LOGIN_FAILED',
      category: 'AUTH',
      ipAddress: req.ip,
      deviceHash: getDeviceHash(req),
      userAgent: req.headers['user-agent'] || '',
      riskLevel: attempts >= 5 ? 'HIGH' : 'MEDIUM',
      metadata: { attempts },
    }).catch(() => {});
  }

  if (attempts >= 10) {
    await redis.setex(`blocked:ip:${req.ip}`, 3600, '1');
    await SecurityLog.create({
      schoolId,
      userId,
      eventType: 'BRUTE_FORCE_DETECTED',
      severity: 'CRITICAL',
      ipAddress: req.ip,
      details: { blockedFor: '1h', attempts }
    });
  }
}

module.exports = {
  authenticate,
  _postLoginActions: postLoginActions,
  _handleFailedLogin: handleFailedLogin
};
