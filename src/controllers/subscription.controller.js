const School = require('../models/School');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const { USER_ROLES } = require('../config/constants');
const { logger } = require('../utils/logger');
const { auditLog } = require('../utils/auditLog');

function _subscriptionStatus(school) {
  const sub = school.subscription;
  if (!sub || !sub.endDate) return 'UNKNOWN';
  const now = new Date();
  const endDate = new Date(sub.endDate);
  const graceEnd = new Date(
    endDate.getTime() + (sub.gracePeriodDays || 30) * 24 * 60 * 60 * 1000,
  );
  if (now > graceEnd) return 'EXPIRED';
  if (now > endDate) return 'GRACE';

  const created = new Date(school.createdAt);
  const trialEnd = new Date(created.getTime() + 14 * 24 * 60 * 60 * 1000);
  if (
    now < trialEnd &&
    sub.endDate &&
    new Date(sub.endDate) < new Date(created.getTime() + 16 * 24 * 60 * 60 * 1000)
  ) {
    return 'TRIAL';
  }
  return 'ACTIVE';
}

function _daysRemaining(school) {
  const sub = school.subscription;
  if (!sub || !sub.endDate) return 0;
  const endDate = new Date(sub.endDate);
  return Math.ceil((endDate - new Date()) / (1000 * 60 * 60 * 24));
}

function _planRevenue(plan) {
  switch ((plan || '').toUpperCase()) {
    case 'BASIC':
      return 9000;
    case 'STANDARD':
      return 18000;
    case 'PREMIUM':
      return 32000;
    case 'ENTERPRISE':
      return 58000;
    default:
      return 9000;
  }
}

function _billingHealth(school, daysLeft) {
  if (daysLeft < 0) return 0.15;
  if (daysLeft < 7) return 0.42;
  if (daysLeft < 30) return 0.68;
  if (school.status !== 'active') return 0.35;
  return 0.92;
}

function _threatScore(school, failedLogins, daysLeft) {
  let score = 0;
  if (daysLeft < 0) score += 0.4;
  else if (daysLeft < 7) score += 0.2;
  if (failedLogins > 10) score += 0.3;
  else if (failedLogins > 5) score += 0.15;
  if (school.status !== 'active') score += 0.2;
  return Math.min(1.0, parseFloat(score.toFixed(2)));
}

async function _enrichSchoolSubscription(school) {
  const daysLeft = _daysRemaining(school);
  const status = _subscriptionStatus(school);
  const plan = (school.plan || 'BASIC').toUpperCase();
  const monthlyRevenue = _planRevenue(plan);

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
      User.countDocuments({
        schoolId: school._id,
        status: 'active',
      }),
    ]);
  } catch (_) {}

  const billingHealth = _billingHealth(school, daysLeft);
  const threatScore = _threatScore(school, failedLogins, daysLeft);
  const renewalProbability = parseFloat(
    Math.max(0.1, Math.min(0.99, billingHealth - threatScore * 0.3 + 0.1)).toFixed(2),
  );

  const storageUsage = ((school.limits?.storageLimit || 1073741824) * 0.6) /
    (1024 * 1024 * 1024);
  const storageLimit = (school.limits?.storageLimit || 1073741824) /
    (1024 * 1024 * 1024);

  return {
    _id: school._id.toString(),
    schoolName: school.name,
    schoolCode: school.code,
    region: school.city || school.address?.split(',').pop()?.trim() || 'India',
    schoolTag: 'INDIA',
    plan,
    status,
    schoolStatus: school.status,
    paymentStatus: daysLeft < 0 ? 'FAILED' : daysLeft < 7 ? 'PENDING' : 'PAID',
    nextRenewalDate: school.subscription?.endDate || null,
    daysRemaining: daysLeft,
    billingHealth,
    activeUsers,
    storageUsage: parseFloat(storageUsage.toFixed(1)),
    storageLimit: parseFloat(storageLimit.toFixed(1)),
    apiRequests: Math.floor(activeUsers * 280),
    monthlyRevenue,
    yearlyRevenue: monthlyRevenue * 12,
    threatScore,
    renewalProbability,
    failedPayments: failedLogins > 5 ? Math.floor(failedLogins / 5) : 0,
    gatewayActive: school.status === 'active',
    autoRenew: daysLeft > 0 && school.status === 'active',
    subscription: school.subscription,
    limits: school.limits,
    modules: school.modules,
    createdAt: school.createdAt,
    updatedAt: school.updatedAt,
  };
}

