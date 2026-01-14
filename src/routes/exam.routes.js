import express from 'express';
import { createExam, getExamsByClass } from '../controllers/exam.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { requireRole } from '../middlewares/role.middleware.js';
import { enforceSchoolIsolation } from '../middlewares/school.middleware.js';
import { USER_ROLES } from '../config/constants.js';

const router = express.Router();

router.post(
  '/',
  authenticate,
  enforceSchoolIsolation,
  requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR),
  createExam
);

router.get(
  '/',
  authenticate,
  enforceSchoolIsolation,
  requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR, USER_ROLES.TEACHER),
  getExamsByClass
);

export default router;
