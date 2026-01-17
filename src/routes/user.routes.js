const express = require('express');
const {
  createUser,
  getAllUsers,
  getUserById,
  updateUser,
  deleteUser,
  reactivateUser
} = require('../controllers/user.controller.js');
const { authenticate } = require('../middlewares/auth.middleware.js');
const { requireRole, requireMinRole, canAssignRole } = require('../middlewares/role.middleware.js');
const { enforceSchoolIsolation, attachSchoolId, filterBySchool } = require('../middlewares/school.middleware.js');
const { checkStudentLimit, checkTeacherLimit } = require('../middlewares/schoolLimits.middleware.js');
const { USER_ROLES } = require('../config/constants.js');

const router = express.Router();

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

module.exports = router;
