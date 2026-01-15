const express = require('express');
const {
  createSession,
  getSessionsBySchool,
  getActiveSession,
  updateSession
} = require('../controllers/session.controller.js');
const { authenticate } = require('../middlewares/auth.middleware.js');
const { requireMinRole } = require('../middlewares/role.middleware.js');
const { USER_ROLES } = require('../config/constants.js');

const router = express.Router();

// All session routes require authentication
router.use(authenticate);

// POST /api/sessions - Create session (SUPER_ADMIN/PRINCIPAL)
router.post('/', requireMinRole(USER_ROLES.PRINCIPAL), createSession);

// GET /api/sessions/school/:schoolId - Get all sessions for a school
router.get('/school/:schoolId', getSessionsBySchool);

// GET /api/sessions/active/:schoolId - Get active session for a school
router.get('/active/:schoolId', getActiveSession);

// PATCH /api/sessions/:id - Update session (activate/deactivate)
router.patch('/:id', requireMinRole(USER_ROLES.PRINCIPAL), updateSession);

module.exports = router;
