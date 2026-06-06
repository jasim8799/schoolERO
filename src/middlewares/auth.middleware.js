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

// authenticate optimized for minimal blocking I/O on the request path
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({
        success: false,
        message: 'Access denied. No token provided.'
      });
    }

    const token = authHeader.split(' ')[1];

    let decoded;
    try {
      decoded = jwt.verify(token, config.jwt.secret);
    } catch (_) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({
        success: false,
        message: 'Invalid or expired token'
      });
    }

    const userId = decoded.userId || decoded.id;
    if (!userId) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({
        success: false,
        message: 'Invalid token payload'
      });
    }

    const clientIp =
      req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
      req.ip ||
      req.connection?.remoteAddress ||
      '';
    const isPrivateIp =
      /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|::1$|::ffff:10\.|::ffff:192\.168\.)/.test(
        clientIp
      );

    const [tokenBl, userBl, ipBl] = await Promise.all([
      Promise.race([
        decoded.jti ? redis.get(`blacklist:token:${decoded.jti}`) : Promise.resolve(null),
        new Promise((resolve) => setTimeout(() => resolve(null), 300))
      ]).catch(() => null),
      Promise.race([
        redis.get(`blacklist:user:${userId}`),
        new Promise((resolve) => setTimeout(() => resolve(null), 300))
      ]).catch(() => null),
      isPrivateIp
        ? Promise.resolve(null)
        : Promise.race([
            redis.get(`blocked:ip:${clientIp}`),
            new Promise((resolve) => setTimeout(() => resolve(null), 300))
          ]).catch(() => null)
    ]);

    // Admin IP bans apply to external IPs only; JWT-authenticated users are never IP-blocked here
    if (ipBl && !isPrivateIp) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({
        success: false,
        message: 'Access blocked. Try again later.'
      });
    }

    if (tokenBl) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({
        success: false,
        message: 'Session has been terminated. Please login again.'
      });
    }

    if (userBl) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({
        success: false,
        message: 'Account suspended. Contact your administrator.'
      });
    }

    const user = await User.findById(userId)
      .select('_id name role schoolId status isDeleted lockedUntil')
      .lean();

    if (!user) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({
        success: false,
        message: 'User not found'
      });
    }

    if (user.isDeleted || user.status !== 'active') {
      return res.status(HTTP_STATUS.FORBIDDEN).json({
        success: false,
        message: user.isDeleted
          ? 'Account deactivated. Contact your administrator.'
          : 'User account is inactive'
      });
    }

    if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
      const minutesLeft = Math.ceil((new Date(user.lockedUntil) - Date.now()) / 60000);
      return res.status(HTTP_STATUS.FORBIDDEN).json({
        success: false,
        message: `Account locked. Try again in ${minutesLeft} minute(s).`
      });
    }

    req.user = {
      _id: user._id,
      userId: user._id,
      name: user.name,
      role: user.role?.toUpperCase(),
      schoolId: user.schoolId ? user.schoolId.toString() : null,
      sessionId: decoded.sessionId || null,
      jti: decoded.jti || null
    };
    req.deviceHash = _getDeviceHash(req);

    if (req.user.role !== USER_ROLES.SUPER_ADMIN && req.user.schoolId) {
      School.findById(req.user.schoolId)
        .select('forceLogoutAt')
        .lean()
        .then((school) => {
          if (
            school?.forceLogoutAt &&
            decoded.iat * 1000 < new Date(school.forceLogoutAt).getTime()
          ) {
            console.warn('[authenticate] forceLogoutAt exceeded for user', req.user.userId);
          }
        })
        .catch(() => {});
    }

    _runBackgroundTasks(req.user, req, decoded);
    next();
  } catch (error) {
    console.error('[authenticate]', error.message);
    return res.status(HTTP_STATUS.UNAUTHORIZED).json({
      success: false,
      message: 'Authentication failed. Please login again.'
    });
  }
};

