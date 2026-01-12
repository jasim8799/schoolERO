import express from 'express';
import { createParent, getAllParents, getParentById } from '../controllers/parent.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { requireMinRole } from '../middlewares/role.middleware.js';
import { USER_ROLES } from '../config/constants.js';

const router = express.Router();

// All parent routes require authentication
router.use(authenticate);

// POST /api/parents - Create parent (PRINCIPAL, OPERATOR)
router.post('/', requireMinRole(USER_ROLES.OPERATOR), createParent);

// GET /api/parents - Get all parents (PRINCIPAL, OPERATOR)
router.get('/', requireMinRole(USER_ROLES.OPERATOR), getAllParents);

// GET /api/parents/:id - Get parent by ID
router.get('/:id', requireMinRole(USER_ROLES.OPERATOR), getParentById);

export default router;
