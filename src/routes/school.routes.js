import express from 'express';
import { createSchool, getAllSchools, getSchoolById } from '../controllers/school.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { requireRole } from '../middlewares/role.middleware.js';
import { USER_ROLES } from '../config/constants.js';

const router = express.Router();

// All school routes require SUPER_ADMIN authentication
router.use(authenticate);
router.use(requireRole(USER_ROLES.SUPER_ADMIN));

// POST /api/schools - Create school (SUPER_ADMIN only)
router.post('/', createSchool);

// GET /api/schools - Get all schools (SUPER_ADMIN only)
router.get('/', getAllSchools);

// GET /api/schools/:id - Get school by ID
router.get('/:id', getSchoolById);

export default router;
