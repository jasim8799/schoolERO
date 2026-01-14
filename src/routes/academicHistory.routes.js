import express from 'express';
import { authenticate } from '../middlewares/auth.middleware.js';
import { enforceSchoolIsolation } from '../middlewares/school.middleware.js';
import { requireRole } from '../middlewares/role.middleware.js';
import { getStudentAcademicHistory } from '../controllers/academicHistory.controller.js';
import { USER_ROLES } from '../config/constants.js';

const router = express.Router();

router.get('/student/:studentId', authenticate, enforceSchoolIsolation, requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR, USER_ROLES.TEACHER, USER_ROLES.STUDENT, USER_ROLES.PARENT), getStudentAcademicHistory);

export default router;
