const express = require('express');
const {
  getRevenue,
  getRevenueBySchool,
  getRevenueMetrics,
} = require('../controllers/revenue.controller');
const { authenticate } = require('../middlewares/auth.middleware');
const { requireRole } = require('../middlewares/role.middleware');
const { USER_ROLES } = require('../config/constants');

const router = express.Router();

router.use(authenticate);
router.use(requireRole(USER_ROLES.SUPER_ADMIN));

// GET /api/revenue            - list all schools with revenue + metrics
// Params: plan, status, gateway, search, limit, page
router.get('/', getRevenue);

// GET /api/revenue/metrics    - aggregated metrics only
router.get('/metrics', getRevenueMetrics);

// GET /api/revenue/:schoolId  - single school revenue detail
router.get('/:schoolId', getRevenueBySchool);

module.exports = router;
