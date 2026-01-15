const express = require('express');
const { createTeacher, getAllTeachers, getTeacherById, updateTeacherAssignments } = require('../controllers/teacher.controller.js');
const { authenticate } = require('../middlewares/auth.middleware.js');
const { requireMinRole } = require('../middlewares/role.middleware.js');
const { USER_ROLES } = require('../config/constants.js');

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

module.exports = router;
