import express from 'express';
import {
  markStudentDailyAttendance,
  getStudentDailyAttendance,
  getMyStudentAttendance,
  markSubjectAttendance,
  getSubjectAttendance,
  markTeacherAttendance,
  getTeacherAttendance,
} from '../controllers/attendance.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { requireMinRole } from '../middlewares/role.middleware.js';
import { USER_ROLES } from '../config/constants.js';

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

export default router;
