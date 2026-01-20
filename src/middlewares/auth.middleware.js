const jwt = require('jsonwebtoken');
const { HTTP_STATUS } = require('../config/constants');
const User = require('../models/User');
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
      schoolId: user.schoolId ? user.schoolId.toString() : null
    };

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
