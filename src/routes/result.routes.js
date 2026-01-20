import express from 'express';
import { createOrUpdateResult, publishResult, getMyResult, getResultPDF, getResultsByExam, getChildrenResults, getMyResults } from '../controllers/result.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { requireRole } from '../middlewares/role.middleware.js';
import { enforceSchoolIsolation } from '../middlewares/school.middleware.js';
import { USER_ROLES } from '../config/constants.js';

const router = express.Router();

router.post(
  '/',
  authenticate,
  enforceSchoolIsolation,
  requireRole(USER_ROLES.TEACHER),
  createOrUpdateResult
);

router.put(
  '/publish',
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
  '/:id/pdf',
  authenticate,
  enforceSchoolIsolation,
  getResultPDF
);

export default router;
