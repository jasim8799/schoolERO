const express = require('express');
const { getActivityFeed, getActivityById } = require('../controllers/activity.controller');
const { authenticate } = require('../middlewares/auth.middleware');
const { requireRole } = require('../middlewares/role.middleware');
const { USER_ROLES } = require('../config/constants');

const router = express.Router();

router.use(authenticate);
router.use(requireRole(USER_ROLES.SUPER_ADMIN));

// GET /api/activity           — feed with metrics + threats + timeline
// Params: severity, status, sort, search, limit, page
router.get('/', getActivityFeed);

// GET /api/activity/:id       — single event detail
router.get('/:id', getActivityById);

module.exports = router;
