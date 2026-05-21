const express = require('express');
const router = express.Router();
const { authenticate } = require('../middlewares/auth.middleware');
const { requireRole } = require('../middlewares/role.middleware');
const { USER_ROLES } = require('../config/constants');
const ctrl = require('./revenue.controller');

router.use(authenticate);
router.use(requireRole(USER_ROLES.SUPER_ADMIN));

router.get('/', ctrl.getRevenue);
router.get('/metrics', ctrl.getRevenueMetrics);
router.get('/analytics', ctrl.getRevenueAnalytics);
router.get('/live-feed', ctrl.getLiveFeed);
router.get('/tax', ctrl.getTaxAnalytics);

router.post('/transactions/retry', ctrl.retryTransaction);

router.get('/:schoolId', ctrl.getRevenueBySchool);

module.exports = router;
