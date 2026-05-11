const express = require('express');
const {
  markStudentDailyAttendance,
  getStudentDailyAttendance,
  getStudentAttendanceByTeacher,
  markSubjectAttendance,
  getSubjectAttendance,
  getPeriodWiseSummary,
  markTeacherAttendance,
  getTeacherAttendance,
  markStaffAttendance,
  getStaffAttendance,
  getParentAttendance,
  getAttendanceForParent,
  getStudentSelfAttendance,
  getAttendanceSummary,
  getMonthlyAttendanceSummary,
  getMonthlyOverviewSummary,
  getStaffMembers,
  getTeacherClassStudents,
  checkDuplicateAttendance,
  checkLateThreshold,
  getClassAttendanceSummary,
} = require('../controllers/attendance.controller.js');
const { authenticate } = require('../middlewares/auth.middleware.js');
const { requireMinRole, requireRole } = require('../middlewares/role.middleware.js');
const { USER_ROLES } = require('../config/constants.js');

const router = express.Router();

// Attendance Summary (dashboard stats)
router.get(
  '/summary',
  authenticate,
  requireMinRole(USER_ROLES.TEACHER),
  getAttendanceSummary
);

router.get(
  '/summary/monthly',
  authenticate,
  requireMinRole(USER_ROLES.TEACHER),
  getMonthlyAttendanceSummary
);

router.get(
  '/summary/overview',
  authenticate,
  requireMinRole(USER_ROLES.TEACHER),
  getMonthlyOverviewSummary
);

router.get(
  '/check',
  authenticate,
  requireMinRole(USER_ROLES.TEACHER),
  checkDuplicateAttendance
);

router.post(
  '/check-late',
  authenticate,
  requireMinRole(USER_ROLES.TEACHER),
  checkLateThreshold
);

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
  '/students/daily/teacher/:teacherId',
  authenticate,
  requireMinRole(USER_ROLES.PRINCIPAL),
  getStudentAttendanceByTeacher
);

router.get(
  '/teacher/class-students',
  authenticate,
  requireMinRole(USER_ROLES.TEACHER),
  getTeacherClassStudents
);



// Subject Attendance
router.post(
  '/students/subject',
  authenticate,
  requireMinRole(USER_ROLES.TEACHER),
  markSubjectAttendance
);

router.get(
  '/students/subject/period-summary',
  authenticate,
  requireMinRole(USER_ROLES.TEACHER),
  getPeriodWiseSummary
);

router.get(
  '/students/subject',
  authenticate,
  requireMinRole(USER_ROLES.STUDENT),
  getSubjectAttendance
);

// Teacher Attendance (legacy – kept for backward-compat)
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

// Staff Attendance (unified: teacher + operator + admin)
router.post(
  '/staff',
  authenticate,
  requireMinRole(USER_ROLES.TEACHER),
  markStaffAttendance
);

router.get(
  '/staff',
  authenticate,
  requireMinRole(USER_ROLES.TEACHER),
  getStaffAttendance
);

// Staff roster (all staff regardless of attendance status)
router.get(
  '/staff/members',
  authenticate,
  requireMinRole(USER_ROLES.TEACHER),
  getStaffMembers
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

router.get(
  '/class-summary',
  authenticate,
  requireMinRole(USER_ROLES.OPERATOR),
  getClassAttendanceSummary
);

module.exports = router;
