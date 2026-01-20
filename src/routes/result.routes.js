const express = require('express');
const { createOrUpdateResult, publishResult, getMyResult, getResultPDF, getResultsByExam, getChildrenResults, getMyResults } = require('../controllers/result.controller.js');
const { authenticate } = require('../middlewares/auth.middleware.js');
const { requireRole } = require('../middlewares/role.middleware.js');
const { enforceSchoolIsolation } = require('../middlewares/school.middleware.js');
const { USER_ROLES } = require('../config/constants.js');

const router = express.Router();

router.post(
  '/',
  authenticate,
  enforceSchoolIsolation,
  requireRole(USER_ROLES.TEACHER, USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR),
  createOrUpdateResult
);

router.patch(
  '/:examId/:studentId/publish',
  authenticate,
  enforceSchoolIsolation,
  requireRole(USER_ROLES.PRINCIPAL),
  publishResult
);

router.get(
  '/exam/:examId',
  authenticate,
  enforceSchoolIsolation,
  requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR),
  getResultsByExam
);

router.get(
  '/children',
  authenticate,
  enforceSchoolIsolation,
  requireRole(USER_ROLES.PARENT),
  getChildrenResults
);

router.get(
  '/me',
  authenticate,
  enforceSchoolIsolation,
  requireRole(USER_ROLES.STUDENT),
  getMyResults
);

router.get(
  '/me/:examId',
  authenticate,
  enforceSchoolIsolation,
  requireRole(USER_ROLES.STUDENT),
  getMyResult
);

router.get(
  '/:id/pdf',
  authenticate,
  enforceSchoolIsolation,
  getResultPDF
);

module.exports = router;
