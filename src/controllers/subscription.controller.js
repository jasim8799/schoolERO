const School = require('../models/School');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const BillingHistory = require('../models/BillingHistory');
const FraudAlert = require('../models/FraudAlert');
const RevenueSnapshot = require('../models/RevenueSnapshot');
const { USER_ROLES } = require('../config/constants');
const { logger } = require('../utils/logger');
const { auditLog } = require('../utils/auditLog');
const { calculateThreatScore } = require('../fraud/threat.scorer');
const {
  createBillingRecord,
  calculateBillingHealth,
  PLAN_PRICING,
  retryFailedPayment,
} = require('../billing/billing.engine');
const redis = require('../config/redis');

// â”€â”€ Pure helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function _subscriptionStatus(school) {
  const sub = school.subscription;
  if (!sub?.endDate) return 'UNKNOWN';
  const now     = new Date();
  const endDate = new Date(sub.endDate);
  const graceEnd = new Date(endDate.getTime() + (sub.gracePeriodDays || 30) * 86400000);
  if (now > graceEnd) return 'EXPIRED';
  if (now > endDate)  return 'GRACE';
  const created  = new Date(school.createdAt);
  const trialEnd = new Date(created.getTime() + 14 * 86400000);
  if (now < trialEnd && new Date(sub.endDate) < new Date(created.getTime() + 16 * 86400000)) {
    return 'TRIAL';
  }
  return 'ACTIVE';
}

function _daysRemaining(school) {
  if (!school.subscription?.endDate) return 0;
  return Math.ceil((new Date(school.subscription.endDate) - new Date()) / 86400000);
}

function _planMonthlyRevenue(plan) {
  return (PLAN_PRICING[(plan || 'BASIC').toUpperCase()]?.monthly || PLAN_PRICING.BASIC.monthly) / 100;
}

function _renewalProbability(billingHealth, threatScore, daysLeft) {
  let prob = billingHealth;
  prob -= threatScore * 0.4;
  if (daysLeft > 60) prob += 0.1;
  if (daysLeft < 0)  prob -= 0.3;
  return parseFloat(Math.max(0.05, Math.min(0.99, prob)).toFixed(2));
}

function _planHierarchy(plan) {
  const h = { BASIC: 1, STANDARD: 2, PREMIUM: 3, ENTERPRISE: 4 };
  return h[(plan || 'BASIC').toUpperCase()] || 1;
}

// â”€â”€ Core enrichment â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function _enrichSchoolSubscription(school, includeDetail = false) {
  const schoolId       = school._id;
  const daysLeft       = _daysRemaining(school);
  const status         = _subscriptionStatus(school);
  const plan           = (school.plan || 'BASIC').toUpperCase();
  const monthlyRevenue = _planMonthlyRevenue(plan);

  let activeUsers = 0, failedPaymentCount = 0, billingRecords = [], fraudAlerts = [];

  try {
    const monthAgo = new Date(Date.now() - 30 * 86400000);
    const promises = [
      User.countDocuments({ schoolId, status: 'active' }),
      BillingHistory.countDocuments({ schoolId, status: 'FAILED', createdAt: { $gte: monthAgo } }),
    ];
    if (includeDetail) {
      promises.push(
        BillingHistory.find({ schoolId }).sort({ createdAt: -1 }).limit(10).lean(),
        FraudAlert.find({ schoolId, resolved: false }).sort({ createdAt: -1 }).limit(5).lean(),
      );
    }
    const results      = await Promise.all(promises);
    activeUsers        = results[0] || 0;
    failedPaymentCount = results[1] || 0;
    if (includeDetail) { billingRecords = results[2] || []; fraudAlerts = results[3] || []; }
  } catch (err) {
    console.error(`[enrichSubscription] ${schoolId}:`, err.message);
  }

  const billingHealth = calculateBillingHealth(school, daysLeft, failedPaymentCount);
  const { score: threatScore, severity: threatSeverity, signals } = await calculateThreatScore(
    schoolId, { ...school, daysRemaining: daysLeft }
  );
  const renewalProbability = _renewalProbability(billingHealth, threatScore, daysLeft);

  const todayKey = `apiRequests:${schoolId}:${new Date().toISOString().split('T')[0]}`;
  const apiRequestsToday = parseInt(
    await redis.connection.get(todayKey).catch(() => '0') || '0', 10
  );
  const apiRequests = apiRequestsToday || Math.floor(activeUsers * 280);

  const storageUsedBytes = school.analytics?.storageUsedBytes || 0;
  const storageLimit     = school.limits?.storageLimit || 1073741824;

  const base = {
    _id:          schoolId.toString(),
    schoolName:   school.name,
    schoolCode:   school.code,
    region:       school.city || school.address?.split(',').pop()?.trim() || 'India',
    schoolTag:    school.state || 'INDIA',
    plan, status,
    schoolStatus:    school.status,
    paymentStatus:   daysLeft < 0 ? 'FAILED' : daysLeft < 7 ? 'PENDING' : 'PAID',
    nextRenewalDate: school.subscription?.endDate || null,
    daysRemaining:   daysLeft,
    autoRenew:       daysLeft > 0 && school.status === 'active',
    gatewayActive:   school.status === 'active',
    monthlyRevenue,
    yearlyRevenue:   monthlyRevenue * 12,
    billingHealth,   threatScore, threatSeverity, renewalProbability,
    failedPayments:  failedPaymentCount,
    activeUsers,
    storageUsage:    parseFloat((storageUsedBytes / 1073741824).toFixed(2)),
    storageLimit:    parseFloat((storageLimit / 1073741824).toFixed(2)),
    apiRequests,
    subscription: school.subscription,
    limits:       school.limits,
    modules:      school.modules,
    createdAt:    school.createdAt,
    updatedAt:    school.updatedAt,
  };
  if (includeDetail) {
    base.billingHistory = billingRecords;
    base.fraudAlerts    = fraudAlerts;
    base.threatSignals  = signals;
  }
  return base;
}

