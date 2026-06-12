const express = require('express');
const {
  getSubscriptions,
  getSubscriptionBySchool,
  renewSubscription,
  getSubscriptionHistory,  // PHASE 8: Get renewal history
  updateSubscriptionPlan,  // PHASE 3: Edit subscription plan
  suspendSubscription,
  getSubscriptionMetrics,
} = require('../controllers/subscription.controller');
const { authenticate } = require('../middlewares/auth.middleware');
const { requireRole } = require('../middlewares/role.middleware');
const { USER_ROLES } = require('../config/constants');

const router = express.Router();

// All routes require authentication and SUPER_ADMIN role
router.use(authenticate);
router.use(requireRole(USER_ROLES.SUPER_ADMIN));

// GET /api/subscriptions — list all with filters + metrics
// Params: plan, status, payment, search, limit, page
router.get('/', getSubscriptions);

// GET /api/subscriptions/metrics — aggregated dashboard metrics
router.get('/metrics', getSubscriptionMetrics);

// PHASE 8: GET /api/subscriptions/:schoolId/history — renewal history (must be BEFORE /:schoolId)
router.get('/:schoolId/history', getSubscriptionHistory);

// GET /api/subscriptions/:schoolId — single school subscription detail
router.get('/:schoolId', getSubscriptionBySchool);

// PUT /api/subscriptions/:schoolId/renew — renew subscription
router.put('/:schoolId/renew', renewSubscription);

// PUT /api/subscriptions/:schoolId/plan — edit subscription plan & price (PHASE 3)
router.put('/:schoolId/plan', updateSubscriptionPlan);

// PUT /api/subscriptions/:schoolId/suspend — toggle suspend/activate
router.put('/:schoolId/suspend', suspendSubscription);

module.exports = router;
