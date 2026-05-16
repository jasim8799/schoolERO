const express = require('express');
const { createOrUpdateResult, submitSimpleMarks, principalUpdateResult, publishOneResult, publishResult, publishAllResults, getAllResults, getMyResult, getMyEnteredSubjects, getResultPDF, getResultsByExam, getChildrenResults, getMyResults, getResultsByStudentId } = require('../controllers/result.controller.js');
const { authenticate } = require('../middlewares/auth.middleware.js');
const { requireRole } = require('../middlewares/role.middleware.js');
const { enforceSchoolIsolation } = require('../middlewares/school.middleware.js');
const { attachActiveSession } = require('../middlewares/session.middleware.js');
const { USER_ROLES } = require('../config/constants.js');

const router = express.Router();

// GET /api/results?examId=...&status=... — list results (PRINCIPAL, OPERATOR)
router.get(
  '/',
  authenticate,
  attachActiveSession,
  enforceSchoolIsolation,
  requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR),
  getAllResults
);

// POST /api/results/simple — simple mark entry (TEACHER, PRINCIPAL, OPERATOR)
router.post(
  '/simple',
  authenticate,
  attachActiveSession,
  enforceSchoolIsolation,
  requireRole(USER_ROLES.TEACHER, USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR),
  submitSimpleMarks
);

// PATCH /api/results/publish-all — bulk publish all draft results for an exam
router.patch(
  '/publish-all',
  authenticate,
  attachActiveSession,
  enforceSchoolIsolation,
  requireRole(USER_ROLES.PRINCIPAL),
  publishAllResults
);

router.post(
  '/',
  authenticate,
  attachActiveSession,
  enforceSchoolIsolation,
  requireRole(USER_ROLES.TEACHER, USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR),
  createOrUpdateResult
);

// PATCH /api/results/:resultId/edit — principal edits a draft result
router.patch(
  '/:resultId/edit',
  authenticate,
  attachActiveSession,
  enforceSchoolIsolation,
  requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR),
  principalUpdateResult
);

// PATCH /api/results/:resultId/publish-one — publish single result
router.patch(
  '/:resultId/publish-one',
  authenticate,
  attachActiveSession,
  enforceSchoolIsolation,
  requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR),
  publishOneResult
);

router.patch(
  '/:examId/:studentId/publish',
  authenticate,
  attachActiveSession,
  enforceSchoolIsolation,
  requireRole(USER_ROLES.PRINCIPAL),
  publishResult
);

router.get(
  '/exam/:examId',
  authenticate,
  attachActiveSession,
  enforceSchoolIsolation,
  requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR),
  getResultsByExam
);

router.get(
  '/children',
  authenticate,
  attachActiveSession,
  enforceSchoolIsolation,
  requireRole(USER_ROLES.PARENT),
  getChildrenResults
);

router.get(
  '/student/me',
  authenticate,
  attachActiveSession,
  enforceSchoolIsolation,
  requireRole(USER_ROLES.STUDENT),
  getMyResults
);

router.get(
  '/student/:studentId',
  authenticate,
  attachActiveSession,
  enforceSchoolIsolation,
  requireRole(USER_ROLES.TEACHER, USER_ROLES.PRINCIPAL),
  getResultsByStudentId
);

router.get(
  '/me/:examId',
  authenticate,
  attachActiveSession,
  enforceSchoolIsolation,
  requireRole(USER_ROLES.STUDENT),
  getMyResult
);

// GET /api/results/my-entered?examId=X - teacher checks entered subjects.
router.get(
  '/my-entered',
  authenticate,
  attachActiveSession,
  enforceSchoolIsolation,
  requireRole(USER_ROLES.TEACHER),
  getMyEnteredSubjects
);

router.get(
  '/:id/pdf',
  authenticate,
  enforceSchoolIsolation,
  getResultPDF
);

module.exports = router;