function _runBackgroundTasks(user, req, decoded) {
  const userId = user._id || user.userId;
  const schoolId = user.schoolId ? user.schoolId.toString() : null;

  if (decoded?.jti) {
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

  const activeKey = `user:lastActive:${userId}`;
  redis.get(activeKey).then((recent) => {
    if (!recent) {
      User.findByIdAndUpdate(userId, { lastLogin: new Date() }).catch(() => {});
      redis.setex(activeKey, 300, '1').catch(() => {});
    }
  }).catch(() => {});

  if (schoolId) {
    const dayKey = new Date().toISOString().split('T')[0];
    const reqKey = `apiRequests:${schoolId}:${dayKey}`;
    redis.incr(reqKey).catch(() => {});
    redis.expire(reqKey, 86400).catch(() => {});
  }
}

function _getDeviceHash(req) {
  const ua = req.headers['user-agent'] || '';
  const ip = req.ip || '';
  return crypto.createHash('sha256').update(`${ua}${ip}`).digest('hex').substring(0, 16);
}

async function postLoginActions(user, req, token) {
  const payload = jwt.decode(token) || {};
  const deviceHash = _getDeviceHash(req);
  const userAgent = req.headers['user-agent'] || '';

  const existingDevice = await LoginSession.findOne({ userId: user._id, deviceHash })
    .select('_id')
    .lean()
    .catch(() => null);
  const isNewDevice = !existingDevice;

  await LoginSession.create({
    userId: user._id,
    schoolId: user.schoolId,
    sessionToken: payload.jti,
    deviceHash,
    deviceName: userAgent.substring(0, 100),
    ipAddress: req.ip,
    userAgent,
    expiresAt: payload.exp
      ? new Date(payload.exp * 1000)
      : new Date(Date.now() + 7 * 86400000)
  }).catch(() => {});

  User.findByIdAndUpdate(user._id, {
    $set: {
      lastLogin: new Date(),
      lastKnownIp: req.ip || null,
      lastKnownDevice: userAgent.substring(0, 100) || 'Unknown',
      lastKnownLocation: 'N/A',
      lastFailedLogin: null,
      lockedUntil: null,
      failedLogins: 0
    },
    $inc: {
      successLogins: 1,
      totalLogins: 1,
      activeSessions: 1,
      sessionTokens: 1,
      liveDevices: isNewDevice ? 1 : 0
    }
  }).catch(() => {});

  SecurityLog.create({
    schoolId: user.schoolId,
    userId: user._id,
    eventType: isNewDevice ? 'DEVICE_NEW' : 'LOGIN_SUCCESS',
    severity: isNewDevice ? 'WARNING' : 'INFO',
    ipAddress: req.ip,
    userAgent,
    deviceHash,
    details: { role: user.role, newDevice: isNewDevice }
  }).catch(() => {});

  UserActivityLog.create({
    userId: user._id,
    schoolId: user.schoolId,
    action: 'LOGIN_SUCCESS',
    category: 'AUTH',
    ipAddress: req.ip,
    deviceHash,
    userAgent,
    riskLevel: isNewDevice ? 'MEDIUM' : 'LOW',
    metadata: { newDevice: isNewDevice }
  }).catch(() => {});

  redis.del(`bruteforce:${req.ip}`).catch(() => {});

  global.streamAuditEvent?.({
    action: 'LOGIN_SUCCESS',
    severity: 'INFO',
    description: `${user.name} logged in`,
    ipAddress: req.ip,
    createdAt: new Date()
  });
}

async function handleFailedLogin(req, schoolId, userId) {
  // NOTE: Global IP blocking has been REMOVED (replaced by account-level lockout).
  // IP tracking is for SOC intelligence ONLY, not for blocking regular users.
  
  const ipAddress = req.ip || req.connection?.remoteAddress;

  // Track failed attempts for SOC monitoring (24h window)
  const socIpKey = `soc:ip:failcount:${ipAddress}`;
  let ipAttemptCount = 1;

  try {
    ipAttemptCount = await redis.incr(socIpKey);
    if (ipAttemptCount === 1) {
      await redis.expire(socIpKey, 86400); // 24h TTL
    }
  } catch (_) {
    // Ignore Redis errors
  }

  // Log the failed attempt
  SecurityLog.create({
    schoolId,
    userId,
    eventType: 'LOGIN_FAILED',
    severity: 'WARNING',
    ipAddress,
    userAgent: req.headers['user-agent'],
    details: { attempts: ipAttemptCount, socOnly: true }
  }).catch(() => {});

  if (userId) {
    UserActivityLog.create({
      userId,
      schoolId,
      action: 'LOGIN_FAILED',
      category: 'AUTH',
      ipAddress,
      deviceHash: _getDeviceHash(req),
      userAgent: req.headers['user-agent'] || '',
      riskLevel: 'MEDIUM',
      metadata: { ipAttempts: ipAttemptCount, note: 'Account-level lockout via accountSecurity.service' }
    }).catch(() => {});
  }

  // IMPORTANT: No IP blocking here. Account-level lockout is handled by accountSecurity.service.js
  // IP ban (if needed) is admin-applied via direct redis.setex('blocked:ip:...', ...)
}


module.exports = {
  authenticate,
  _postLoginActions: postLoginActions,
  _handleFailedLogin: handleFailedLogin
};
