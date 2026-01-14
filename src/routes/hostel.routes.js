import express from 'express';
import { authenticate } from '../middlewares/auth.middleware.js';
import { enforceSchoolIsolation } from '../middlewares/school.middleware.js';
import { requireRole } from '../middlewares/role.middleware.js';
import { createHostel, getHostels } from '../controllers/hostel.controller.js';
import { USER_ROLES } from '../config/constants.js';

const router = express.Router();

router.post('/', authenticate, enforceSchoolIsolation, requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR), createHostel);
router.get('/', authenticate, enforceSchoolIsolation, requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR), getHostels);

export default router;
