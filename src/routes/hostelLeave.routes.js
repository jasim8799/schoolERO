import express from 'express';
import { authenticate } from '../middlewares/auth.middleware.js';
import { enforceSchoolIsolation } from '../middlewares/school.middleware.js';
import { requireRole } from '../middlewares/role.middleware.js';
import { createLeave, approveLeave, getLeaves, getHostelFees } from '../controllers/hostelLeave.controller.js';
import { USER_ROLES } from '../config/constants.js';

const router = express.Router();

router.post('/leaves', authenticate, enforceSchoolIsolation, createLeave);
router.put('/leaves/approve/:id', authenticate, enforceSchoolIsolation, requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR), approveLeave);
router.get('/leaves/student/:id', authenticate, enforceSchoolIsolation, getLeaves);
router.get('/fees/student/:id', authenticate, enforceSchoolIsolation, getHostelFees);

export default router;
