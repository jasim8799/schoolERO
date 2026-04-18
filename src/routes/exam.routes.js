const express = require('express');
const { createExam, getExamsByClass, getExamById, updateExam, publishExam, publishAdmitCards } = require('../controllers/exam.controller.js');
const { requireRole } = require('../middlewares/role.middleware.js');
const { enforceSchoolIsolation } = require('../middlewares/school.middleware.js');
const { USER_ROLES } = require('../config/constants.js');

const router = express.Router();

router.post(
  '/',
  enforceSchoolIsolation,
  requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR),
  createExam
);

router.get(
  '/',
  enforceSchoolIsolation,
  requireRole(
    USER_ROLES.PRINCIPAL,
    USER_ROLES.OPERATOR,
    USER_ROLES.TEACHER
  ),
  getExamsByClass
);

router.get(
  '/:examId',
  enforceSchoolIsolation,
  requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR, USER_ROLES.TEACHER),
  getExamById
);

router.put(
  '/:examId',
  enforceSchoolIsolation,
  requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR),
  updateExam
);

router.patch(
  '/:examId/publish',
  enforceSchoolIsolation,
  requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR),
  publishExam
);

router.patch(
  '/:examId/publish-admit-cards',
  enforceSchoolIsolation,
  requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR),
  publishAdmitCards
);

module.exports = router;
