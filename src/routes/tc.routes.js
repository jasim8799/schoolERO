import express from 'express';
import { authenticate } from '../middlewares/auth.middleware.js';
import { enforceSchoolIsolation } from '../middlewares/school.middleware.js';
import { requireRole } from '../middlewares/role.middleware.js';
import { issueTC, getStudentTC } from '../controllers/tc.controller.js';
import { USER_ROLES } from '../config/constants.js';

const router = express.Router();

router.post('/issue', authenticate, enforceSchoolIsolation, requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR), issueTC);
router.get('/student/:studentId', authenticate, enforceSchoolIsolation, requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR, USER_ROLES.STUDENT, USER_ROLES.PARENT), getStudentTC);

export default router;
