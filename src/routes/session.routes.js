const express = require('express');
const {
  createSession,
  getSessionsBySchool,
  getActiveSession,
  updateSession,
  duplicateSessionSetup,
  getSessionReadiness,
  activateSession
} = require('../controllers/session.controller.js');
const { authenticate } = require('../middlewares/auth.middleware.js');
const { requireMinRole, requireRole } = require('../middlewares/role.middleware.js');
const { USER_ROLES } = require('../config/constants.js');

const router = express.Router();

// All session routes require authentication
router.use(authenticate);

// POST /api/sessions - Create session (PRINCIPAL / SUPER_ADMIN)
router.post(
  '/',
  requireMinRole(USER_ROLES.PRINCIPAL),
  createSession
);

// GET /api/sessions/school/:schoolId - Get all sessions for a school
router.get('/school/:schoolId', getSessionsBySchool);

// GET /api/sessions/active/:schoolId - Get active session for a school
router.get('/active/:schoolId', getActiveSession);

// PATCH /api/sessions/:id - Activate / deactivate session
router.patch(
  '/:id',
  requireMinRole(USER_ROLES.PRINCIPAL),
  updateSession
);

router.post(
  '/:sessionId/duplicate-setup',
  requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR),
  duplicateSessionSetup
);

router.get(
  '/:sessionId/readiness',
  requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR),
  getSessionReadiness
);

router.post(
  '/:sessionId/activate',
  requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR),
  activateSession
);

module.exports = router;
