const jwt = require('jsonwebtoken');
const { HTTP_STATUS, USER_ROLES } = require('../config/constants');
const User = require('../models/User');
const School = require('../models/School');
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

    // Verify token
    const decoded = jwt.verify(token, config.jwt.secret);

    // Check if user exists and is active
    const user = await User.findById(decoded.userId).select('-password');
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
      sessionId: decoded.sessionId || null
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

    next();
  } catch (error) {
    return res.status(HTTP_STATUS.UNAUTHORIZED).json({
      success: false,
      message: 'Invalid or expired token'
      // Remove error details in production for security
    });
  }
};

module.exports = {
  authenticate
};
