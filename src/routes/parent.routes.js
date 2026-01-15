const express = require('express');
const { createParent, getAllParents, getParentById, getMyChildren } = require('../controllers/parent.controller.js');
const { authenticate } = require('../middlewares/auth.middleware.js');
const { requireMinRole } = require('../middlewares/role.middleware.js');
const { USER_ROLES } = require('../config/constants.js');

const router = express.Router();

// All parent routes require authentication
router.use(authenticate);

// POST /api/parents - Create parent (PRINCIPAL, OPERATOR)
router.post('/', requireMinRole(USER_ROLES.OPERATOR), createParent);

// GET /api/parents - Get all parents (PRINCIPAL, OPERATOR)
router.get('/', requireMinRole(USER_ROLES.OPERATOR), getAllParents);

// GET /api/parents/:id - Get parent by ID
router.get('/:id', requireMinRole(USER_ROLES.OPERATOR), getParentById);

// GET /api/parents/me/children - Get current parent's children (PARENT only)
router.get('/me/children', getMyChildren);

module.exports = router;
