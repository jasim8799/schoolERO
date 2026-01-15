const express = require('express');
const { createSection, getAllSections, getSectionById } = require('../controllers/section.controller.js');
const { authenticate } = require('../middlewares/auth.middleware.js');
const { requireMinRole } = require('../middlewares/role.middleware.js');
const { USER_ROLES } = require('../config/constants.js');

const router = express.Router();

// All section routes require authentication
router.use(authenticate);

// POST /api/sections - Create section (PRINCIPAL, OPERATOR)
router.post('/', requireMinRole(USER_ROLES.OPERATOR), createSection);

// GET /api/sections - Get all sections (PRINCIPAL, OPERATOR)
router.get('/', requireMinRole(USER_ROLES.OPERATOR), getAllSections);

// GET /api/sections/:id - Get section by ID
router.get('/:id', requireMinRole(USER_ROLES.OPERATOR), getSectionById);

module.exports = router;
