const express = require('express');
const {
  createUser,
  getAllUsers,
  getSuperAdminUsers,
  getUserById,
  updateUser,
  deleteUser,
  reactivateUser,
  setUserPassword,
  updateMyProfile,
  uploadStaffDocument,
  getStaffDocumentData,
  forceLogoutUser,
  enableMfa,
  disableMfa,
  getUserAnalytics,
} = require('../controllers/user.controller.js');
const { authenticate } = require('../middlewares/auth.middleware.js');
const { requireRole, requireMinRole, canAssignRole } = require('../middlewares/role.middleware.js');
const { enforceSchoolIsolation, attachSchoolId, filterBySchool } = require('../middlewares/school.middleware.js');
const { checkStudentLimit, checkTeacherLimit } = require('../middlewares/schoolLimits.middleware.js');
const { USER_ROLES } = require('../config/constants.js');

const router = express.Router();

// GET /api/users/super-admin - Get ALL users across all schools (SUPER_ADMIN only)
// Must come BEFORE the /:id route to avoid path conflict
router.get(
  '/super-admin',
  authenticate,
  requireRole(USER_ROLES.SUPER_ADMIN),
  getSuperAdminUsers
);

// POST /api/users - Create user
// Only PRINCIPAL and OPERATOR can create users
// Cannot create users for other schools
// Cannot assign higher role than own role
// Check limits for students and teachers
router.post(
  '/',
  requireMinRole(USER_ROLES.OPERATOR),
  canAssignRole,
  async (req, res, next) => {
    const { role } = req.body;

    if (role === USER_ROLES.STUDENT) {
      return checkStudentLimit(req, res, next);
    } else if (role === USER_ROLES.TEACHER) {
      return checkTeacherLimit(req, res, next);
    }
    next();
  },
  createUser
);

// GET /api/users - Get all users
// Filter by user's school (except SUPER_ADMIN)
router.get(
  '/', 
  enforceSchoolIsolation,
  filterBySchool,
  getAllUsers
);

// PATCH /api/users/me - update own profile (email/photo)
router.patch('/me', authenticate, updateMyProfile);

// GET /api/users/analytics - User IAM analytics (SUPER_ADMIN)
// Must come BEFORE /:id
router.get(
  '/analytics',
  authenticate,
  requireRole(USER_ROLES.SUPER_ADMIN),
  getUserAnalytics
);

// PATCH /api/users/:id/force-logout - Revoke all active sessions for a user
router.patch(
  '/:id/force-logout',
  requireMinRole(USER_ROLES.PRINCIPAL),
  enforceSchoolIsolation,
  forceLogoutUser
);

// PATCH /api/users/:id/enable-mfa - Enable MFA
router.patch(
  '/:id/enable-mfa',
  requireMinRole(USER_ROLES.PRINCIPAL),
  enforceSchoolIsolation,
  enableMfa
);

// PATCH /api/users/:id/disable-mfa - Disable MFA
router.patch(
  '/:id/disable-mfa',
  requireMinRole(USER_ROLES.PRINCIPAL),
  enforceSchoolIsolation,
  disableMfa
);

// GET /api/users/:id - Get user by ID
router.get('/:id', enforceSchoolIsolation, getUserById);

// PATCH /api/users/:id - Update user
// Only PRINCIPAL and above can update users
router.patch(
  '/:id', 
  requireMinRole(USER_ROLES.PRINCIPAL),
  enforceSchoolIsolation,
  updateUser
);

// DELETE /api/users/:id - Delete user
// Only PRINCIPAL and above can delete users
router.delete(
  '/:id', 
  requireMinRole(USER_ROLES.PRINCIPAL),
  enforceSchoolIsolation,
  deleteUser
);

// PATCH /api/users/:id/reactivate - Reactivate user
// Only PRINCIPAL and above can reactivate users
router.patch(
  '/:id/reactivate',
  requireMinRole(USER_ROLES.PRINCIPAL),
  reactivateUser
);

// PATCH /api/users/:id/set-password - Set user password
// Only OPERATOR and above can reset passwords
router.patch(
  '/:id/set-password',
  requireMinRole(USER_ROLES.OPERATOR),
  setUserPassword
);

// POST /api/users/:id/documents/:docType - Upload staff document (principal only)
router.post(
  '/:id/documents/:docType',
  requireRole(USER_ROLES.PRINCIPAL),
  uploadStaffDocument
);

// GET /api/users/:id/documents/:docType/data - Fetch staff document dataUrl
router.get(
  '/:id/documents/:docType/data',
  requireMinRole(USER_ROLES.OPERATOR),
  getStaffDocumentData
);

module.exports = router;
