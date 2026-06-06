const User = require('../models/User.js');
const Student = require('../models/Student.js');
const AcademicSession = require('../models/AcademicSession.js');
const { hashPassword, comparePassword } = require('../utils/password.js');
const { generateToken } = require('../utils/jwt.js');
const { _postLoginActions, _handleFailedLogin } = require('../middlewares/auth.middleware');
const { HTTP_STATUS, USER_ROLES } = require('../config/constants.js');
const { logger } = require('../utils/logger.js');
const { auditLog } = require('../utils/auditLog');
const { recordSecurityEvent } = require('../services/security.metrics');
const accountSecurity = require('../services/accountSecurity.service');

// Register User
const register = async (req, res) => {
  try {
    const { name, email, mobile, password, role, schoolId } = req.body;

    // Validate required fields
    if (!name || !password || !role) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Name, password, and role are required'
      });
    }

    // Validate email or mobile
    if (!email && !mobile) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Either email or mobile is required'
      });
    }

    // Validate schoolId for non-SUPER_ADMIN roles
    if (role !== USER_ROLES.SUPER_ADMIN && !schoolId) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'School ID is required for this role'
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({
      $or: [
        ...(email ? [{ email }] : []),
        ...(mobile ? [{ mobile }] : [])
      ]
    });

    if (existingUser) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'User with this email or mobile already exists'
      });
    }

    // Hash password
    const hashedPassword = await hashPassword(password);

    // Create user
    const user = await User.create({
      name,
      email,
      mobile,
      password: hashedPassword,
      role,
      schoolId: role === USER_ROLES.SUPER_ADMIN ? null : schoolId
    });

    logger.success(`User registered: ${user.name} (${user.role})`);

    // Remove password from response
    const userResponse = user.toObject();
    delete userResponse.password;

    res.status(HTTP_STATUS.CREATED).json({
      success: true,
      message: 'User registered successfully',
      data: userResponse
    });
  } catch (error) {
    logger.error('Register error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error registering user',
      error: error.message
    });
  }
};

