const express = require('express');
const {
  markStudentDailyAttendance,
  getStudentDailyAttendance,
  markSubjectAttendance,
  getSubjectAttendance,
  markTeacherAttendance,
  getTeacherAttendance,
  getParentAttendance,
  getAttendanceForParent,
  getStudentSelfAttendance,
} = require('../controllers/attendance.controller.js');
const { authenticate } = require('../middlewares/auth.middleware.js');
const { requireMinRole, requireRole } = require('../middlewares/role.middleware.js');
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

router.get(
  '/parent/:studentId',
  authenticate,
  requireRole(USER_ROLES.PARENT),
  getAttendanceForParent
);

router.get(
  '/parents/attendance',
  authenticate,
  requireMinRole(USER_ROLES.PARENT),
  getParentAttendance
);

router.get(
  '/student/me',
  authenticate,
  requireRole(USER_ROLES.STUDENT),
  getStudentSelfAttendance
);

module.exports = router;
