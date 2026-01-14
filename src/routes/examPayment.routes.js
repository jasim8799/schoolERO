import express from 'express';
import { payExamFee, manualExamPayment, getMyExamPayments } from '../controllers/examPayment.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { requireRole } from '../middlewares/role.middleware.js';
import { enforceSchoolIsolation } from '../middlewares/school.middleware.js';
import { USER_ROLES } from '../config/constants.js';

const router = express.Router();

router.post(
  '/pay',
  authenticate,
  enforceSchoolIsolation,
  requireRole(USER_ROLES.PARENT),
  payExamFee
);

router.post(
  '/manual',
  authenticate,
  enforceSchoolIsolation,
  requireRole(USER_ROLES.OPERATOR, USER_ROLES.PRINCIPAL),
  manualExamPayment
);

router.get(
  '/student/me',
  authenticate,
  enforceSchoolIsolation,
  requireRole(USER_ROLES.STUDENT, USER_ROLES.PARENT),
  getMyExamPayments
);

export default router;