// Login User — Account-level security (no global IP blocks)
const login = async (req, res) => {
  try {
    let { email, mobile, password } = req.body;
    if (email) email = email.toLowerCase().trim();
    if (mobile) mobile = mobile.trim();

    if ((!email && !mobile) || !password) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'Email/mobile and password are required',
      });
    }

    // ── Check IP ban (extreme cases only — admin-applied) ────────────────
    const clientIp =
      req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
      req.ip ||
      req.connection?.remoteAddress;
    const ipBanned = await accountSecurity.isIpBanned(clientIp);
    if (ipBanned) {
      accountSecurity.logAttempt({
        userId: null, email, mobile, role: null, schoolId: null,
        result: 'ACCOUNT_LOCKED', req,
        lockoutTriggered: false, lockoutLevel: 4,
      }).catch(() => {});
      return res.status(HTTP_STATUS.TOO_MANY_REQUESTS).json({
        success: false,
        message: 'Access temporarily restricted. Please contact support.',
      });
    }

    // ── Find user ────────────────────────────────────────────────────────
    const user = await User.findOne({
      $or: [
        ...(email  ? [{ email }]  : []),
        ...(mobile ? [{ mobile }] : []),
      ]
    }).select('+password').populate('schoolId', 'name code status');

    // ── User not found ───────────────────────────────────────────────────
    if (!user) {
      recordSecurityEvent('LOGIN_FAILED', {
        ipAddress: clientIp,
        severity: 'MEDIUM',
      }).catch(() => {});
      accountSecurity.logAttempt({
        userId: null, email, mobile, role: null, schoolId: null,
        result: 'USER_NOT_FOUND', req,
      }).catch(() => {});
      global.io?.emit('security:failed_login', { ipAddress: clientIp, at: new Date() });

      return res.status(HTTP_STATUS.UNAUTHORIZED).json({
        success: false,
        message: 'Invalid credentials',
      });
    }

    // ── Account inactive ─────────────────────────────────────────────────
    if (user.status !== 'active') {
      accountSecurity.logAttempt({
        userId: user._id, email: user.email, mobile: user.mobile,
        role: user.role, schoolId: user.schoolId?._id || user.schoolId,
        result: 'ACCOUNT_INACTIVE', req,
      }).catch(() => {});
      return res.status(HTTP_STATUS.FORBIDDEN).json({
        success: false,
        message: 'User account is inactive. Please contact your administrator.',
      });
    }

    // ── School inactive (non-Super Admin only) ───────────────────────────
    if (user.role !== USER_ROLES.SUPER_ADMIN &&
        user.schoolId && user.schoolId.status !== 'active') {
      return res.status(HTTP_STATUS.FORBIDDEN).json({
        success: false,
        message: 'School is currently inactive. Please contact system administrator.',
      });
    }

    // ── Check account lock (PER ACCOUNT — not global IP) ────────────────
    const lockStatus = await accountSecurity.isAccountLocked(user);
    if (lockStatus.locked) {
      accountSecurity.logAttempt({
        userId: user._id, email: user.email, mobile: user.mobile,
        role: user.role, schoolId: user.schoolId?._id || user.schoolId,
        result: 'ACCOUNT_LOCKED', req,
        lockoutTriggered: false, lockoutLevel: lockStatus.lockoutLevel,
        lockoutUntil: lockStatus.lockedUntil,
        captchaRequired: lockStatus.captchaRequired,
      }).catch(() => {});

      const response = {
        success: false,
        message: lockStatus.message,
        locked: true,
        lockedUntil: lockStatus.lockedUntil,
        minutesRemaining: lockStatus.minutesLeft,
        minutesLocked: lockStatus.minutesLeft,
      };
      if (lockStatus.captchaRequired) {
        response.captchaRequired = true;
      }
      return res.status(HTTP_STATUS.TOO_MANY_REQUESTS).json(response);
    }

    // ── Verify password ──────────────────────────────────────────────────
    const isPasswordValid = await comparePassword(password, user.password);

    if (!isPasswordValid) {
      // Handle failed login — may trigger account lock
      const lockResult = await accountSecurity.handleFailedLogin(user, req);

      recordSecurityEvent('LOGIN_FAILED', {
        ipAddress: clientIp,
        severity: lockResult.level >= 3 ? 'CRITICAL' : 'HIGH',
        schoolId: user.schoolId?._id || user.schoolId,
      }).catch(() => {});

      accountSecurity.logAttempt({
        userId: user._id, email: user.email, mobile: user.mobile,
        role: user.role, schoolId: user.schoolId?._id || user.schoolId,
        result: 'WRONG_PASSWORD', req,
        lockoutTriggered: lockResult.locked,
        lockoutLevel:     lockResult.level,
        lockoutUntil:     lockResult.lockedUntil,
        captchaRequired:  lockResult.captchaRequired,
      }).catch(() => {});

      global.io?.emit('security:failed_login', {
        ipAddress: clientIp, at: new Date(),
        role: user.role, accountLocked: lockResult.locked,
      });

      const response = {
        success: false,
        message: 'Invalid credentials',
        attemptsRemaining: lockResult.locked ? 0 : undefined,
      };

      if (lockResult.locked) {
        response.message = `Account temporarily locked for ${lockResult.minutesLocked} minutes due to too many failed attempts.`;
        response.locked = true;
        response.lockedUntil = lockResult.lockedUntil;
        response.minutesLocked = lockResult.minutesLocked;
      } else if (lockResult.level === 1) {
        // Warn user before lock
        const rules = user.role === USER_ROLES.SUPER_ADMIN
          ? [{ afterAttempts: 3, lockMinutes: 30 }]
          : [{ afterAttempts: 5, lockMinutes: 15 }];
        const nextLock = rules[0];
        const attemptsLeft = nextLock.afterAttempts - lockResult.consecutiveAttempts;
        response.message = `Invalid credentials. ${attemptsLeft} attempt(s) remaining before account lockout.`;
        response.warning = true;
        response.attemptsRemaining = attemptsLeft;
      }

      if (lockResult.captchaRequired) {
        response.captchaRequired = true;
      }

      return res.status(HTTP_STATUS.UNAUTHORIZED).json(response);
    }

    // ── Password correct — successful login ──────────────────────────────
    await accountSecurity.handleSuccessfulLogin(user, req);

    // Auto-link STUDENT user to Student document if not already linked
    if (user.role === USER_ROLES.STUDENT) {
      let student = await Student.findOne({ userId: user._id });
      if (!student) {
        const query = { schoolId: user.schoolId?._id || user.schoolId };
        const orClauses = [];
        if (user.mobile) orClauses.push({ mobile: user.mobile });
        if (user.name)   orClauses.push({ name: user.name });
        if (orClauses.length > 0) query.$or = orClauses;
        student = await Student.findOne(query).sort({ createdAt: -1 });
        if (student) {
          student.userId = user._id;
          await student.save();
        }
      }
    }

    // Fetch active academic session
    const activeSession = user.schoolId
      ? await AcademicSession.findOne({
          schoolId: user.schoolId?._id || user.schoolId,
          isActive: true,
        })
      : null;

    // Generate JWT token
    const token = generateToken({
      userId: user._id,
      role: user.role,
      schoolId: user.schoolId ? (user.schoolId._id || user.schoolId).toString() : null,
      sessionId: activeSession ? activeSession._id.toString() : null,
    });

    _postLoginActions(user, req, token).catch((e) => console.error('[postLogin]', e.message));

    // Log successful login
    auditLog({
      action: 'LOGIN',
      userId: user._id,
      role: user.role,
      entityType: 'LOGIN_SESSION',
      entityId: user._id,
      description: `${user.name} (${user.role}) logged in`,
      schoolId: user.schoolId?._id || null,
      details: { role: user.role, email: user.email || user.mobile },
      ipAddress: clientIp,
    }).catch(() => {});

    accountSecurity.logAttempt({
      userId: user._id, email: user.email, mobile: user.mobile,
      role: user.role, schoolId: user.schoolId?._id || user.schoolId,
      result: 'SUCCESS', req,
    }).catch(() => {});

    const userResponse = user.toObject();
    delete userResponse.password;

    return res.status(HTTP_STATUS.OK).json({
      success: true,
      message: 'Login successful',
      data: { user: userResponse, token },
    });

  } catch (error) {
    logger.error('Login error:', error.message);
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error logging in',
      error: error.message
    });
  }
};

// Get Current User
const getCurrentUser = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId)
      .populate('schoolId', 'name code address contact')
      .select('-password');

    if (!user) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'User not found'
      });
    }

    res.status(HTTP_STATUS.OK).json({
      success: true,
      data: user
    });
  } catch (error) {
    logger.error('Get current user error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error fetching user',
      error: error.message
    });
  }
};

module.exports = { register, login, getCurrentUser };
