import express from 'express';
import { authenticate } from '../middlewares/auth.middleware.js';
import { enforceSchoolIsolation } from '../middlewares/school.middleware.js';
import { requireRole } from '../middlewares/role.middleware.js';
import { assignTransport, getStudentTransport } from '../controllers/studentTransport.controller.js';
import { USER_ROLES } from '../config/constants.js';

const router = express.Router();

router.post('/assign', authenticate, enforceSchoolIsolation, requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR), assignTransport);
router.get('/student/:id', authenticate, enforceSchoolIsolation, getStudentTransport);

export default router;
