import express from 'express';
import { 
  createSession, 
  getSessionsBySchool, 
  getActiveSession,
  updateSession 
} from '../controllers/session.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { requireMinRole } from '../middlewares/role.middleware.js';
import { USER_ROLES } from '../config/constants.js';

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

export default router;
