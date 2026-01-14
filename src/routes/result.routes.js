import express from 'express';
import { createOrUpdateResult, publishResult, getMyResult, getResultPDF } from '../controllers/result.controller.js';
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
  '/student/me',
  authenticate,
  enforceSchoolIsolation,
  requireRole(USER_ROLES.STUDENT, USER_ROLES.PARENT),
  getMyResult
);

router.get(
  '/:id/pdf',
  authenticate,
  enforceSchoolIsolation,
  getResultPDF
);

export default router;
