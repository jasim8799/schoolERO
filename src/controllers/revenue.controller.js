const School = require('../models/School');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const { HTTP_STATUS, USER_ROLES } = require('../config/constants');
const { logger } = require('../utils/logger');

// -- Plan-based revenue config -------------------------------------------------
const PLAN_MRR = {
  BASIC: 9000,
  STANDARD: 18000,
  PREMIUM: 32000,
  ENTERPRISE: 58000,
};

const GATEWAYS = ['Razorpay', 'Stripe', 'UPI', 'Bank'];

function _gateway(school) {
  // Deterministic gateway selection based on school code hash
  const hash = school.code
    ? school.code.split('').reduce((a, c) => a + c.charCodeAt(0), 0)
    : 0;
  return GATEWAYS[hash % GATEWAYS.length];
}

function _paymentStatus(school) {
  if (!school.subscription?.endDate) return 'PENDING';
  const now = new Date();
  const end = new Date(school.subscription.endDate);
  const daysLeft = Math.ceil((end - now) / (1000 * 60 * 60 * 24));
  if (daysLeft < 0) return 'FAILED';
  if (daysLeft < 7) return 'PENDING';
  return 'PAID';
}

function _fraudScore(failedLogins, paymentStatus) {
  let score = 0;
  if (failedLogins > 10) score += 0.4;
  else if (failedLogins > 5) score += 0.2;
  if (paymentStatus === 'FAILED') score += 0.35;
  else if (paymentStatus === 'PENDING') score += 0.15;
  return Math.min(1.0, parseFloat(score.toFixed(2)));
}

function _billingHealth(paymentStatus, fraudScore) {
  if (paymentStatus === 'FAILED') return 0.25;
  if (paymentStatus === 'PENDING') return 0.62;
  return parseFloat(Math.max(0.55, 1 - fraudScore * 0.6).toFixed(2));
}

function _cashflow(paymentStatus, billingHealth) {
  if (paymentStatus === 'FAILED') return 0.2;
  return parseFloat((billingHealth * 0.96).toFixed(2));
}

async function _enrichSchoolRevenue(school) {
  const plan = (school.plan || 'BASIC').toUpperCase();
  const monthlyRevenue = PLAN_MRR[plan] || 9000;
  const paymentStatus = _paymentStatus(school);

  let failedLogins = 0;
  let activeUsers = 0;
  try {
    const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    [failedLogins, activeUsers] = await Promise.all([
      AuditLog.countDocuments({
        schoolId: school._id,
        action: { $in: ['LOGIN_FAILED', 'INVALID_TOKEN'] },
        createdAt: { $gte: monthAgo },
      }),
      User.countDocuments({ schoolId: school._id, status: 'active' }),
    ]);
  } catch (_) {}

  const fraudScore = _fraudScore(failedLogins, paymentStatus);
  const billingHealth = _billingHealth(paymentStatus, fraudScore);
  const cashflow = _cashflow(paymentStatus, billingHealth);
  const gateway = _gateway(school);
  const transactionsToday = Math.max(5, Math.floor(activeUsers * 0.18));
  const failedTransactions = paymentStatus === 'FAILED'
    ? Math.floor(transactionsToday * 0.3)
    : paymentStatus === 'PENDING'
      ? Math.floor(transactionsToday * 0.08)
      : Math.max(0, Math.floor(fraudScore * 5));
  const refunds = paymentStatus === 'FAILED' ? Math.floor(Math.random() * 3) : 0;

  return {
    _id: school._id.toString(),
    schoolName: school.name,
    schoolCode: school.code,
    region: school.city || school.address?.split(',').pop()?.trim() || 'India',
    plan,
    monthlyRevenue,
    arr: monthlyRevenue * 12,
    billingHealth,
    paymentStatus,
    activeUsers,
    transactionsToday,
    failedTransactions,
    refunds,
    gateway,
    fraudScore,
    cashflow,
    subscription: school.subscription,
    createdAt: school.createdAt,
    updatedAt: school.updatedAt,
  };
}

// -- GET /api/revenue ----------------------------------------------------------

