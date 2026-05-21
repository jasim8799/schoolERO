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

    let tokenBlacklisted = false;
    let userBlacklisted = false;
    let ipBlocked = false;

    try {
      const [tokenBl, userBl, ipBl] = await Promise.all([
        decoded.jti ? redis.get(`blacklist:token:${decoded.jti}`) : Promise.resolve(null),
        redis.get(`blacklist:user:${userId}`),
        redis.get(`blocked:ip:${req.ip}`)
      ]);
      tokenBlacklisted = !!tokenBl;
      userBlacklisted = !!userBl;
      ipBlocked = !!ipBl;
    } catch (_) {
      // Fail open if Redis is slow/unavailable so auth doesn't stall.
    }

    if (ipBlocked) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({
        success: false,
        message: 'Access blocked due to suspicious activity. Try again later.'
      });
    }

    if (tokenBlacklisted) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({
        success: false,
        message: 'Session has been terminated. Please login again.'
      });
    }

    if (userBlacklisted) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({
        success: false,
        message: 'Account suspended. Please contact your administrator.'
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

    if (user.isDeleted) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({
        success: false,
        message: 'Account has been deactivated. Contact your administrator.'
      });
    }

    if (user.status !== 'active') {
      return res.status(HTTP_STATUS.FORBIDDEN).json({
        success: false,
        message: 'User account is inactive'
      });
    }

    if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
      const minutesLeft = Math.ceil((new Date(user.lockedUntil) - Date.now()) / 60000);
      return res.status(HTTP_STATUS.FORBIDDEN).json({
        success: false,
        message: `Account temporarily locked. Try again in ${minutesLeft} minute(s).`
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
      _checkSchoolForceLogout(req, decoded, res, next);
      return;
    }

    _runBackgroundTasks(req.user, req, decoded).catch(() => {});
    next();
  } catch (error) {
    console.error('[authenticate]', error.message);
    return res.status(HTTP_STATUS.UNAUTHORIZED).json({
      success: false,
      message: 'Authentication failed. Please login again.'
    });
  }
};

async function _checkSchoolForceLogout(req, decoded, res, next) {
  try {
    const school = await School.findById(req.user.schoolId)
      .select('forceLogoutAt')
      .lean();

    if (
      school?.forceLogoutAt &&
      decoded.iat * 1000 < new Date(school.forceLogoutAt).getTime()
    ) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({
        success: false,
        message: 'You have been logged out by the school administrator'
      });
    }
  } catch (_) {
    // Do not block request on school lookup failure.
  }

  _runBackgroundTasks(req.user, req, decoded).catch(() => {});
  next();
}

async function _runBackgroundTasks(user, req, decoded) {
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
  const bruteKey = `bruteforce:${req.ip}`;
  let attempts = 1;

  try {
    attempts = await redis.incr(bruteKey);
    await redis.expire(bruteKey, 900);
  } catch (_) {
    // Keep default attempts.
  }

  SecurityLog.create({
    schoolId,
    userId,
    eventType: 'LOGIN_FAILED',
    severity: attempts >= 5 ? 'CRITICAL' : 'WARNING',
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
    details: { attempts }
  }).catch(() => {});

  if (userId) {
    const update = {
      $inc: { failedLogins: 1 },
      $set: { lastFailedLogin: new Date() }
    };

    if (attempts >= 5) {
      update.$set.lockedUntil = new Date(Date.now() + 15 * 60000);
    }

    User.findByIdAndUpdate(userId, update).catch(() => {});

    UserActivityLog.create({
      userId,
      schoolId,
      action: 'LOGIN_FAILED',
      category: 'AUTH',
      ipAddress: req.ip,
      deviceHash: _getDeviceHash(req),
      userAgent: req.headers['user-agent'] || '',
      riskLevel: attempts >= 5 ? 'HIGH' : 'MEDIUM',
      metadata: { attempts }
    }).catch(() => {});
  }

  if (attempts >= 10) {
    redis.setex(`blocked:ip:${req.ip}`, 3600, '1').catch(() => {});
    SecurityLog.create({
      schoolId,
      userId,
      eventType: 'BRUTE_FORCE_DETECTED',
      severity: 'CRITICAL',
      ipAddress: req.ip,
      details: { blockedFor: '1h', attempts }
    }).catch(() => {});
  }
}

module.exports = {
  authenticate,
  _postLoginActions: postLoginActions,
  _handleFailedLogin: handleFailedLogin
};
