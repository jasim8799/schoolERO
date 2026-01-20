import express from 'express';
import { createExamSubject, getExamSubjects } from '../controllers/examSubject.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { requireRole } from '../middlewares/role.middleware.js';
import { enforceSchoolIsolation } from '../middlewares/school.middleware.js';
import { USER_ROLES } from '../config/constants.js';

const router = express.Router();

router.post(
  '/:examId/subjects',
  authenticate,
  enforceSchoolIsolation,
  requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR),
  createExamSubject
);

router.get(
  '/:examId/subjects',
  authenticate,
  enforceSchoolIsolation,
  requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR, USER_ROLES.TEACHER),
  getExamSubjects
);

export default router;
