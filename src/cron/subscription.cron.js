const cron = require('node-cron');
const School = require('../models/School');
const BillingHistory = require('../models/BillingHistory');
const RenewalReminder = require('../models/RenewalReminder');
const RevenueSnapshot = require('../models/RevenueSnapshot');
const { auditLog } = require('../utils/auditLog');

async function checkSubscriptionExpiry() {
  const now = new Date();

  // ── Auto-suspend schools past 30-day grace period ─────────────────────
  const graceThreshold = new Date(now.getTime() - 30 * 86400000);
  const expiredSchools = await School.find({
    status: 'active',
    'subscription.endDate': { $lte: graceThreshold },
  }).lean();

  for (const school of expiredSchools) {
    const subStart = school?.subscription?.startDate ? new Date(school.subscription.startDate) : null;
    const subEnd = school?.subscription?.endDate ? new Date(school.subscription.endDate) : null;
    const gracePeriodDays = Number(school?.subscription?.gracePeriodDays ?? 30);
    const graceEnd = subEnd && Number.isFinite(subEnd.getTime())
      ? new Date(subEnd.getTime() + gracePeriodDays * 86400000)
      : null;
    const daysRemaining = subEnd && Number.isFinite(subEnd.getTime())
      ? Math.ceil((subEnd.getTime() - now.getTime()) / 86400000)
      : null;
    const triggeredCondition =
      `status=active && endDate<=graceThreshold | (${school.status}) && ` +
      `${subEnd ? subEnd.toISOString() : 'INVALID_END_DATE'} <= ${graceThreshold.toISOString()}`;

    console.log('===== SCHOOL SUSPENSION =====');
    console.log('Job:', 'subscriptionCron.checkSubscriptionExpiry');
    console.log('Timestamp:', now.toISOString());
    console.log('School:', school.name || 'Unknown');
    console.log('School ID:', school._id?.toString?.() || String(school._id));
    console.log('Old Status:', school.status);
    console.log('New Status:', 'inactive');
    console.log('Current Date:', now.toISOString());
    console.log('Subscription Start:', subStart ? subStart.toISOString() : 'N/A');
    console.log('Subscription End:', subEnd ? subEnd.toISOString() : 'Invalid Date');
    console.log('Grace End:', graceEnd ? graceEnd.toISOString() : 'Invalid Date');
    console.log('Days Remaining:', daysRemaining);
    console.log('Grace Period:', gracePeriodDays);
    console.log('Reason:', 'Subscription expired after grace period');
    console.log('Condition:', triggeredCondition);
    console.log('Call Stack:', new Error('[subscription.cron] school suspension').stack);
    console.log('=============================');

    await auditLog({
      action: 'SCHOOL_AUTO_SUSPENDED_SUBSCRIPTION',
      role: 'SYSTEM',
      category: 'SUBSCRIPTION',
      entityType: 'SCHOOL',
      entityId: school._id,
      entityName: school.name,
      schoolId: school._id,
      schoolName: school.name,
      description: `School auto-suspended by subscription cron: ${school.name || school._id}`,
      details: {
        jobName: 'subscriptionCron.checkSubscriptionExpiry',
        automatic: true,
        operator: 'SYSTEM',
        oldStatus: school.status,
        newStatus: 'inactive',
        reason: 'Subscription expired after grace period',
        currentDate: now.toISOString(),
        subscriptionStartDate: subStart ? subStart.toISOString() : null,
        subscriptionEndDate: subEnd ? subEnd.toISOString() : null,
        graceEndDate: graceEnd ? graceEnd.toISOString() : null,
        gracePeriodDays,
        daysRemaining,
        subscriptionStatus: school?.subscription?.status || null,
        planStatus: school?.plan || null,
        triggeredCondition,
        dateChecks: {
          nowValid: Number.isFinite(now.getTime()),
          startDateValid: !!(subStart && Number.isFinite(subStart.getTime())),
          endDateValid: !!(subEnd && Number.isFinite(subEnd.getTime())),
          graceEndValid: !!(graceEnd && Number.isFinite(graceEnd.getTime())),
        },
        callStack: new Error('[subscription.cron] school suspension audit').stack,
      },
    });

    await School.findByIdAndUpdate(school._id, { status: 'inactive' });
    console.log(`[SubscriptionCron] Auto-suspended: ${school.name}`);
    global.io?.of('/subscriptions').emit('subscription:autoSuspended', {
      schoolId: school._id, schoolName: school.name,
    });
  }

  // ── Send renewal reminders ─────────────────────────────────────────────
  const reminderThresholds = [30, 14, 7, 3, 1];
  const redis = require('../config/redis');

  for (const days of reminderThresholds) {
    const target    = new Date(now.getTime() + days * 86400000);
    const targetEnd = new Date(target.getTime() + 86400000);

    const schools = await School.find({
      status: 'active',
      'subscription.endDate': { $gte: target, $lt: targetEnd },
    }).lean();

    for (const school of schools) {
      const reminderKey  = `renewal:reminder:${school._id}:${days}`;
      const alreadySent  = await redis.connection.get(reminderKey).catch(() => null);
      if (alreadySent) continue;

      await RenewalReminder.create({
        schoolId:         school._id,
        channel:          'IN_APP',
        daysBeforeExpiry: days,
        sentAt:           now,
        status:           'SENT',
      });

      global.io?.of('/subscriptions').emit('subscription:renewalAlert', {
        schoolId: school._id, schoolName: school.name, daysLeft: days,
      });

      await redis.connection.setex(reminderKey, 86400, '1').catch(() => {});
      console.log(`[SubscriptionCron] Renewal reminder sent: ${school.name} (${days} days)`);
    }
  }

  // ── Retry pending billing records ────────────────────────────────────
  const failedBillings = await BillingHistory.find({
    status:      'FAILED',
    retryCount:  { $lt: 3 },
    nextRetryAt: { $lte: now },
  }).lean();

  for (const billing of failedBillings) {
    try {
      const { retryFailedPayment } = require('../billing/billing.engine');
      await retryFailedPayment(billing._id);
      console.log(`[SubscriptionCron] Retry queued for billing ${billing._id}`);
    } catch (err) {
      console.error(`[SubscriptionCron] Retry failed for billing ${billing._id}:`, err.message);
    }
  }
}

