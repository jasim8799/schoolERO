import express from 'express';
import { 
  createSession, 
  getSessionsBySchool, 
  getActiveSession,
  updateSession 
} from '../controllers/session.controller.js';

const router = express.Router();

// POST /api/sessions - Create session (SUPER_ADMIN/PRINCIPAL - will add auth later)
router.post('/', createSession);

// GET /api/sessions/school/:schoolId - Get all sessions for a school
router.get('/school/:schoolId', getSessionsBySchool);

// GET /api/sessions/active/:schoolId - Get active session for a school
router.get('/active/:schoolId', getActiveSession);

// PATCH /api/sessions/:id - Update session (activate/deactivate)
router.patch('/:id', updateSession);

export default router;
