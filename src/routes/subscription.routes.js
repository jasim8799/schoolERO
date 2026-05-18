const express = require('express');
const {
  getSubscriptions,
  getSubscriptionBySchool,
  renewSubscription,
  suspendSubscription,
  getSubscriptionMetrics,
} = require('../controllers/subscription.controller');
const { authenticate } = require('../middlewares/auth.middleware');
const { requireRole } = require('../middlewares/role.middleware');
const { USER_ROLES } = require('../config/constants');

const router = express.Router();

router.use(authenticate);
router.use(requireRole(USER_ROLES.SUPER_ADMIN));

// GET /api/subscriptions - list all with filters + metrics
router.get('/', getSubscriptions);

// GET /api/subscriptions/metrics - aggregated dashboard metrics
router.get('/metrics', getSubscriptionMetrics);

// GET /api/subscriptions/:schoolId - single school subscription detail
router.get('/:schoolId', getSubscriptionBySchool);

// PUT /api/subscriptions/:schoolId/renew - renew subscription
router.put('/:schoolId/renew', renewSubscription);

// PUT /api/subscriptions/:schoolId/suspend - toggle suspend/activate
router.put('/:schoolId/suspend', suspendSubscription);

module.exports = router;
