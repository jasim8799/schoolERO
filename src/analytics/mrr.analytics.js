const School = require('../models/School');
const BillingHistory = require('../models/BillingHistory');
const TransactionLog = require('../models/TransactionLog');
const { PLAN_MRR, GST_RATE, safePlan } = require('../utils/revenueHelpers');

const GROSS_MARGIN = 0.74;
const NET_MARGIN = 0.49;
const GROWTH_RATE = 0.22;

async function calculateRealMRR() {
  const now = new Date();

  const activeSchools = await School.find({
    status: 'active',
    isDeleted: { $ne: true },
    'subscription.endDate': { $gt: new Date(now - 30 * 86400000) },
  }).select('plan subscription status').lean();

  const planCounts = { BASIC: 0, STANDARD: 0, PREMIUM: 0, ENTERPRISE: 0 };
  let totalMRR = 0;

  for (const school of activeSchools) {
    const plan = safePlan(school.plan);
    // FIX: Use database monthlyPrice, fallback to plan-based default
    // This ensures actual MRR matches each school's custom pricing
    const monthlyPrice = school.subscription?.monthlyPrice || PLAN_MRR[plan] || PLAN_MRR.BASIC;
    planCounts[plan] = (planCounts[plan] || 0) + 1;
    totalMRR += monthlyPrice;
  }

  const planBreakdown = {};
  for (const [plan, count] of Object.entries(planCounts)) {
    const mrr = count * PLAN_MRR[plan];
    planBreakdown[plan] = {
      count,
      mrr,
      arr: mrr * 12,
      schools: count,
      renewalRate: await _calculatePlanRenewalRate(plan),
    };
  }

  return {
    totalMRR,
    totalARR: totalMRR * 12,
    grossProfit: Math.round(totalMRR * GROSS_MARGIN),
    netProfit: Math.round(totalMRR * NET_MARGIN),
    forecastMRR: Math.round(totalMRR * (1 + GROWTH_RATE)),
    gstCollected: Math.round(totalMRR * GST_RATE),
    taxableRevenue: totalMRR,
    planBreakdown,
    activeSchools: activeSchools.length,
    avgRevenuePerSchool: activeSchools.length > 0
      ? Math.round(totalMRR / activeSchools.length)
      : 0,
  };
}

async function calculateBillingMRR() {
  const monthAgo = new Date(Date.now() - 30 * 86400000);

  const result = await BillingHistory.aggregate([
    { $match: { createdAt: { $gte: monthAgo } } },
    {
      $group: {
        _id: null,
        totalRevenue: {
          $sum: {
            $cond: [
              { $eq: ['$status', 'PAID'] },
              { $divide: ['$amount', 100] },
              0,
            ],
          },
        },
        totalTax: {
          $sum: {
            $cond: [
              { $eq: ['$status', 'PAID'] },
              { $divide: ['$tax', 100] },
              0,
            ],
          },
        },
        totalRefunds: {
          $sum: {
            $cond: [
              { $eq: ['$status', 'REFUNDED'] },
              { $divide: ['$amount', 100] },
              0,
            ],
          },
        },
        paymentCount: { $sum: { $cond: [{ $eq: ['$status', 'PAID'] }, 1, 0] } },
        failedCount: { $sum: { $cond: [{ $eq: ['$status', 'FAILED'] }, 1, 0] } },
      },
    },
  ]);

  return result[0] || {
    totalRevenue: 0,
    totalTax: 0,
    totalRefunds: 0,
    paymentCount: 0,
    failedCount: 0,
  };
}

async function _calculatePlanRenewalRate(plan) {
  try {
    const total = await School.countDocuments({ plan, isDeleted: { $ne: true } });
    const active = await School.countDocuments({
      plan,
      status: 'active',
      'subscription.endDate': { $gt: new Date() },
    });
    return total > 0 ? parseFloat((active / total).toFixed(2)) : 0.8;
  } catch (_) {
    return 0.8;
  }
}

async function getDailyTransactionStats() {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart.getTime() + 86400000);

  const [stats] = await TransactionLog.aggregate([
    { $match: { createdAt: { $gte: todayStart, $lt: todayEnd } } },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        paid: { $sum: { $cond: [{ $eq: ['$status', 'PAID'] }, 1, 0] } },
        failed: { $sum: { $cond: [{ $eq: ['$status', 'FAILED'] }, 1, 0] } },
        refunds: {
          $sum: {
            $cond: [
              { $or: [{ $eq: ['$status', 'REFUNDED'] }, { $eq: ['$type', 'REFUND'] }] },
              1,
              0,
            ],
          },
        },
        volume: {
          $sum: {
            $cond: [{ $eq: ['$status', 'PAID'] }, { $divide: ['$amount', 100] }, 0],
          },
        },
      },
    },
  ]).catch(() => [{}]);

  return {
    totalTransactionsToday: stats?.total || 0,
    successfulToday: stats?.paid || 0,
    failedToday: stats?.failed || 0,
    refundsToday: stats?.refunds || 0,
    volumeToday: stats?.volume || 0,
    paymentSuccessRate: stats?.total > 0
      ? parseFloat(((stats.paid / stats.total) * 100).toFixed(1))
      : 0,
  };
}

module.exports = { calculateRealMRR, calculateBillingMRR, getDailyTransactionStats };
