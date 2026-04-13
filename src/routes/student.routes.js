const express = require('express');
const { createStudent, getAllStudents, getStudentById, updateStudent, deleteStudent, updateStudentStatus, linkUserToStudent, moveStudentToActiveSession, getMyStudentProfile } = require('../controllers/student.controller.js');
const { authenticate } = require('../middlewares/auth.middleware.js');
const { requireMinRole, requireRole } = require('../middlewares/role.middleware.js');
const { USER_ROLES } = require('../config/constants.js');

const router = express.Router();

// All student routes require authentication
router.use(authenticate);

// POST /api/students - Create student (PRINCIPAL, OPERATOR)
router.post('/', requireMinRole(USER_ROLES.OPERATOR), createStudent);

// GET /api/students - Get all students (TEACHER+ with assignment guard in controller)
router.get('/', requireMinRole(USER_ROLES.TEACHER), getAllStudents);

// GET /api/students/me - Student self profile
router.get(
  '/me',
  requireMinRole(USER_ROLES.STUDENT),
  getMyStudentProfile
);

// GET /api/students/:id - Get student by ID
router.get(
  '/:id',
  requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR, USER_ROLES.TEACHER),
  getStudentById
);

// PUT /api/students/:id — update student (PRINCIPAL, OPERATOR only)
router.put(
  '/:id',
  requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR),
  updateStudent
);

// PATCH /api/students/:id — update student (PRINCIPAL, OPERATOR only)
router.patch(
  '/:id',
  requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR),
  updateStudent
);

// DELETE /api/students/:id — soft-delete (PRINCIPAL only)
router.delete(
  '/:id',
  requireRole(USER_ROLES.PRINCIPAL),
  deleteStudent
);

// PATCH /api/students/:id/status - Update student status (NO DELETE)
router.patch(
  '/:id/status',
  requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR),
  updateStudentStatus
);

// POST /api/students/:id/link-user - Link user to student (PRINCIPAL, OPERATOR)
router.post('/:id/link-user', requireMinRole(USER_ROLES.OPERATOR), linkUserToStudent);

// PATCH /api/students/:id/move-session - Move student to active session (PRINCIPAL, OPERATOR)
router.patch('/:id/move-session', requireMinRole(USER_ROLES.OPERATOR), moveStudentToActiveSession);

module.exports = router;