const getSubscriptions = async (req, res) => {
  try {
    if (req.user.role !== USER_ROLES.SUPER_ADMIN) {
      return res.status(403).json({ success: false, message: 'Access denied. Super Admin only.' });
    }

    const { plan, status, payment, search, limit = 100, page = 1 } = req.query;

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
      School.find(query)
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(parseInt(limit, 10))
        .lean(),
      School.countDocuments(query),
    ]);

    let enriched = await Promise.all(schools.map(_enrichSchoolSubscription));

    if (status && status !== 'ALL') {
      enriched = enriched.filter((s) => s.status === status.toUpperCase());
    }
    if (payment && payment !== 'ALL') {
      enriched = enriched.filter((s) => s.paymentStatus === payment.toUpperCase());
    }

    const metrics = {
      totalSubscriptions: enriched.length,
      active: enriched.filter((s) => s.status === 'ACTIVE').length,
      trial: enriched.filter((s) => s.status === 'TRIAL').length,
      grace: enriched.filter((s) => s.status === 'GRACE').length,
      expired: enriched.filter((s) => s.status === 'EXPIRED').length,
      suspended: enriched.filter((s) => s.schoolStatus === 'inactive').length,
      totalMonthlyRevenue: enriched.reduce((sum, s) => sum + s.monthlyRevenue, 0),
      totalYearlyRevenue: enriched.reduce((sum, s) => sum + s.yearlyRevenue, 0),
      totalFailedPayments: enriched.reduce((sum, s) => sum + s.failedPayments, 0),
      renewingIn7Days: enriched.filter((s) => s.daysRemaining >= 0 && s.daysRemaining <= 7).length,
      renewingIn14Days: enriched.filter((s) => s.daysRemaining >= 0 && s.daysRemaining <= 14).length,
      renewingIn30Days: enriched.filter((s) => s.daysRemaining >= 0 && s.daysRemaining <= 30).length,
      autoRenewCount: enriched.filter((s) => s.autoRenew).length,
      gatewayActiveCount: enriched.filter((s) => s.gatewayActive).length,
      planBreakdown: {
        BASIC: enriched.filter((s) => s.plan === 'BASIC').length,
        STANDARD: enriched.filter((s) => s.plan === 'STANDARD').length,
        PREMIUM: enriched.filter((s) => s.plan === 'PREMIUM').length,
        ENTERPRISE: enriched.filter((s) => s.plan === 'ENTERPRISE').length,
      },
    };

    return res.json({
      success: true,
      count: enriched.length,
      totalCount,
      page: parseInt(page, 10),
      totalPages: Math.ceil(totalCount / parseInt(limit, 10)),
      metrics,
      data: enriched,
    });
  } catch (error) {
    logger.error('[getSubscriptions]', error.message);
    return res.status(500).json({
      success: false,
      message: 'Error fetching subscriptions',
      error: error.message,
    });
  }
};

