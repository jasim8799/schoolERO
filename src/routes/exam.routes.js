const express = require('express');
const { createExam, getExamsByClass, updateExam, publishExam } = require('../controllers/exam.controller.js');
const { authenticate } = require('../middlewares/auth.middleware.js');
const { attachActiveSession } = require('../middlewares/session.middleware.js');
const { requireRole } = require('../middlewares/role.middleware.js');
const { enforceSchoolIsolation } = require('../middlewares/school.middleware.js');
const { USER_ROLES } = require('../config/constants.js');

const router = express.Router();

router.post(
  '/',
  authenticate,
  attachActiveSession,
  enforceSchoolIsolation,
  requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR),
  createExam
);

router.get(
  '/',
  authenticate,
  attachActiveSession,
  enforceSchoolIsolation,
  requireRole(
    USER_ROLES.PRINCIPAL,
    USER_ROLES.OPERATOR,
    USER_ROLES.TEACHER
  ),
  getExamsByClass
);

router.put(
  '/:examId',
  authenticate,
  attachActiveSession,
  enforceSchoolIsolation,
  requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR),
  updateExam
);

router.patch(
  '/:examId/publish',
  authenticate,
  attachActiveSession,
  enforceSchoolIsolation,
  requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR),
  publishExam
);

module.exports = router;