// â”€â”€ Cache helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function _invalidateSubscriptionCaches() {
  try {
    const keys = await redis.connection.keys('subscriptions:*');
    if (keys.length > 0) await redis.connection.del(...keys);
  } catch (_) {}
}

// â”€â”€ Metrics builder â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function _buildMetrics(enriched) {
  return {
    totalSubscriptions:  enriched.length,
    active:              enriched.filter((s) => s.status === 'ACTIVE').length,
    trial:               enriched.filter((s) => s.status === 'TRIAL').length,
    grace:               enriched.filter((s) => s.status === 'GRACE').length,
    expired:             enriched.filter((s) => s.status === 'EXPIRED').length,
    suspended:           enriched.filter((s) => s.schoolStatus === 'inactive').length,
    totalMonthlyRevenue: enriched.reduce((sum, s) => sum + s.monthlyRevenue, 0),
    totalYearlyRevenue:  enriched.reduce((sum, s) => sum + s.yearlyRevenue, 0),
    totalFailedPayments: enriched.reduce((sum, s) => sum + s.failedPayments, 0),
    renewingIn7Days:     enriched.filter((s) => s.daysRemaining >= 0 && s.daysRemaining <= 7).length,
    renewingIn14Days:    enriched.filter((s) => s.daysRemaining >= 0 && s.daysRemaining <= 14).length,
    renewingIn30Days:    enriched.filter((s) => s.daysRemaining >= 0 && s.daysRemaining <= 30).length,
    autoRenewCount:      enriched.filter((s) => s.autoRenew).length,
    gatewayActiveCount:  enriched.filter((s) => s.gatewayActive).length,
    planBreakdown: {
      BASIC:      enriched.filter((s) => s.plan === 'BASIC').length,
      STANDARD:   enriched.filter((s) => s.plan === 'STANDARD').length,
      PREMIUM:    enriched.filter((s) => s.plan === 'PREMIUM').length,
      ENTERPRISE: enriched.filter((s) => s.plan === 'ENTERPRISE').length,
    },
  };
}