const getSubscriptionBySchool = async (req, res) => {
  try {
    if (req.user.role !== USER_ROLES.SUPER_ADMIN) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }
    const school = await School.findById(req.params.schoolId).lean();
    if (!school) {
      return res.status(404).json({ success: false, message: 'School not found' });
    }

    const enriched = await _enrichSchoolSubscription(school);
    return res.json({ success: true, data: enriched });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const renewSubscription = async (req, res) => {
  try {
    if (req.user.role !== USER_ROLES.SUPER_ADMIN) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }
    const { durationMonths = 12, extendFromCurrent = true } = req.body;
    if (durationMonths < 1 || durationMonths > 36) {
      return res.status(400).json({ success: false, message: 'Duration must be 1-36 months' });
    }
    const school = await School.findById(req.params.schoolId);
    if (!school) {
      return res.status(404).json({ success: false, message: 'School not found' });
    }

    const now = new Date();
    const currentEnd = school.subscription?.endDate
      ? new Date(school.subscription.endDate)
      : now;
    const baseDate = extendFromCurrent && currentEnd > now ? currentEnd : now;
    const newEndDate = new Date(
      baseDate.getTime() + durationMonths * 30 * 24 * 60 * 60 * 1000,
    );

    await School.findByIdAndUpdate(req.params.schoolId, {
      'subscription.endDate': newEndDate,
      'subscription.isExpired': false,
      'subscription.lastRenewalDate': now,
    });

    await auditLog({
      action: 'SUBSCRIPTION_RENEWED',
      userId: req.user._id,
      role: req.user.role,
      entityType: 'SCHOOL',
      entityId: school._id,
      description: `Subscription renewed for ${school.name} (${school.code}) - ${durationMonths} months`,
      req,
    });

    logger.success(`Subscription renewed: ${school.name} for ${durationMonths} months`);
    return res.json({
      success: true,
      message: `Subscription renewed for ${durationMonths} months`,
      data: { schoolId: school._id, newEndDate, durationMonths },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const suspendSubscription = async (req, res) => {
  try {
    if (req.user.role !== USER_ROLES.SUPER_ADMIN) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }
    const school = await School.findById(req.params.schoolId);
    if (!school) {
      return res.status(404).json({ success: false, message: 'School not found' });
    }

    const newStatus = school.status === 'active' ? 'inactive' : 'active';
    await School.findByIdAndUpdate(req.params.schoolId, { status: newStatus });

    await auditLog({
      action: newStatus === 'inactive'
        ? 'SUBSCRIPTION_SUSPENDED'
        : 'SUBSCRIPTION_REACTIVATED',
      userId: req.user._id,
      role: req.user.role,
      entityType: 'SCHOOL',
      entityId: school._id,
      description: `School ${school.name} subscription ${newStatus === 'inactive' ? 'suspended' : 'reactivated'}`,
      req,
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

const getSubscriptionMetrics = async (req, res) => {
  try {
    if (req.user.role !== USER_ROLES.SUPER_ADMIN) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    const schools = await School.find().lean();
    const enriched = await Promise.all(schools.map(_enrichSchoolSubscription));

    const totalMRR = enriched.reduce((sum, s) => sum + s.monthlyRevenue, 0);
    const planBreakdown = {};
    for (const plan of ['BASIC', 'STANDARD', 'PREMIUM', 'ENTERPRISE']) {
      const planSchools = enriched.filter((s) => s.plan === plan);
      planBreakdown[plan] = {
        count: planSchools.length,
        revenue: planSchools.reduce((s, p) => s + p.monthlyRevenue, 0),
        renewalsDue: planSchools.filter((s) => s.daysRemaining >= 0 && s.daysRemaining <= 30).length,
      };
    }

    return res.json({
      success: true,
      data: {
        totalMRR,
        totalARR: totalMRR * 12,
        forecastMRR: parseFloat((totalMRR * 1.18).toFixed(0)),
        planBreakdown,
        statusBreakdown: {
          ACTIVE: enriched.filter((s) => s.status === 'ACTIVE').length,
          TRIAL: enriched.filter((s) => s.status === 'TRIAL').length,
          GRACE: enriched.filter((s) => s.status === 'GRACE').length,
          EXPIRED: enriched.filter((s) => s.status === 'EXPIRED').length,
        },
        renewalAlerts: enriched
          .filter((s) => s.daysRemaining <= 14 || s.paymentStatus === 'FAILED' || s.threatScore > 0.68)
          .sort((a, b) => a.daysRemaining - b.daysRemaining)
          .slice(0, 10)
          .map((s) => ({
            schoolId: s._id,
            schoolName: s.schoolName,
            plan: s.plan,
            daysRemaining: s.daysRemaining,
            paymentStatus: s.paymentStatus,
            threatScore: s.threatScore,
            renewalProbability: s.renewalProbability,
          })),
      },
    });
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
};
