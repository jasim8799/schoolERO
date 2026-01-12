import express from 'express';
import { createTeacher, getAllTeachers, getTeacherById, updateTeacherAssignments } from '../controllers/teacher.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { requireMinRole } from '../middlewares/role.middleware.js';
import { USER_ROLES } from '../config/constants.js';

const router = express.Router();

// All teacher routes require authentication
router.use(authenticate);

// POST /api/teachers - Create teacher (PRINCIPAL, OPERATOR)
router.post('/', requireMinRole(USER_ROLES.OPERATOR), createTeacher);

// GET /api/teachers - Get all teachers (PRINCIPAL, OPERATOR)
router.get('/', requireMinRole(USER_ROLES.OPERATOR), getAllTeachers);

// GET /api/teachers/:id - Get teacher by ID
router.get('/:id', requireMinRole(USER_ROLES.OPERATOR), getTeacherById);

// PATCH /api/teachers/:id - Update teacher assignments
router.patch('/:id', requireMinRole(USER_ROLES.OPERATOR), updateTeacherAssignments);

export default router;