const getRevenue = async (req, res) => {
  try {
    if (req.user.role !== USER_ROLES.SUPER_ADMIN) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({ success: false, message: 'Access denied. Super Admin only.' });
    }

    const { plan, status, gateway, search, limit = 100, page = 1 } = req.query;

    const query = {};
    if (plan && plan !== 'ALL') query.plan = plan.toUpperCase();
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { code: { $regex: search, $options: 'i' } },
      ];
    }

    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const [schools, totalCount] = await Promise.all([
      School.find(query).sort({ updatedAt: -1 }).skip(skip).limit(parseInt(limit, 10)).lean(),
      School.countDocuments(query),
    ]);

    let enriched = await Promise.all(schools.map(_enrichSchoolRevenue));

    // Client-side filters for derived fields
    if (status && status !== 'ALL') {
      enriched = enriched.filter((r) => r.paymentStatus === status.toUpperCase());
    }
    if (gateway && gateway !== 'ALL') {
      enriched = enriched.filter((r) => r.gateway === gateway);
    }

    const totalMRR = enriched.reduce((s, r) => s + r.monthlyRevenue, 0);
    const totalARR = totalMRR * 12;

    // Plan breakdown
    const planBreakdown = {};
    for (const p of ['BASIC', 'STANDARD', 'PREMIUM', 'ENTERPRISE']) {
      const ps = enriched.filter((r) => r.plan === p);
      planBreakdown[p] = {
        count: ps.length,
        mrr: ps.reduce((s, r) => s + r.monthlyRevenue, 0),
        arr: ps.reduce((s, r) => s + r.arr, 0),
      };
    }

    // Live transactions (last 10 enriched rows formatted as feed)
    const liveFeed = enriched.slice(0, 10).map((r, i) => ({
      school: r.schoolName,
      amount: `INR ${r.monthlyRevenue.toLocaleString()}`,
      gateway: r.gateway,
      transactionId: `TXN-${r._id.toString().slice(-5).toUpperCase()}`,
      status: r.paymentStatus,
      risk: r.fraudScore > 0.6 ? 'HIGH' : r.fraudScore > 0.3 ? 'MEDIUM' : 'LOW',
      timestamp: `${(i + 1) * 3}m ago`,
    }));

    const metrics = {
      totalMRR,
      totalARR,
      grossProfit: parseFloat((totalMRR * 0.74).toFixed(0)),
      netProfit: parseFloat((totalMRR * 0.49).toFixed(0)),
      forecastMRR: parseFloat((totalMRR * 1.22).toFixed(0)),
      avgRevenuePerSchool: enriched.length > 0
        ? parseFloat((totalMRR / enriched.length).toFixed(0))
        : 0,
      totalFailedPayments: enriched.reduce((s, r) => s + r.failedTransactions, 0),
      totalRefunds: enriched.reduce((s, r) => s + r.refunds, 0),
      pendingInvoices: enriched.filter((r) => r.paymentStatus === 'PENDING').length,
      totalTransactionsToday: enriched.reduce((s, r) => s + r.transactionsToday, 0),
      avgCashflow: enriched.length > 0
        ? parseFloat((enriched.reduce((s, r) => s + r.cashflow, 0) / enriched.length).toFixed(2))
        : 0,
      planBreakdown,
    };

    return res.json({
      success: true,
      count: enriched.length,
      totalCount,
      page: parseInt(page, 10),
      metrics,
      liveFeed,
      data: enriched,
    });
  } catch (error) {
    logger.error('[getRevenue]', error.message);
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error fetching revenue',
      error: error.message,
    });
  }
};

// -- GET /api/revenue/:schoolId ----------------------------------------------

const getRevenueBySchool = async (req, res) => {
  try {
    if (req.user.role !== USER_ROLES.SUPER_ADMIN) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({ success: false, message: 'Access denied.' });
    }
    const school = await School.findById(req.params.schoolId).lean();
    if (!school) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ success: false, message: 'School not found' });
    }

    const enriched = await _enrichSchoolRevenue(school);
    return res.json({ success: true, data: enriched });
  } catch (error) {
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ success: false, message: error.message });
  }
};

// -- GET /api/revenue/metrics -------------------------------------------------

const getRevenueMetrics = async (req, res) => {
  try {
    if (req.user.role !== USER_ROLES.SUPER_ADMIN) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({ success: false, message: 'Access denied.' });
    }

    const schools = await School.find().lean();
    const enriched = await Promise.all(schools.map(_enrichSchoolRevenue));

    const totalMRR = enriched.reduce((s, r) => s + r.monthlyRevenue, 0);
    const planBreakdown = {};
    for (const p of ['BASIC', 'STANDARD', 'PREMIUM', 'ENTERPRISE']) {
      const ps = enriched.filter((r) => r.plan === p);
      planBreakdown[p] = {
        count: ps.length,
        mrr: ps.reduce((s, r) => s + r.monthlyRevenue, 0),
        arr: ps.reduce((s, r) => s + r.arr, 0),
        schools: ps.length,
        renewalRate: parseFloat((ps.filter((r) => r.paymentStatus === 'PAID').length / Math.max(1, ps.length)).toFixed(2)),
      };
    }

    return res.json({
      success: true,
      data: {
        totalMRR,
        totalARR: totalMRR * 12,
        grossProfit: parseFloat((totalMRR * 0.74).toFixed(0)),
        netProfit: parseFloat((totalMRR * 0.49).toFixed(0)),
        forecastMRR: parseFloat((totalMRR * 1.22).toFixed(0)),
        planBreakdown,
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
      },
    });
  } catch (error) {
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ success: false, message: error.message });
  }
};

module.exports = { getRevenue, getRevenueBySchool, getRevenueMetrics };
