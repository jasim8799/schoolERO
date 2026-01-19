const { HTTP_STATUS, USER_ROLES } = require('../config/constants.js');
const mongoose = require('mongoose');
const School = require('../models/School.js');

// Check if user's school is active
const checkSchoolStatus = async (req, res, next) => {
  try {
    // For non-SUPER_ADMIN roles, enforce school validation
    if (req.user.role !== USER_ROLES.SUPER_ADMIN) {
      // Check if user has a school assigned
      if (!req.user.schoolId) {
        return res.status(HTTP_STATUS.FORBIDDEN).json({
          success: false,
          message: 'User is not assigned to any school'
        });
      }

      // Check if school exists and is active
      const school = await School.findById(req.user.schoolId);
      if (!school) {
        return res.status(HTTP_STATUS.FORBIDDEN).json({
          success: false,
          message: 'School not found'
        });
      }

      if (school.status !== 'active') {
        return res.status(HTTP_STATUS.FORBIDDEN).json({
          success: false,
          message: 'School is currently inactive. Please contact system administrator.'
        });
      }
    }

    next();
  } catch (error) {
    console.error('School status check error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error checking school status'
    });
  }
};

// Ensure user can only access their own school's data
const enforceSchoolIsolation = (req, res, next) => {
  // SUPER_ADMIN can access all schools
  if (req.user.role === USER_ROLES.SUPER_ADMIN) {
    return next();
  }

  // For non-SUPER_ADMIN users, schoolId MUST come from JWT
  const userSchoolId = req.user.schoolId;
  if (!userSchoolId) {
    return res.status(HTTP_STATUS.FORBIDDEN).json({
      success: false,
      message: 'User is not assigned to any school'
    });
  }

  // If schoolId is provided in request, it must match req.user.schoolId
  const requestSchoolId = req.body.schoolId || req.params.schoolId || req.query.schoolId;
  if (requestSchoolId && requestSchoolId !== userSchoolId.toString()) {
    return res.status(HTTP_STATUS.FORBIDDEN).json({
      success: false,
      message: 'Access denied. Cannot access other school\'s data.'
    });
  }

  next();
};

// Automatically attach user's schoolId to request body (for create operations)
const attachSchoolId = (req, res, next) => {
  // If user is not authenticated yet, skip safely
  if (!req.user) {
    return next();
  }

  // PARENT and STUDENT roles already have schoolId from JWT, skip validation
  if (req.user.role === 'PARENT' || req.user.role === 'STUDENT') {
    return next();
  }

  // SUPER_ADMIN does not require school context
  if (req.user.role === 'SUPER_ADMIN') {
    return next();
  }

  // If schoolId already present, continue
  if (req.user.schoolId) {
    req.schoolId = req.user.schoolId;
    return next();
  }

  return res.status(403).json({
    success: false,
    message: 'School context missing'
  });
};

// Filter queries by user's school
const filterBySchool = (req, res, next) => {
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

module.exports = {
  checkSchoolStatus,
  enforceSchoolIsolation,
  attachSchoolId,
  filterBySchool
};
