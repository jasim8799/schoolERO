import express from 'express';
import { createClass, getAllClasses, getClassById } from '../controllers/class.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { requireMinRole } from '../middlewares/role.middleware.js';
import { USER_ROLES } from '../config/constants.js';

const router = express.Router();

// All class routes require authentication
router.use(authenticate);

// POST /api/classes - Create class (SUPER_ADMIN, PRINCIPAL, OPERATOR)
router.post('/', requireMinRole(USER_ROLES.OPERATOR), createClass);

// GET /api/classes - Get all classes (SUPER_ADMIN, PRINCIPAL, OPERATOR)
router.get('/', requireMinRole(USER_ROLES.OPERATOR), getAllClasses);

// GET /api/classes/:id - Get class by ID
router.get('/:id', requireMinRole(USER_ROLES.OPERATOR), getClassById);

export default router;
