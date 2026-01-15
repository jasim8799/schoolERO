const express = require('express');
const { register, login, getCurrentUser } = require('../controllers/auth.controller.js');
const { authenticate } = require('../middlewares/auth.middleware.js');
const { requireRole } = require('../middlewares/role.middleware.js');
const { USER_ROLES } = require('../config/constants.js');

const router = express.Router();

// POST /api/auth/register - Register user (SUPER_ADMIN only)
router.post('/register', authenticate, requireRole(USER_ROLES.SUPER_ADMIN), register);

// POST /api/auth/login - Login user
router.post('/login', login);

// GET /api/auth/me - Get current user (protected)
router.get('/me', authenticate, getCurrentUser);

module.exports = router;
