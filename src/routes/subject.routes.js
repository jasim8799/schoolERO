import express from 'express';
import { createSubject, getAllSubjects, getSubjectById } from '../controllers/subject.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { requireMinRole } from '../middlewares/role.middleware.js';
import { USER_ROLES } from '../config/constants.js';

const router = express.Router();

// All subject routes require authentication
router.use(authenticate);

// POST /api/subjects - Create subject (PRINCIPAL, OPERATOR)
router.post('/', requireMinRole(USER_ROLES.OPERATOR), createSubject);

// GET /api/subjects - Get all subjects (PRINCIPAL, OPERATOR)
router.get('/', requireMinRole(USER_ROLES.OPERATOR), getAllSubjects);

// GET /api/subjects/:id - Get subject by ID
router.get('/:id', requireMinRole(USER_ROLES.OPERATOR), getSubjectById);

export default router;
