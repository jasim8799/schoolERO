import express from 'express';
import { authenticate } from '../middlewares/auth.middleware.js';
import { enforceSchoolIsolation } from '../middlewares/school.middleware.js';
import { requireRole } from '../middlewares/role.middleware.js';
import { previewPromotion, executePromotion } from '../controllers/promotion.controller.js';
import { USER_ROLES } from '../config/constants.js';

const router = express.Router();

router.post('/preview', authenticate, enforceSchoolIsolation, requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR), previewPromotion);
router.post('/execute', authenticate, enforceSchoolIsolation, requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR), executePromotion);

export default router;
