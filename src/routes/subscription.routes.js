const express = require('express');
const {
  getSubscriptions,
  getSubscriptionBySchool,
  renewSubscription,
  suspendSubscription,
  getSubscriptionMetrics,
  getRevenueAnalytics,
  getBillingHistory,
  retryBilling,
  updatePlan,
  getFraudAlerts,
  resolveFraudAlert,
} = require('../controllers/subscription.controller');
const { requireRole } = require('../middlewares/role.middleware');
const { USER_ROLES } = require('../config/constants');

const router = express.Router();

router.use(requireRole(USER_ROLES.SUPER_ADMIN));

// ── Dashboard + list ───────────────────────────────────────────────────
router.get('/', getSubscriptions);
router.get('/metrics', getSubscriptionMetrics);
router.get('/analytics/revenue', getRevenueAnalytics);

// ── Fraud ──────────────────────────────────────────────────────────────
router.get('/fraud/alerts', getFraudAlerts);
router.post('/fraud/alerts/:alertId/resolve', resolveFraudAlert);

// ── Billing actions ────────────────────────────────────────────────────
router.post('/billing/retry', retryBilling);

// ── School-specific (must come after named routes) ─────────────────────
router.get('/:schoolId', getSubscriptionBySchool);
router.get('/:schoolId/billing-history', getBillingHistory);
router.put('/:schoolId/renew', renewSubscription);
router.put('/:schoolId/suspend', suspendSubscription);
router.put('/:schoolId/plan', updatePlan);

module.exports = router;

