import express from 'express';
import { authenticate } from '../middlewares/auth.middleware.js';
import { enforceSchoolIsolation } from '../middlewares/school.middleware.js';
import { requireRole } from '../middlewares/role.middleware.js';
import { createHomework, getHomeworkByClass, getHomeworkForStudent } from '../controllers/homework.controller.js';
import { USER_ROLES } from '../config/constants.js';

const router = express.Router();

router.post('/', authenticate, enforceSchoolIsolation, requireRole(USER_ROLES.TEACHER, USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR), createHomework);
router.get('/class', authenticate, enforceSchoolIsolation, requireRole(USER_ROLES.TEACHER, USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR), getHomeworkByClass);
router.get('/student/me', authenticate, enforceSchoolIsolation, requireRole(USER_ROLES.STUDENT, USER_ROLES.PARENT), getHomeworkForStudent);

export default router;
