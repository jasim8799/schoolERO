const School = require('../models/School');
const TransactionLog = require('../models/TransactionLog');
const RevenueSnapshot = require('../models/RevenueSnapshot');
const RevenueGrowthHistory = require('../models/RevenueGrowthHistory');
const { HTTP_STATUS, USER_ROLES } = require('../config/constants');
const { logger } = require('../utils/logger');
const { enrichSchoolRevenue } = require('./revenue.enricher');
const { calculateRealMRR, calculateBillingMRR, getDailyTransactionStats } = require('../analytics/mrr.analytics');
const { generateRevenueForecast } = require('../analytics/forecast.engine');
const { calculateCashflowMetrics } = require('../analytics/cashflow.analytics');
const { calculateTaxSummary } = require('../analytics/tax.engine');
const {
  safePlan,
  relativeTime,
  redisGet,
  redisSetex,
} = require('../utils/revenueHelpers');

const GATEWAYS = ['Razorpay', 'Stripe', 'UPI', 'Bank'];

const getRevenue = async (req, res) => {
  try {
    if (req.user.role !== USER_ROLES.SUPER_ADMIN) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({
        success: false,
        message: 'Access denied. Super Admin only.',
      });
    }

    const { plan, status, gateway, search, limit = 100, page = 1 } = req.query;

    const cacheKey = `revenue:list:${plan || 'ALL'}:${status || 'ALL'}:${gateway || 'ALL'}:${page}:${search || ''}`;
    const cached = await redisGet(cacheKey);
    if (cached) {
      return res.json({ success: true, ...JSON.parse(cached), cached: true });
    }

    const query = { isDeleted: { $ne: true } };
    if (plan && plan !== 'ALL') query.plan = safePlan(plan);
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { code: { $regex: search, $options: 'i' } },
        { city: { $regex: search, $options: 'i' } },
      ];
    }

    const parsedLimit = parseInt(limit, 10);
    const parsedPage = parseInt(page, 10);
    const skip = (parsedPage - 1) * parsedLimit;

    const [schools, totalCount] = await Promise.all([
      School.find(query).sort({ updatedAt: -1 }).skip(skip).limit(parsedLimit).lean(),
      School.countDocuments(query),
    ]);

    let enriched = await Promise.all(schools.map((s) => enrichSchoolRevenue(s, false)));

    if (status && status !== 'ALL') {
      enriched = enriched.filter((r) => r.paymentStatus === String(status).toUpperCase());
    }
    if (gateway && gateway !== 'ALL') {
      enriched = enriched.filter((r) => r.gateway === gateway);
    }

    const [mrrData, billingData, dailyStats, forecast] = await Promise.all([
      calculateRealMRR(),
      calculateBillingMRR(),
      getDailyTransactionStats(),
      generateRevenueForecast(enriched.reduce((s, r) => s + (r.monthlyRevenue || 0), 0)),
    ]);

    const planBreakdown = {};
    for (const p of ['BASIC', 'STANDARD', 'PREMIUM', 'ENTERPRISE']) {
      const ps = enriched.filter((r) => r.plan === p);
      planBreakdown[p] = {
        count: ps.length,
        mrr: ps.reduce((s, r) => s + (r.monthlyRevenue || 0), 0),
        arr: ps.reduce((s, r) => s + (r.arr || 0), 0),
      };
    }

    const gatewayBreakdown = {};
    for (const gw of GATEWAYS) {
      const gs = enriched.filter((r) => r.gateway === gw);
      gatewayBreakdown[gw] = {
        count: gs.length,
        volume: gs.reduce((s, r) => s + (r.monthlyRevenue || 0), 0),
      };
    }

    const liveFeed = await _buildLiveFeed(enriched);
    const cashflowMetrics = calculateCashflowMetrics(enriched);

    const metrics = {
      totalMRR: mrrData.totalMRR,
      totalARR: mrrData.totalARR,
      grossProfit: mrrData.grossProfit,
      netProfit: mrrData.netProfit,
      forecastMRR: forecast.forecast30d,
      avgRevenuePerSchool: mrrData.avgRevenuePerSchool,
      totalFailedPayments: dailyStats.failedToday + enriched.reduce((s, r) => s + (r.failedTransactions || 0), 0),
      totalRefunds: enriched.reduce((s, r) => s + (r.refunds || 0), 0),
      pendingInvoices: enriched.filter((r) => r.paymentStatus === 'PENDING').length,
      totalTransactionsToday: dailyStats.totalTransactionsToday || enriched.reduce((s, r) => s + (r.transactionsToday || 0), 0),
      avgCashflow: cashflowMetrics.avgCashflow,
      avgBillingHealth: cashflowMetrics.avgBillingHealth,
      avgFraudScore: cashflowMetrics.avgFraudScore,

      planBreakdown,
      gatewayBreakdown,

      forecast: {
        ...forecast,
        growthProjection: forecast.growthRate,
        churnImpact: forecast.churnRisk / 100,
        paymentConfidence: forecast.paymentConfidence,
      },

      paymentSuccessRate: dailyStats.paymentSuccessRate,
      gstCollected: mrrData.gstCollected,
      activeSchools: mrrData.activeSchools,

      billingRevenue: billingData.totalRevenue,
      billingTax: billingData.totalTax,
      billingRefunds: billingData.totalRefunds,
    };

    const responsePayload = {
      count: enriched.length,
      totalCount,
      page: parsedPage,
      metrics,
      liveFeed,
      data: enriched,
    };

    await redisSetex(cacheKey, 30, JSON.stringify(responsePayload));

    return res.json({ success: true, ...responsePayload });
  } catch (error) {
    logger.error('[getRevenue]', error.message);
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error.message,
    });
  }
};

