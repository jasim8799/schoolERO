const express = require('express');
const { createStudent, getAllStudents, getStudentById, updateStudentStatus, linkUserToStudent } = require('../controllers/student.controller.js');
const { authenticate } = require('../middlewares/auth.middleware.js');
const { requireMinRole } = require('../middlewares/role.middleware.js');
const { USER_ROLES } = require('../config/constants.js');

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

// PATCH /api/students/:id/link-user - Link user to student (PRINCIPAL, OPERATOR)
router.patch('/:id/link-user', requireMinRole(USER_ROLES.OPERATOR), linkUserToStudent);

module.exports = router;
