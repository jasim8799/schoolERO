const School = require('../models/School');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const { HTTP_STATUS, USER_ROLES, SAAS_PLANS } = require('../config/constants');
const { logger } = require('../utils/logger');
const { auditLog } = require('../utils/auditLog');

// ── helpers ────────────────────────────────────────────────────────────────

function _subscriptionStatus(school) {
  const sub = school.subscription;
  if (!sub || !sub.endDate) return 'UNKNOWN';
  const now = new Date();
  const endDate = new Date(sub.endDate);
  const graceEnd = new Date(endDate.getTime() + (sub.gracePeriodDays || 30) * 24 * 60 * 60 * 1000);
  if (now > graceEnd) return 'EXPIRED';
  if (now > endDate) return 'GRACE';
  // Check if within 14-day trial window from creation
  const created = new Date(school.createdAt);
  const trialEnd = new Date(created.getTime() + 14 * 24 * 60 * 60 * 1000);
  if (now < trialEnd && sub.endDate && new Date(sub.endDate) < new Date(created.getTime() + 16 * 24 * 60 * 60 * 1000)) {
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

// DEPRECATED - Use actual school.subscription.monthlyPrice instead
// This hardcoded function is kept only for backward compatibility
function _planRevenue(plan) {
  console.log('[WARNING] _planRevenue() is deprecated. Use school.subscription.monthlyPrice instead.');
  switch ((plan || '').toUpperCase()) {
    case 'BASIC': return 9000;
    case 'STANDARD': return 18000;
    case 'PREMIUM': return 32000;
    case 'ENTERPRISE': return 58000;
    default: return 9000;
  }
}

// Get actual monthly price from school subscription
function _getActualMonthlyPrice(school) {
  const monthlyPrice = school.subscription?.monthlyPrice;
  if (monthlyPrice && typeof monthlyPrice === 'number' && monthlyPrice > 0) {
    return monthlyPrice;
  }
  // Fallback to plan-based if monthlyPrice not set (legacy schools)
  console.log(`[WARNING] School ${school.name} missing monthlyPrice, using fallback`);
  return _planRevenue(school.plan);
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

function _fmtDate(d) {
  if (!d) return 'N/A';
  const dt = new Date(d);
  return `${dt.getDate()}/${dt.getMonth() + 1}/${dt.getFullYear()}`;
}

async function _enrichSchoolSubscription(school) {
  const daysLeft = _daysRemaining(school);
  const status = _subscriptionStatus(school);
  const plan = (school.plan || 'BASIC').toUpperCase();
  // PRIORITY 1 FIX: Use actual monthlyPrice from database, not hardcoded plan values
  const monthlyRevenue = _getActualMonthlyPrice(school);

  // Get failed login count from audit logs (last 30 days)
  let failedLogins = 0;
  try {
    const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    failedLogins = await AuditLog.countDocuments({
      schoolId: school._id,
      action: { $in: ['LOGIN_FAILED', 'INVALID_TOKEN'] },
      createdAt: { $gte: monthAgo },
    });
  } catch (_) {}

  // Get active user count
  let activeUsers = 0;
  try {
    activeUsers = await User.countDocuments({
      schoolId: school._id,
      status: 'active',
    });
  } catch (_) {}

  const billingHealth = _billingHealth(school, daysLeft);
  const threatScore = _threatScore(school, failedLogins, daysLeft);
  const renewalProbability = parseFloat(Math.max(0.1, Math.min(0.99, billingHealth - threatScore * 0.3 + 0.1)).toFixed(2));

  const storageUsage = ((school.limits?.storageLimit || 1073741824) * 0.6) / (1024 * 1024 * 1024); // ~60% mock
  const storageLimit = ((school.limits?.storageLimit || 1073741824)) / (1024 * 1024 * 1024);

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
    apiRequests: Math.floor(activeUsers * 280), // derived mock
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

// ── GET /api/subscriptions (list) ─────────────────────────────────────────

const getSubscriptions = async (req, res) => {
  try {
    if (req.user.role !== USER_ROLES.SUPER_ADMIN) {
      return res.status(403).json({ success: false, message: 'Access denied. Super Admin only.' });
    }

    const { plan, status, payment, search, limit = 100, page = 1 } = req.query;

    console.log('[getSubscriptions] Request params:', { plan, status, payment, search, limit, page });

    // Build school query
    const query = {};
    if (plan && plan !== 'ALL') query.plan = plan.toUpperCase();
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { code: { $regex: search, $options: 'i' } },
      ];
    }

const skip = (parseInt(page) - 1) * parseInt(limit);
    const [schools, totalCount] = await Promise.all([
      School.find(query)
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      School.countDocuments(query),
    ]);

    console.log('[getSubscriptions] DB Query result:', {
      foundSchools: schools.length,
      totalCount: totalCount,
      query: query
    });

    // Enrich with subscription metrics
    let enriched = await Promise.all(schools.map(_enrichSchoolSubscription));

    // Filter by derived status/payment after enrichment
    if (status && status !== 'ALL') {
      enriched = enriched.filter(s => s.status === status.toUpperCase());
    }
    if (payment && payment !== 'ALL') {
      enriched = enriched.filter(s => s.paymentStatus === payment.toUpperCase());
    }

    // Aggregate metrics
    const metrics = {
      totalSubscriptions: enriched.length,
      active: enriched.filter(s => s.status === 'ACTIVE').length,
      trial: enriched.filter(s => s.status === 'TRIAL').length,
      grace: enriched.filter(s => s.status === 'GRACE').length,
      expired: enriched.filter(s => s.status === 'EXPIRED').length,
      suspended: enriched.filter(s => s.schoolStatus === 'inactive').length,
      totalMonthlyRevenue: enriched.reduce((sum, s) => sum + s.monthlyRevenue, 0),
      totalYearlyRevenue: enriched.reduce((sum, s) => sum + s.yearlyRevenue, 0),
      totalFailedPayments: enriched.reduce((sum, s) => sum + s.failedPayments, 0),
      renewingIn7Days: enriched.filter(s => s.daysRemaining >= 0 && s.daysRemaining <= 7).length,
      renewingIn14Days: enriched.filter(s => s.daysRemaining >= 0 && s.daysRemaining <= 14).length,
      renewingIn30Days: enriched.filter(s => s.daysRemaining >= 0 && s.daysRemaining <= 30).length,
      autoRenewCount: enriched.filter(s => s.autoRenew).length,
      gatewayActiveCount: enriched.filter(s => s.gatewayActive).length,
      planBreakdown: {
        BASIC: enriched.filter(s => s.plan === 'BASIC').length,
        STANDARD: enriched.filter(s => s.plan === 'STANDARD').length,
        PREMIUM: enriched.filter(s => s.plan === 'PREMIUM').length,
        ENTERPRISE: enriched.filter(s => s.plan === 'ENTERPRISE').length,
      },
    };

    res.json({
      success: true,
      count: enriched.length,
      totalCount,
      page: parseInt(page),
      totalPages: Math.ceil(totalCount / parseInt(limit)),
      metrics,
      data: enriched,
    });
  } catch (error) {
    logger.error('[getSubscriptions]', error.message);
    res.status(500).json({ success: false, message: 'Error fetching subscriptions', error: error.message });
  }
};

// ── GET /api/subscriptions/:schoolId ──────────────────────────────────────

const getSubscriptionBySchool = async (req, res) => {
  try {
    if (req.user.role !== USER_ROLES.SUPER_ADMIN) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }
    const school = await School.findById(req.params.schoolId).lean();
    if (!school) return res.status(404).json({ success: false, message: 'School not found' });

    const enriched = await _enrichSchoolSubscription(school);
    res.json({ success: true, data: enriched });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── PUT /api/subscriptions/:schoolId/renew ────────────────────────────────
// PHASE 4 + PHASE 5 + PHASE 8: Flexible duration + Recording history

const renewSubscription = async (req, res) => {
  const mongoose = require('mongoose');
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    if (req.user.role !== USER_ROLES.SUPER_ADMIN) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }
    
    const { durationMonths = 12, extendFromCurrent = true } = req.body;
    if (durationMonths < 1 || durationMonths > 36) {
      return res.status(400).json({ success: false, message: 'Duration must be 1-36 months' });
    }
    
    const school = await School.findById(req.params.schoolId);
    if (!school) return res.status(404).json({ success: false, message: 'School not found' });

    const now = new Date();
    const currentEnd = school.subscription?.endDate ? new Date(school.subscription.endDate) : now;
    const baseDate = extendFromCurrent && currentEnd > now ? currentEnd : now;
    const newEndDate = new Date(baseDate.getTime() + durationMonths * 30 * 24 * 60 * 60 * 1000);

    // PHASE 4 FIX: Calculate total based on actual monthlyPrice from school, not hardcoded plan
    const monthlyPrice = school.subscription?.monthlyPrice || 499;
    const totalAmount = monthlyPrice * durationMonths;

    // Update subscription
    await School.findByIdAndUpdate(req.params.schoolId, {
      'subscription.endDate': newEndDate,
      'subscription.isExpired': false,
      'subscription.lastRenewalDate': now,
    }, { session });

    // PHASE 8: Create renewal history record
    const SubscriptionHistory = require('../models/SubscriptionHistory');
    await SubscriptionHistory.createRenewalRecord({
      schoolId: school._id,
      schoolName: school.name,
      schoolCode: school.code,
      oldEndDate: school.subscription?.endDate,
      newEndDate: newEndDate,
      durationMonths: durationMonths,
      monthlyPrice: monthlyPrice,
      totalAmount: totalAmount,
      renewedBy: req.user._id,
      renewedByEmail: req.user.email,
      renewalType: 'MANUAL',
      paymentMethod: 'MANUAL'
    }, { session });

    await session.commitTransaction();

    await auditLog({
      action: 'SUBSCRIPTION_RENEWED',
      userId: req.user._id,
      role: req.user.role,
      entityType: 'SCHOOL',
      entityId: school._id,
      description: `Subscription renewed for ${school.name} (${school.code}) — ${durationMonths} months (₹${totalAmount})`,
      req,
    });

    logger.success(`Subscription renewed: ${school.name} for ${durationMonths} months = ₹${totalAmount}`);
    res.json({
      success: true,
      message: `Subscription renewed for ${durationMonths} months`,
      data: { 
        schoolId: school._id, 
        newEndDate, 
        durationMonths,
        monthlyPrice,
        totalAmount
      },
    });
  } catch (error) {
    await session.abortTransaction();
    res.status(500).json({ success: false, message: error.message });
  } finally {
    session.endSession();
  }
};

// PHASE 8: GET /api/subscriptions/:schoolId/history — Get renewal history

const getSubscriptionHistory = async (req, res) => {
  try {
    if (req.user.role !== USER_ROLES.SUPER_ADMIN) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    const SubscriptionHistory = require('../models/SubscriptionHistory');
    const history = await SubscriptionHistory.getHistoryBySchool(
      req.params.schoolId,
      parseInt(req.query.limit) || 20
    );

    res.json({
      success: true,
      data: history
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── PUT /api/subscriptions/:schoolId/plan ──────────────────────────────
// PHASE 3: Edit Subscription Plan and Price

const updateSubscriptionPlan = async (req, res) => {
  try {
    if (req.user.role !== USER_ROLES.SUPER_ADMIN) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }
    
    const { schoolId } = req.params;
    const { plan, monthlyPrice } = req.body;
    
    // Validate school exists
    const school = await School.findById(schoolId);
    if (!school) {
      return res.status(404).json({ success: false, message: 'School not found' });
    }
    
    // Build update object
    const updateData = {};
    
    // Validate and update plan if provided
    if (plan !== undefined) {
      if (plan && !Object.values(SAAS_PLANS).includes(plan)) {
        return res.status(400).json({ 
          success: false, 
          message: 'Invalid plan. Must be BASIC, STANDARD, PREMIUM, or ENTERPRISE' 
        });
      }
      updateData['subscription.plan'] = plan;
      updateData['plan'] = plan; // Also update top-level plan
    }
    
    // Validate and update monthlyPrice if provided
    if (monthlyPrice !== undefined) {
      if (typeof monthlyPrice !== 'number' || monthlyPrice <= 0) {
        return res.status(400).json({ 
          success: false, 
          message: 'Monthly price must be a positive number' 
        });
      }
      updateData['subscription.monthlyPrice'] = monthlyPrice;
    }
    
    // Check if there's anything to update
    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'No valid fields to update (plan or monthlyPrice required)' 
      });
    }
    
    // Update the subscription
    const updatedSchool = await School.findByIdAndUpdate(
      schoolId,
      updateData,
      { new: true, runValidators: true }
    ).select('subscription plan name code');
    
    // Log the change
    await auditLog({
      action: 'SUBSCRIPTION_PLAN_UPDATED',
      userId: req.user._id,
      role: req.user.role,
      entityType: 'SCHOOL',
      entityId: school._id,
      description: `Updated subscription for ${school.name}: plan=${plan}, monthlyPrice=${monthlyPrice}`,
      req,
    });
    
    logger.success(`Subscription updated: ${school.name} - plan: ${plan}, price: ${monthlyPrice}`);
    
    res.json({
      success: true,
      message: 'Subscription updated successfully',
      data: {
        schoolId: school._id,
        schoolName: school.name,
        plan: updatedSchool.subscription.plan,
        monthlyPrice: updatedSchool.subscription.monthlyPrice,
      }
    });
  } catch (error) {
    logger.error('[updateSubscriptionPlan]', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── PUT /api/subscriptions/:schoolId/suspend ──────────────────────────────

const suspendSubscription = async (req, res) => {
  try {
    if (req.user.role !== USER_ROLES.SUPER_ADMIN) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }
    const school = await School.findById(req.params.schoolId);
    if (!school) return res.status(404).json({ success: false, message: 'School not found' });

    const newStatus = school.status === 'active' ? 'inactive' : 'active';
    await School.findByIdAndUpdate(req.params.schoolId, { status: newStatus });

    await auditLog({
      action: newStatus === 'inactive' ? 'SUBSCRIPTION_SUSPENDED' : 'SUBSCRIPTION_REACTIVATED',
      userId: req.user._id,
      role: req.user.role,
      entityType: 'SCHOOL',
      entityId: school._id,
      description: `School ${school.name} subscription ${newStatus === 'inactive' ? 'suspended' : 'reactivated'}`,
      req,
    });

    res.json({
      success: true,
      message: `School ${newStatus === 'inactive' ? 'suspended' : 'reactivated'} successfully`,
      data: { schoolId: school._id, status: newStatus },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── GET /api/subscriptions/metrics ────────────────────────────────────────

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
      const planSchools = enriched.filter(s => s.plan === plan);
      planBreakdown[plan] = {
        count: planSchools.length,
        revenue: planSchools.reduce((s, p) => s + p.monthlyRevenue, 0),
        renewalsDue: planSchools.filter(s => s.daysRemaining >= 0 && s.daysRemaining <= 30).length,
      };
    }

    res.json({
      success: true,
      data: {
        totalMRR,
        totalARR: totalMRR * 12,
        forecastMRR: parseFloat((totalMRR * 1.18).toFixed(0)),
        planBreakdown,
        statusBreakdown: {
          ACTIVE: enriched.filter(s => s.status === 'ACTIVE').length,
          TRIAL: enriched.filter(s => s.status === 'TRIAL').length,
          GRACE: enriched.filter(s => s.status === 'GRACE').length,
          EXPIRED: enriched.filter(s => s.status === 'EXPIRED').length,
        },
        renewalAlerts: enriched
          .filter(s => s.daysRemaining <= 14 || s.paymentStatus === 'FAILED' || s.threatScore > 0.68)
          .sort((a, b) => a.daysRemaining - b.daysRemaining)
          .slice(0, 10)
          .map(s => ({
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
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getSubscriptions,
  getSubscriptionBySchool,
  renewSubscription,
  getSubscriptionHistory,  // PHASE 8: Get renewal history
  updateSubscriptionPlan,  // PHASE 3: Edit Subscription Plan
  suspendSubscription,
  getSubscriptionMetrics,
};
