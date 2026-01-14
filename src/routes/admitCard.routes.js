import express from 'express';
import { generateAdmitCard, getMyAdmitCard, getAdmitCardPDF } from '../controllers/admitCard.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { requireRole } from '../middlewares/role.middleware.js';
import { enforceSchoolIsolation } from '../middlewares/school.middleware.js';
import { USER_ROLES } from '../config/constants.js';

const router = express.Router();

router.post(
  '/generate',
  authenticate,
  enforceSchoolIsolation,
  requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR),
  generateAdmitCard
);

router.get(
  '/student/me',
  authenticate,
  enforceSchoolIsolation,
  requireRole(USER_ROLES.STUDENT, USER_ROLES.PARENT),
  getMyAdmitCard
);

router.get(
  '/:id/pdf',
  authenticate,
  enforceSchoolIsolation,
  getAdmitCardPDF
);

export default router;
