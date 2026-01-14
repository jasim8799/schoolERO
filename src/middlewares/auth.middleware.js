import { verifyToken } from '../utils/jwt.js';
import { HTTP_STATUS } from '../config/constants.js';
import User from '../models/User.js';

// Verify JWT token and attach user to request
export const authenticate = async (req, res, next) => {
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
    const decoded = verifyToken(token);

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

    // Check force logout for school users
    if (decoded.schoolId) {
      const School = (await import('../models/School.js')).default;
      const school = await School.findById(decoded.schoolId);
      if (school && school.forceLogoutAt && decoded.iat * 1000 < school.forceLogoutAt.getTime()) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          success: false,
          message: 'Session expired. Please login again.',
          forceLogout: true
        });
      }
    }

    // Attach user info to request
    req.user = {
      userId: decoded.userId,
      role: decoded.role,
      schoolId: decoded.schoolId
    };

    next();
  } catch (error) {
    return res.status(HTTP_STATUS.UNAUTHORIZED).json({
      success: false,
      message: 'Invalid or expired token',
      error: error.message
    });
  }
};
