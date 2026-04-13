const express = require('express');
const { authenticate } = require('../middlewares/auth.middleware');
const { enforceSchoolIsolation } = require('../middlewares/school.middleware');
const { requireRole } = require('../middlewares/role.middleware');
const {
  createNotice,
  getAllNotices,
  getStudentNotices,
  getParentNotices,
  getTeacherNotices,
  deleteNotice,
} = require('../controllers/notice.controller');
const { USER_ROLES } = require('../config/constants');

const router = express.Router();

// TEACHER added — controller enforces Class-only for teachers
router.post(
  '/',
  authenticate,
  enforceSchoolIsolation,
  requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR, USER_ROLES.TEACHER),
  createNotice
);

router.get(
  '/all',
  authenticate,
  enforceSchoolIsolation,
  requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR),
  getAllNotices
);

router.get(
  '/student',
  authenticate,
  enforceSchoolIsolation,
  requireRole(USER_ROLES.STUDENT),
  getStudentNotices
);

router.get(
  '/parent',
  authenticate,
  enforceSchoolIsolation,
  requireRole(USER_ROLES.PARENT),
  getParentNotices
);

router.get(
  '/teacher',
  authenticate,
  enforceSchoolIsolation,
  requireRole(USER_ROLES.TEACHER),
  getTeacherNotices
);

router.delete(
  '/:id',
  authenticate,
  enforceSchoolIsolation,
  requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR),
  deleteNotice
);

module.exports = router;
