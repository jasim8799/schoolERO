const express = require('express');
const {
  markStudentDailyAttendance,
  getStudentDailyAttendance,
  getMyStudentAttendance,
  markSubjectAttendance,
  getSubjectAttendance,
  markTeacherAttendance,
  getTeacherAttendance,
} = require('../controllers/attendance.controller.js');
const { authenticate } = require('../middlewares/auth.middleware.js');
const { requireMinRole } = require('../middlewares/role.middleware.js');
const { USER_ROLES } = require('../config/constants.js');

const router = express.Router();

// Student Daily Attendance
router.post(
  '/students/daily',
  authenticate,
  requireMinRole(USER_ROLES.TEACHER),
  markStudentDailyAttendance
);

router.get(
  '/students/daily',
  authenticate,
  requireMinRole(USER_ROLES.TEACHER),
  getStudentDailyAttendance
);

router.get(
  '/students/me',
  authenticate,
  getMyStudentAttendance
);

// Subject Attendance
router.post(
  '/students/subject',
  authenticate,
  requireMinRole(USER_ROLES.TEACHER),
  markSubjectAttendance
);

router.get(
  '/students/subject',
  authenticate,
  requireMinRole(USER_ROLES.TEACHER),
  getSubjectAttendance
);

// Teacher Attendance
router.post(
  '/teachers',
  authenticate,
  requireMinRole(USER_ROLES.TEACHER),
  markTeacherAttendance
);

router.get(
  '/teachers',
  authenticate,
  requireMinRole(USER_ROLES.TEACHER),
  getTeacherAttendance
);

module.exports = router;
