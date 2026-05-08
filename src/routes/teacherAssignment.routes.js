const express = require('express');
const {
  createAssignment,
  getByTeacher,
  getByClass,
  getAllBySchool,
  publishTimetable,
  deleteAssignment,
  getMyTimetable,
  getStudentClassTimetable,
  getPublishStatus,
  addHoliday,
  removeHoliday,
  getHolidays,
  getTimetableByDate
} = require('../controllers/teacherAssignment.controller.js');
const { requireMinRole, requireRole } = require('../middlewares/role.middleware.js');
const { USER_ROLES } = require('../config/constants.js');

const router = express.Router();

// ── Admin/Operator routes ─────────────────────────────────────────────
router.post('/', requireMinRole(USER_ROLES.OPERATOR), createAssignment);
router.post('/publish', requireMinRole(USER_ROLES.OPERATOR), publishTimetable);
router.get('/all', requireMinRole(USER_ROLES.OPERATOR), getAllBySchool);
router.get('/publish-status', requireMinRole(USER_ROLES.OPERATOR), getPublishStatus);

// ── Holiday management (Principal/Operator only) ──────────────────────
router.post('/holidays', requireMinRole(USER_ROLES.OPERATOR), addHoliday);
router.delete('/holidays', requireMinRole(USER_ROLES.OPERATOR), removeHoliday);
router.get('/holidays', requireMinRole(USER_ROLES.OPERATOR), getHolidays);

// ── Date-based timetable (all authenticated roles) ────────────────────
router.get('/date', requireMinRole(USER_ROLES.STUDENT), getTimetableByDate);

// ── Teacher: own published timetable ─────────────────────────────────
router.get('/my', requireRole(USER_ROLES.TEACHER), getMyTimetable);

// ── Student: published class timetable ───────────────────────────────
router.get('/student/me', requireRole(USER_ROLES.STUDENT), getStudentClassTimetable);

// ── Query routes ──────────────────────────────────────────────────────
router.get('/', requireMinRole(USER_ROLES.OPERATOR), getByTeacher);
router.get('/class', requireMinRole(USER_ROLES.OPERATOR), getByClass);

// ── Delete ────────────────────────────────────────────────────────────
router.delete('/:id', requireMinRole(USER_ROLES.OPERATOR), deleteAssignment);

module.exports = router;