// â”€â”€ API Handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// GET /api/subscriptions
const getSubscriptions = async (req, res) => {
  try {
    if (req.user.role !== USER_ROLES.SUPER_ADMIN) {
      return res.status(403).json({ success: false, message: 'Access denied. Super Admin only.' });
    }
    const { plan, status, payment, search, limit = 100, page = 1 } = req.query;

    const cacheKey = `subscriptions:list:${plan}:${status}:${payment}:${page}:${search || ''}`;
    const cached   = await redis.connection.get(cacheKey).catch(() => null);
    if (cached) return res.json({ success: true, ...JSON.parse(cached), cached: true });

    const query = { isDeleted: { $ne: true } };
    if (plan && plan !== 'ALL') query.plan = plan.toUpperCase();
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { code: { $regex: search, $options: 'i' } },
        { city: { $regex: search, $options: 'i' } },
      ];
    }

    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const [schools, totalCount] = await Promise.all([
      School.find(query).sort({ updatedAt: -1 }).skip(skip).limit(parseInt(limit, 10)).lean(),
      School.countDocuments(query),
    ]);

    let enriched = await Promise.all(schools.map((s) => _enrichSchoolSubscription(s, false)));
    if (status  && status  !== 'ALL') enriched = enriched.filter((s) => s.status        === status.toUpperCase());
    if (payment && payment !== 'ALL') enriched = enriched.filter((s) => s.paymentStatus === payment.toUpperCase());

    const metrics = _buildMetrics(enriched);
    const payload = {
      count: enriched.length, totalCount,
      page: parseInt(page, 10),
      totalPages: Math.ceil(totalCount / parseInt(limit, 10)),
      metrics, data: enriched,
    };

    await redis.connection.setex(cacheKey, 60, JSON.stringify(payload)).catch(() => {});
    return res.json({ success: true, ...payload });
  } catch (error) {
    logger.error('[getSubscriptions]', error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/subscriptions/metrics
const getSubscriptionMetrics = async (req, res) => {
  try {
    if (req.user.role !== USER_ROLES.SUPER_ADMIN) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }
    const cached = await redis.connection.get('subscriptions:metrics').catch(() => null);
    if (cached) return res.json({ success: true, data: JSON.parse(cached), cached: true });

    const schools  = await School.find({ isDeleted: { $ne: true } }).lean();
    const enriched = await Promise.all(schools.map((s) => _enrichSchoolSubscription(s, false)));
    const metrics  = _buildMetrics(enriched);
    const totalMRR = enriched.reduce((sum, s) => sum + s.monthlyRevenue, 0);
    const planBreakdown = {};
    for (const p of ['BASIC', 'STANDARD', 'PREMIUM', 'ENTERPRISE']) {
      const ps = enriched.filter((s) => s.plan === p);
      planBreakdown[p] = {
        count:       ps.length,
        revenue:     ps.reduce((sum, s) => sum + s.monthlyRevenue, 0),
        renewalsDue: ps.filter((s) => s.daysRemaining >= 0 && s.daysRemaining <= 30).length,
      };
    }
    const analyticsData = {
      ...metrics, totalMRR,
      totalARR:    totalMRR * 12,
      forecastMRR: parseFloat((totalMRR * 1.18).toFixed(0)),
      planBreakdown,
      renewalAlerts: enriched
        .filter((s) => s.daysRemaining <= 14 || s.paymentStatus === 'FAILED' || s.threatScore > 0.68)
        .sort((a, b) => a.daysRemaining - b.daysRemaining)
        .slice(0, 10)
        .map((s) => ({
          schoolId: s._id, schoolName: s.schoolName, plan: s.plan,
          daysRemaining: s.daysRemaining, paymentStatus: s.paymentStatus,
          threatScore: s.threatScore, renewalProbability: s.renewalProbability,
        })),
    };
    await redis.connection.setex('subscriptions:metrics', 30, JSON.stringify(analyticsData)).catch(() => {});
    return res.json({ success: true, data: analyticsData });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/subscriptions/:schoolId
const getSubscriptionBySchool = async (req, res) => {
  try {
    if (req.user.role !== USER_ROLES.SUPER_ADMIN) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }
    const school = await School.findById(req.params.schoolId).lean();
    if (!school) return res.status(404).json({ success: false, message: 'School not found' });
    const enriched = await _enrichSchoolSubscription(school, true);
    return res.json({ success: true, data: enriched });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// PUT /api/subscriptions/:schoolId/renew
const renewSubscription = async (req, res) => {
  try {
    if (req.user.role !== USER_ROLES.SUPER_ADMIN) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }
    const { durationMonths = 12, extendFromCurrent = true, paymentMethod = 'MANUAL' } = req.body;
    if (durationMonths < 1 || durationMonths > 36) {
      return res.status(400).json({ success: false, message: 'Duration must be 1-36 months' });
    }
    const school = await School.findById(req.params.schoolId);
    if (!school) return res.status(404).json({ success: false, message: 'School not found' });

    const now        = new Date();
    const currentEnd = school.subscription?.endDate ? new Date(school.subscription.endDate) : now;
    const baseDate   = extendFromCurrent && currentEnd > now ? currentEnd : now;
    const newEndDate = new Date(baseDate.getTime() + durationMonths * 30 * 86400000);

    await School.findByIdAndUpdate(req.params.schoolId, {
      'subscription.endDate':         newEndDate,
      'subscription.isExpired':       false,
      'subscription.lastRenewalDate': now,
      status: 'active',
    });

    let billing;
    try {
      billing = await createBillingRecord({
        schoolId: school._id, plan: school.plan, durationMonths,
        createdBy: req.user._id, paymentMethod, billingType: 'RENEWAL',
      });
    } catch (billingErr) {
      console.error('[renewSubscription] Billing record creation failed:', billingErr.message);
    }

    await auditLog({
      action: 'SUBSCRIPTION_RENEWED', userId: req.user._id, role: req.user.role,
      entityType: 'SCHOOL', entityId: school._id,
      description: `Subscription renewed for ${school.name} (${school.code}) â€” ${durationMonths} months`,
      details: { durationMonths, newEndDate, invoiceNumber: billing?.invoiceNumber }, req,
    });

    await _invalidateSubscriptionCaches();
    global.io?.of('/subscriptions').emit('subscription:renewed', {
      schoolId: school._id, schoolName: school.name, newEndDate, durationMonths,
    });
    logger.success(`Subscription renewed: ${school.name} â€” ${durationMonths} months`);

    return res.json({
      success: true,
      message: `Subscription renewed for ${durationMonths} months`,
      data: {
        schoolId: school._id, schoolName: school.name, newEndDate, durationMonths,
        invoiceNumber: billing?.invoiceNumber, billingId: billing?._id,
      },
    });
  } catch (error) {
    logger.error('[renewSubscription]', error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// PUT /api/subscriptions/:schoolId/suspend
const suspendSubscription = async (req, res) => {
  try {
    if (req.user.role !== USER_ROLES.SUPER_ADMIN) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }
    const school = await School.findById(req.params.schoolId);
    if (!school) return res.status(404).json({ success: false, message: 'School not found' });

    const newStatus = school.status === 'active' ? 'inactive' : 'active';
    await School.findByIdAndUpdate(req.params.schoolId, { status: newStatus });
    if (newStatus === 'inactive') {
      await School.findByIdAndUpdate(req.params.schoolId, { forceLogoutAt: new Date() });
    }

    await auditLog({
      action:      newStatus === 'inactive' ? 'SUBSCRIPTION_SUSPENDED' : 'SUBSCRIPTION_REACTIVATED',
      userId:      req.user._id, role: req.user.role,
      entityType:  'SCHOOL', entityId: school._id,
      description: `School ${school.name} ${newStatus === 'inactive' ? 'suspended' : 'reactivated'}`,
      req,
    });
    await _invalidateSubscriptionCaches();
    global.io?.of('/subscriptions').emit('subscription:statusChanged', {
      schoolId: school._id, schoolName: school.name, newStatus,
    });

    return res.json({
      success: true,
      message: `School ${newStatus === 'inactive' ? 'suspended' : 'reactivated'} successfully`,
      data: { schoolId: school._id, status: newStatus },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/subscriptions/analytics/revenue
const getRevenueAnalytics = async (req, res) => {
  try {
    if (req.user.role !== USER_ROLES.SUPER_ADMIN) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }
    const { days = 30 } = req.query;
    const from = new Date(Date.now() - parseInt(days, 10) * 86400000);
    const snapshots  = await RevenueSnapshot.find({ date: { $gte: from } }).sort({ date: 1 }).lean();
    const billingByDay = await BillingHistory.aggregate([
      { $match: { createdAt: { $gte: from }, status: 'PAID' } },
      { $group: {
        _id:     { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
        revenue: { $sum: { $divide: ['$amount', 100] } },
        count:   { $sum: 1 },
      }},
      { $sort: { _id: 1 } },
    ]);
    const mrrTrend = snapshots.map((s) => ({
      date: s.date, mrr: s.totalMRR, churn: s.churnedMRR, new: s.newMRR, expansion: s.expansionMRR,
    }));
    return res.json({ success: true, data: { billingByDay, mrrTrend, snapshots } });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/subscriptions/:schoolId/billing-history
const getBillingHistory = async (req, res) => {
  try {
    if (req.user.role !== USER_ROLES.SUPER_ADMIN) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }
    const { page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const [records, total] = await Promise.all([
      BillingHistory.find({ schoolId: req.params.schoolId })
        .sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit, 10)).lean(),
      BillingHistory.countDocuments({ schoolId: req.params.schoolId }),
    ]);
    return res.json({ success: true, data: records, total, page: parseInt(page, 10) });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/subscriptions/billing/retry
const retryBilling = async (req, res) => {
  try {
    if (req.user.role !== USER_ROLES.SUPER_ADMIN) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }
    const { billingId } = req.body;
    if (!billingId) return res.status(400).json({ success: false, message: 'billingId required' });

    const result = await retryFailedPayment(billingId);
    await auditLog({
      action: 'PAYMENT_RETRY_SCHEDULED', userId: req.user._id, role: req.user.role,
      entityType: 'BILLING', entityId: billingId,
      description: `Payment retry ${result.retryCount} scheduled for ${result.nextRetryAt}`, req,
    });
    return res.json({ success: true, data: result });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// PUT /api/subscriptions/:schoolId/plan
const updatePlan = async (req, res) => {
  try {
    if (req.user.role !== USER_ROLES.SUPER_ADMIN) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }
    const { plan, confirmed = false } = req.body;
    const validPlans = ['BASIC', 'STANDARD', 'PREMIUM', 'ENTERPRISE'];
    if (!validPlans.includes(plan?.toUpperCase())) {
      return res.status(400).json({ success: false, message: 'Invalid plan' });
    }
    const school = await School.findById(req.params.schoolId).lean();
    if (!school) return res.status(404).json({ success: false, message: 'School not found' });

    const isDowngrade = _planHierarchy(plan) < _planHierarchy(school.plan);
    if (isDowngrade && !confirmed) {
      return res.status(400).json({
        success: false, requiresConfirmation: true,
        message: `Downgrading from ${school.plan} to ${plan} requires confirmation`,
        currentPlan: school.plan, newPlan: plan,
      });
    }
    const previousPlan = school.plan;
    await School.findByIdAndUpdate(req.params.schoolId, { plan: plan.toUpperCase() });
    await createBillingRecord({
      schoolId: school._id, plan: plan.toUpperCase(), durationMonths: 1,
      createdBy: req.user._id, billingType: isDowngrade ? 'DOWNGRADE' : 'UPGRADE', previousPlan,
    }).catch(() => {});
    await auditLog({
      action:      isDowngrade ? 'PLAN_DOWNGRADED' : 'PLAN_UPGRADED',
      userId:      req.user._id, role: req.user.role,
      entityType:  'SCHOOL', entityId: school._id,
      description: `Plan changed: ${previousPlan} â†’ ${plan} for ${school.name}`, req,
    });
    await _invalidateSubscriptionCaches();
    global.io?.of('/subscriptions').emit('subscription:planChanged', {
      schoolId: school._id, schoolName: school.name, previousPlan, newPlan: plan,
    });
    return res.json({ success: true, data: { schoolId: school._id, previousPlan, newPlan: plan } });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/subscriptions/fraud/alerts
const getFraudAlerts = async (req, res) => {
  try {
    if (req.user.role !== USER_ROLES.SUPER_ADMIN) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }
    const { resolved, severity, limit = 50 } = req.query;
    const query = {};
    if (resolved !== undefined) query.resolved = resolved === 'true';
    if (severity)               query.severity = severity.toUpperCase();
    const alerts = await FraudAlert.find(query)
      .sort({ createdAt: -1 }).limit(parseInt(limit, 10))
      .populate('schoolId', 'name code').lean();
    return res.json({ success: true, data: alerts });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/subscriptions/fraud/alerts/:alertId/resolve
const resolveFraudAlert = async (req, res) => {
  try {
    if (req.user.role !== USER_ROLES.SUPER_ADMIN) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }
    await FraudAlert.findByIdAndUpdate(req.params.alertId, {
      resolved: true, resolvedAt: new Date(), resolvedBy: req.user._id,
    });
    return res.json({ success: true, message: 'Alert resolved' });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
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
};
