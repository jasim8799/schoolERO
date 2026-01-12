import express from 'express';
import { register, login, getCurrentUser } from '../controllers/auth.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { requireRole } from '../middlewares/role.middleware.js';
import { USER_ROLES } from '../config/constants.js';

const router = express.Router();

// POST /api/auth/register - Register user (SUPER_ADMIN only)
router.post('/register', authenticate, requireRole(USER_ROLES.SUPER_ADMIN), register);

// POST /api/auth/login - Login user
router.post('/login', login);

// GET /api/auth/me - Get current user (protected)
router.get('/me', authenticate, getCurrentUser);

export default router;
