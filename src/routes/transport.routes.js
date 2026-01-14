import express from 'express';
import { authenticate } from '../middlewares/auth.middleware.js';
import { enforceSchoolIsolation } from '../middlewares/school.middleware.js';
import { requireRole } from '../middlewares/role.middleware.js';
import { createVehicle, getVehicles, createRoute, getRoutes } from '../controllers/transport.controller.js';
import { USER_ROLES } from '../config/constants.js';

const router = express.Router();

router.post('/vehicles', authenticate, enforceSchoolIsolation, requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR), createVehicle);
router.get('/vehicles', authenticate, enforceSchoolIsolation, requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR, USER_ROLES.TEACHER, USER_ROLES.STUDENT, USER_ROLES.PARENT), getVehicles);
router.post('/routes', authenticate, enforceSchoolIsolation, requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR), createRoute);
router.get('/routes', authenticate, enforceSchoolIsolation, requireRole(USER_ROLES.PRINCIPAL, USER_ROLES.OPERATOR, USER_ROLES.TEACHER, USER_ROLES.STUDENT, USER_ROLES.PARENT), getRoutes);

export default router;
