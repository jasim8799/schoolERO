import express from 'express';
import { createStudent, getAllStudents, getStudentById, updateStudentStatus } from '../controllers/student.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { requireMinRole } from '../middlewares/role.middleware.js';
import { USER_ROLES } from '../config/constants.js';

const router = express.Router();

// All student routes require authentication
router.use(authenticate);

// POST /api/students - Create student (PRINCIPAL, OPERATOR)
router.post('/', requireMinRole(USER_ROLES.OPERATOR), createStudent);

// GET /api/students - Get all students (PRINCIPAL, OPERATOR)
router.get('/', requireMinRole(USER_ROLES.OPERATOR), getAllStudents);

// GET /api/students/:id - Get student by ID
router.get('/:id', requireMinRole(USER_ROLES.OPERATOR), getStudentById);

// PATCH /api/students/:id/status - Update student status (NO DELETE)
router.patch('/:id/status', requireMinRole(USER_ROLES.OPERATOR), updateStudentStatus);

export default router;
