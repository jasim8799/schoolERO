import express from 'express';
import { createSection, getAllSections, getSectionById } from '../controllers/section.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { requireMinRole } from '../middlewares/role.middleware.js';
import { USER_ROLES } from '../config/constants.js';

const router = express.Router();

// All section routes require authentication
router.use(authenticate);

// POST /api/sections - Create section (PRINCIPAL, OPERATOR)
router.post('/', requireMinRole(USER_ROLES.OPERATOR), createSection);

// GET /api/sections - Get all sections (PRINCIPAL, OPERATOR)
router.get('/', requireMinRole(USER_ROLES.OPERATOR), getAllSections);

// GET /api/sections/:id - Get section by ID
router.get('/:id', requireMinRole(USER_ROLES.OPERATOR), getSectionById);

export default router;
