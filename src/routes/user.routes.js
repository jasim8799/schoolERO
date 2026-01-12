import express from 'express';
import { 
  createUser, 
  getAllUsers, 
  getUserById, 
  updateUser, 
  deleteUser 
} from '../controllers/user.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { requireRole, requireMinRole, canAssignRole } from '../middlewares/role.middleware.js';
import { enforceSchoolIsolation, attachSchoolId, filterBySchool } from '../middlewares/school.middleware.js';
import { USER_ROLES } from '../config/constants.js';

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// POST /api/users - Create user
// Only PRINCIPAL and OPERATOR can create users
// Cannot create users for other schools
// Cannot assign higher role than own role
router.post(
  '/', 
  requireMinRole(USER_ROLES.OPERATOR),
  attachSchoolId,
  canAssignRole,
  enforceSchoolIsolation,
  createUser
);

// GET /api/users - Get all users
// Filter by user's school (except SUPER_ADMIN)
router.get(
  '/', 
  filterBySchool,
  getAllUsers
);

// GET /api/users/:id - Get user by ID
router.get('/:id', getUserById);

// PATCH /api/users/:id - Update user
// Only PRINCIPAL and above can update users
router.patch(
  '/:id', 
  requireMinRole(USER_ROLES.PRINCIPAL),
  updateUser
);

// DELETE /api/users/:id - Delete user
// Only PRINCIPAL and above can delete users
router.delete(
  '/:id', 
  requireMinRole(USER_ROLES.PRINCIPAL),
  deleteUser
);

export default router;
