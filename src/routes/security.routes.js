const express = require('express');
const { getSecurityData, getSecurityEventById, blockThreat } = require('../controllers/security.controller');
const { authenticate } = require('../middlewares/auth.middleware');
const { requireRole } = require('../middlewares/role.middleware');
const { USER_ROLES } = require('../config/constants');

const router = express.Router();
router.use(authenticate);
router.use(requireRole(USER_ROLES.SUPER_ADMIN));

// GET /api/security           — full security dashboard
// Params: severity, search, limit
router.get('/', getSecurityData);

// POST /api/security/block    — block a threat (logs admin action)
// Must be before /:id to avoid route conflict
router.post('/block', blockThreat);

// GET /api/security/:id       — single threat event detail
router.get('/:id', getSecurityEventById);

module.exports = router;
