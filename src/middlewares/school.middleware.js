import { HTTP_STATUS, USER_ROLES } from '../config/constants.js';
import mongoose from 'mongoose';

// Ensure user can only access their own school's data
export const enforceSchoolIsolation = (req, res, next) => {
  // SUPER_ADMIN can access all schools
  if (req.user.role === USER_ROLES.SUPER_ADMIN) {
    return next();
  }

  // Check if schoolId is provided in request body or params
  const requestSchoolId = req.body.schoolId || req.params.schoolId || req.query.schoolId;

  if (!requestSchoolId) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({
      success: false,
      message: 'School ID is required'
    });
  }

  // Ensure user can only access their own school
  if (req.user.schoolId && requestSchoolId !== req.user.schoolId.toString()) {
    return res.status(HTTP_STATUS.FORBIDDEN).json({
      success: false,
      message: 'Access denied. Cannot access other school\'s data.'
    });
  }

  next();
};

// Automatically attach user's schoolId to request body (for create operations)
export const attachSchoolId = (req, res, next) => {
  // SUPER_ADMIN must explicitly provide schoolId
  if (req.user.role === USER_ROLES.SUPER_ADMIN) {
    return next();
  }

  // For other roles, automatically use their schoolId
  if (!req.body.schoolId && req.user.schoolId) {
    req.body.schoolId = req.user.schoolId;
  }

  next();
};

// Filter queries by user's school
export const filterBySchool = (req, res, next) => {
  // SUPER_ADMIN can see all
  if (req.user.role === USER_ROLES.SUPER_ADMIN) {
    return next();
  }

  // Add schoolId filter to query
  if (!req.query.schoolId && req.user.schoolId) {
    req.query.schoolId = req.user.schoolId.toString();
  }

  next();
};