const getRevenueMetrics = async (req, res) => {
  try {
    if (req.user.role !== USER_ROLES.SUPER_ADMIN) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({ success: false, message: 'Access denied.' });
    }

    const cached = await redisGet('revenue:metrics:v2');
    if (cached) return res.json({ success: true, data: JSON.parse(cached), cached: true });

    const [mrrData, dailyStats, schools] = await Promise.all([
      calculateRealMRR(),
      getDailyTransactionStats(),
      School.find({ isDeleted: { $ne: true } }).lean(),
    ]);

    const enriched = await Promise.all(schools.map((s) => enrichSchoolRevenue(s, false)));
    const forecast = await generateRevenueForecast(mrrData.totalMRR);
    const cashflowMetrics = calculateCashflowMetrics(enriched);

    const result = {
      ...mrrData,
      ...dailyStats,
      forecastMRR: forecast.forecast30d,
      forecast,
      avgCashflow: cashflowMetrics.avgCashflow,
      avgBillingHealth: cashflowMetrics.avgBillingHealth,
      avgFraudScore: cashflowMetrics.avgFraudScore,
      pendingInvoices: enriched.filter((r) => r.paymentStatus === 'PENDING').length,
      totalRefunds: enriched.reduce((s, r) => s + (r.refunds || 0), 0),
      gatewayBreakdown: {
        Razorpay: enriched.filter((r) => r.gateway === 'Razorpay').length,
        Stripe: enriched.filter((r) => r.gateway === 'Stripe').length,
        UPI: enriched.filter((r) => r.gateway === 'UPI').length,
        Bank: enriched.filter((r) => r.gateway === 'Bank').length,
      },
      paymentBreakdown: {
        PAID: enriched.filter((r) => r.paymentStatus === 'PAID').length,
        PENDING: enriched.filter((r) => r.paymentStatus === 'PENDING').length,
        FAILED: enriched.filter((r) => r.paymentStatus === 'FAILED').length,
      },
    };

    await redisSetex('revenue:metrics:v2', 30, JSON.stringify(result));
    return res.json({ success: true, data: result });
  } catch (error) {
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ success: false, message: error.message });
  }
};

const getRevenueBySchool = async (req, res) => {
  try {
    if (req.user.role !== USER_ROLES.SUPER_ADMIN) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({ success: false, message: 'Access denied.' });
    }

    const school = await School.findById(req.params.schoolId).lean();
    if (!school) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ success: false, message: 'School not found' });
    }

    const enriched = await enrichSchoolRevenue(school, true);
    return res.json({ success: true, data: enriched });
  } catch (error) {
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ success: false, message: error.message });
  }
};

