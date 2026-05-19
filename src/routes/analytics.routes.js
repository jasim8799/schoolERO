const express = require('express');
const {
  getAnalytics,
  getModuleAnalytics,
} = require('../controllers/analytics.controller');
const { authenticate } = require('../middlewares/auth.middleware');
const { requireRole } = require('../middlewares/role.middleware');
const { USER_ROLES } = require('../config/constants');

const router = express.Router();

router.use(authenticate);
router.use(requireRole(USER_ROLES.SUPER_ADMIN));

// GET /api/analytics - full analytics dashboard (query: status, sort)
router.get('/', getAnalytics);

// GET /api/analytics/module/:key - single module detail
router.get('/module/:key', getModuleAnalytics);

module.exports = router;
