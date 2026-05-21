const SecurityLog = require('../models/SecurityLog');
const AuditLog = require('../models/AuditLog');
const BillingHistory = require('../models/BillingHistory');
const redis = require('../config/redis');

// Weighted signal scoring for threatScore (0.0 to 1.0)
const SIGNAL_WEIGHTS = {
  failedPayments:     0.25,  // Failed payment count in 30 days
  failedLogins:       0.20,  // Failed login attempts
  apiAbuse:           0.15,  // API requests > plan limit
  subscriptionExpiry: 0.15,  // Days overdue
  rapidPlanSwitch:    0.10,  // Plan changes in 30 days
  unusualLocation:    0.10,  // Geo anomaly
  concurrentSessions: 0.05,  // Too many concurrent sessions
};

async function calculateThreatScore(schoolId, school) {
  const now = new Date();
  const monthAgo = new Date(now - 30 * 86400000);

  let totalScore = 0;
  const signals = {};

  try {
    const [
      failedPayments,
      failedLogins,
      planChanges,
      apiCountRaw,
    ] = await Promise.all([
      BillingHistory.countDocuments({
        schoolId, status: 'FAILED', createdAt: { $gte: monthAgo },
      }),
      AuditLog.countDocuments({
        schoolId, action: { $in: ['LOGIN_FAILED', 'INVALID_TOKEN'] }, createdAt: { $gte: monthAgo },
      }),
      AuditLog.countDocuments({
        schoolId, action: 'SCHOOL_PLAN_UPDATED', createdAt: { $gte: monthAgo },
      }),
      redis.connection.get(`apiRequests:${schoolId}:${now.toISOString().split('T')[0]}`).catch(() => '0'),
    ]);

    // ── Failed payments signal ─────────────────────────────────────────
    const failedPayScore = failedPayments > 3 ? 1.0 : failedPayments > 1 ? 0.6 : failedPayments > 0 ? 0.3 : 0;
    signals.failedPayments = { count: failedPayments, score: failedPayScore };
    totalScore += failedPayScore * SIGNAL_WEIGHTS.failedPayments;

    // ── Failed logins / brute force signal ────────────────────────────
    const loginScore = failedLogins > 20 ? 1.0 : failedLogins > 10 ? 0.7 : failedLogins > 5 ? 0.4 : 0;
    signals.failedLogins = { count: failedLogins, score: loginScore };
    totalScore += loginScore * SIGNAL_WEIGHTS.failedLogins;

    // ── API abuse signal ──────────────────────────────────────────────
    const apiLimit = _planApiLimit(school.plan);
    const apiCount = parseInt(apiCountRaw || '0', 10);
    const apiScore = apiCount > apiLimit * 2 ? 1.0 : apiCount > apiLimit ? 0.5 : 0;
    signals.apiAbuse = { count: apiCount, limit: apiLimit, score: apiScore };
    totalScore += apiScore * SIGNAL_WEIGHTS.apiAbuse;

    // ── Subscription expiry signal ────────────────────────────────────
    const daysLeft = school.daysRemaining || 0;
    const expiryScore = daysLeft < 0 ? 1.0 : daysLeft < 3 ? 0.8 : daysLeft < 7 ? 0.5 : daysLeft < 14 ? 0.2 : 0;
    signals.subscriptionExpiry = { daysLeft, score: expiryScore };
    totalScore += expiryScore * SIGNAL_WEIGHTS.subscriptionExpiry;

    // ── Rapid plan switching ──────────────────────────────────────────
    const planScore = planChanges > 2 ? 0.8 : planChanges > 0 ? 0.3 : 0;
    signals.rapidPlanSwitch = { count: planChanges, score: planScore };
    totalScore += planScore * SIGNAL_WEIGHTS.rapidPlanSwitch;

  } catch (err) {
    console.error('[threatScorer] Error:', err.message);
  }

  const finalScore = Math.min(1.0, parseFloat(totalScore.toFixed(3)));
  const severity = finalScore > 0.75 ? 'HIGH' : finalScore > 0.45 ? 'MEDIUM' : 'LOW';

  return { score: finalScore, severity, signals };
}

function _planApiLimit(plan) {
  const limits = { BASIC: 50000, STANDARD: 150000, PREMIUM: 500000, ENTERPRISE: 2000000 };
  return limits[(plan || 'BASIC').toUpperCase()] || 50000;
}

module.exports = { calculateThreatScore };