async function snapshotDailyRevenue() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const PLAN_PRICES = { BASIC: 9000, STANDARD: 18000, PREMIUM: 32000, ENTERPRISE: 58000 };
  const schools      = await School.find({ isDeleted: { $ne: true } }).lean();
  const activeSchools = schools.filter((s) => s.status === 'active');
  const totalMRR = activeSchools.reduce((sum, s) => sum + (PLAN_PRICES[s.plan?.toUpperCase()] || 9000), 0);

  const planBreakdown = {};
  for (const plan of ['BASIC', 'STANDARD', 'PREMIUM', 'ENTERPRISE']) {
    const ps = activeSchools.filter((s) => s.plan?.toUpperCase() === plan);
    planBreakdown[plan] = { count: ps.length, revenue: ps.length * (PLAN_PRICES[plan] || 9000) };
  }

  await RevenueSnapshot.findOneAndUpdate(
    { date: today },
    { $set: {
      totalMRR,
      totalARR:       totalMRR * 12,
      activeSchools:  activeSchools.length,
      churnedSchools: schools.filter((s) => s.status === 'inactive').length,
      planBreakdown,
    }},
    { upsert: true },
  );

  console.log(`[SubscriptionCron] Revenue snapshot: MRR INR ${totalMRR.toLocaleString()}`);
}

function registerSubscriptionCronJobs() {
  // Every hour: check expiry + reminders + billing retries
  cron.schedule('0 * * * *', async () => {
    console.log('[CRON] Subscription expiry check...');
    await checkSubscriptionExpiry().catch(console.error);
  });

  // Daily 2:00 AM: Revenue snapshot
  cron.schedule('0 2 * * *', async () => {
    console.log('[CRON] Daily revenue snapshot...');
    await snapshotDailyRevenue().catch(console.error);
  });

  // Every 4 hours: Fraud scan
  cron.schedule('0 */4 * * *', async () => {
    console.log('[CRON] Fraud detection scan...');
    const { runFraudScan } = require('../fraud/fraud.detector');
    await runFraudScan().catch(console.error);
  });

  console.log('[Cron] Subscription cron jobs registered');
}

module.exports = { registerSubscriptionCronJobs, checkSubscriptionExpiry, snapshotDailyRevenue };