const getRevenueAnalytics = async (req, res) => {
  try {
    if (req.user.role !== USER_ROLES.SUPER_ADMIN) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({ success: false, message: 'Access denied.' });
    }

    const { days = 30 } = req.query;
    const from = new Date(Date.now() - parseInt(days, 10) * 86400000);

    const [snapshots, growthHistory, mrrData] = await Promise.all([
      RevenueSnapshot.find({ date: { $gte: from } }).sort({ date: 1 }).lean(),
      RevenueGrowthHistory.find({ weekStart: { $gte: from } }).sort({ weekStart: 1 }).lean(),
      calculateRealMRR(),
    ]);

    const forecast = await generateRevenueForecast(mrrData.totalMRR);

    return res.json({
      success: true,
      data: {
        dailyMRR: snapshots.map((s) => ({ date: s.date, mrr: s.totalMRR, arr: s.totalARR })),
        growthHistory: growthHistory.map((g) => ({
          week: g.weekStart,
          mrr: g.mrr,
          growthPct: g.netGrowthPct,
        })),
        mrrSeries: snapshots.map((s) => s.totalMRR),
        cashflowSeries: snapshots.map((s) => s.avgCashflow || 0),
        forecast,
        currentMRR: mrrData,
      },
    });
  } catch (error) {
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ success: false, message: error.message });
  }
};

const getLiveFeed = async (req, res) => {
  try {
    if (req.user.role !== USER_ROLES.SUPER_ADMIN) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({ success: false, message: 'Access denied.' });
    }

    const transactions = await TransactionLog.find()
      .sort({ createdAt: -1 })
      .limit(20)
      .populate('schoolId', 'name code')
      .lean();

    const feed = transactions.map((t) => ({
      school: t.schoolId?.name || t.schoolName || 'Unknown',
      amount: `INR ${(Number(t.amount || 0) / 100).toLocaleString()}`,
      gateway: t.gateway,
      transactionId: t.transactionId,
      status: t.status,
      risk: t.riskLevel,
      timestamp: relativeTime(t.createdAt),
      reconciled: t.isReconciled,
    }));

    return res.json({ success: true, data: feed });
  } catch (error) {
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ success: false, message: error.message });
  }
};

const getTaxAnalytics = async (req, res) => {
  try {
    if (req.user.role !== USER_ROLES.SUPER_ADMIN) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({ success: false, message: 'Access denied.' });
    }

    const mrrData = await calculateRealMRR();
    const taxSummary = calculateTaxSummary(mrrData.totalMRR, mrrData.planBreakdown);

    return res.json({ success: true, data: taxSummary });
  } catch (error) {
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ success: false, message: error.message });
  }
};

const retryTransaction = async (req, res) => {
  try {
    if (req.user.role !== USER_ROLES.SUPER_ADMIN) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({ success: false, message: 'Access denied.' });
    }

    const { transactionId } = req.body;
    if (!transactionId) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ success: false, message: 'transactionId required' });
    }

    await TransactionLog.findOneAndUpdate(
      { transactionId },
      { $inc: { retryCount: 1 }, status: 'PENDING' },
    );

    return res.json({ success: true, message: `Transaction ${transactionId} queued for retry` });
  } catch (error) {
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ success: false, message: error.message });
  }
};

async function _buildLiveFeed(enriched) {
  try {
    const recentTx = await TransactionLog.find()
      .sort({ createdAt: -1 })
      .limit(10)
      .populate('schoolId', 'name code')
      .lean();

    if (recentTx.length > 0) {
      return recentTx.map((t) => ({
        school: t.schoolId?.name || t.schoolName || 'School',
        amount: `INR ${(Number(t.amount || 0) / 100).toLocaleString()}`,
        gateway: t.gateway,
        transactionId: t.transactionId,
        status: t.status,
        risk: t.riskLevel,
        timestamp: relativeTime(t.createdAt),
      }));
    }
  } catch (_) {}

  return enriched.slice(0, 10).map((r, i) => ({
    school: r.schoolName,
    amount: `INR ${Number(r.monthlyRevenue || 0).toLocaleString()}`,
    gateway: r.gateway,
    transactionId: `TXN-${r._id.toString().slice(-5).toUpperCase()}`,
    status: r.paymentStatus,
    risk: r.fraudScore > 0.6 ? 'HIGH' : r.fraudScore > 0.3 ? 'MEDIUM' : 'LOW',
    timestamp: `${(i + 1) * 3}m ago`,
  }));
}

module.exports = {
  getRevenue,
  getRevenueBySchool,
  getRevenueMetrics,
  getRevenueAnalytics,
  getLiveFeed,
  getTaxAnalytics,
  retryTransaction,
};
