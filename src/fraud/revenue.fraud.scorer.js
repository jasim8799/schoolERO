const AuditLog = require('../models/AuditLog');
const BillingHistory = require('../models/BillingHistory');
const TransactionLog = require('../models/TransactionLog');

const FRAUD_WEIGHTS = {
  failedPayments: 0.30,
  failedLogins: 0.20,
  refundRate: 0.15,
  paymentRetries: 0.15,
  subscriptionExpiry: 0.10,
  unusualVolume: 0.10,
};

async function calculateRevenueFraudScore(schoolId, school) {
  const monthAgo = new Date(Date.now() - 30 * 86400000);
  const weekAgo = new Date(Date.now() - 7 * 86400000);

  let totalScore = 0;
  const signals = {};

  try {
    const [failedPayments, failedLogins, refundCount, paymentRetries] = await Promise.all([
      BillingHistory.countDocuments({ schoolId, status: 'FAILED', createdAt: { $gte: monthAgo } }),
      AuditLog.countDocuments({
        schoolId,
        action: { $in: ['LOGIN_FAILED', 'INVALID_TOKEN'] },
        createdAt: { $gte: monthAgo },
      }),
      BillingHistory.countDocuments({
        schoolId,
        status: 'REFUNDED',
        createdAt: { $gte: monthAgo },
      }),
      TransactionLog.countDocuments({ schoolId, retryCount: { $gt: 1 }, createdAt: { $gte: weekAgo } }),
    ]);

    const fpScore = failedPayments > 3 ? 1.0 : failedPayments > 1 ? 0.6 : failedPayments > 0 ? 0.3 : 0;
    signals.failedPayments = { count: failedPayments, score: fpScore };
    totalScore += fpScore * FRAUD_WEIGHTS.failedPayments;

    const flScore = failedLogins > 20 ? 1.0 : failedLogins > 10 ? 0.7 : failedLogins > 5 ? 0.4 : 0;
    signals.failedLogins = { count: failedLogins, score: flScore };
    totalScore += flScore * FRAUD_WEIGHTS.failedLogins;

    const totalBilling = await BillingHistory.countDocuments({ schoolId, createdAt: { $gte: monthAgo } });
    const refundRate = totalBilling > 0 ? refundCount / totalBilling : 0;
    const rrScore = refundRate > 0.3 ? 1.0 : refundRate > 0.1 ? 0.5 : refundRate > 0 ? 0.2 : 0;
    signals.refundRate = { count: refundCount, rate: refundRate, score: rrScore };
    totalScore += rrScore * FRAUD_WEIGHTS.refundRate;

    const prScore = paymentRetries > 5 ? 0.8 : paymentRetries > 2 ? 0.4 : 0;
    signals.paymentRetries = { count: paymentRetries, score: prScore };
    totalScore += prScore * FRAUD_WEIGHTS.paymentRetries;

    const daysLeft = school.subscription?.endDate
      ? Math.ceil((new Date(school.subscription.endDate) - new Date()) / 86400000)
      : 0;
    const expiryScore = daysLeft < 0 ? 1.0 : daysLeft < 3 ? 0.7 : daysLeft < 7 ? 0.4 : 0;
    signals.subscriptionExpiry = { daysLeft, score: expiryScore };
    totalScore += expiryScore * FRAUD_WEIGHTS.subscriptionExpiry;

    const volumeAgg = await TransactionLog.aggregate([
      { $match: { schoolId, createdAt: { $gte: weekAgo }, status: 'PAID' } },
      { $group: { _id: null, volume: { $sum: { $divide: ['$amount', 100] } } } },
    ]);
    const weekVolume = volumeAgg[0]?.volume || 0;
    const uvScore = weekVolume > 200000 ? 1.0 : weekVolume > 100000 ? 0.6 : weekVolume > 50000 ? 0.3 : 0;
    signals.unusualVolume = { volume: weekVolume, score: uvScore };
    totalScore += uvScore * FRAUD_WEIGHTS.unusualVolume;
  } catch (err) {
    console.error('[RevenueFraudScorer] Error:', err.message);
  }

  const finalScore = Math.min(1.0, parseFloat(totalScore.toFixed(3)));
  const riskLevel = finalScore > 0.7 ? 'HIGH' : finalScore > 0.4 ? 'MEDIUM' : 'LOW';

  return { score: finalScore, riskLevel, signals };
}

function calculateCashflowHealth(paymentStatus, fraudScore, billingHistoryCount, failedCount) {
  let health = 1.0;
  if (paymentStatus === 'FAILED') health -= 0.55;
  else if (paymentStatus === 'PENDING') health -= 0.25;
  health -= fraudScore * 0.3;
  const failRate = billingHistoryCount > 0 ? failedCount / billingHistoryCount : 0;
  health -= failRate * 0.2;
  return Math.max(0.1, Math.min(1.0, parseFloat(health.toFixed(2))));
}

module.exports = { calculateRevenueFraudScore, calculateCashflowHealth };
