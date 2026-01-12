import { HTTP_STATUS, USER_ROLES } from '../config/constants.js';

// Role hierarchy for authorization
const ROLE_HIERARCHY = {
  [USER_ROLES.SUPER_ADMIN]: 6,
  [USER_ROLES.PRINCIPAL]: 5,
  [USER_ROLES.OPERATOR]: 4,
  [USER_ROLES.TEACHER]: 3,
  [USER_ROLES.STUDENT]: 2,
  [USER_ROLES.PARENT]: 1
};

// Check if user has required role
export const requireRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const userRole = req.user.role;

    // Check if user's role is in allowed roles
    if (!allowedRoles.includes(userRole)) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({
        success: false,
        message: 'Access denied. Insufficient permissions.'
      });
    }

    next();
  };
};

// Check if user has minimum role level
export const requireMinRole = (minRole) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const userRoleLevel = ROLE_HIERARCHY[req.user.role] || 0;
    const minRoleLevel = ROLE_HIERARCHY[minRole] || 0;

    if (userRoleLevel < minRoleLevel) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({
        success: false,
        message: 'Access denied. Insufficient permissions.'
      });
    }

    next();
  };
};

// Prevent users from assigning roles higher than their own
export const canAssignRole = (req, res, next) => {
  const { role: targetRole } = req.body;
  const userRoleLevel = ROLE_HIERARCHY[req.user.role] || 0;
  const targetRoleLevel = ROLE_HIERARCHY[targetRole] || 0;

  if (targetRoleLevel >= userRoleLevel) {
    return res.status(HTTP_STATUS.FORBIDDEN).json({
      success: false,
      message: 'Cannot assign a role equal to or higher than your own'
    });
  }

  next();
};
