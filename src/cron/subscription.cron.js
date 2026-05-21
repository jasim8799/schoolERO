const cron = require('node-cron');
const School = require('../models/School');
const BillingHistory = require('../models/BillingHistory');
const RenewalReminder = require('../models/RenewalReminder');
const RevenueSnapshot = require('../models/RevenueSnapshot');

async function checkSubscriptionExpiry() {
  const now = new Date();

  // ── Auto-suspend schools past 30-day grace period ─────────────────────
  const graceThreshold = new Date(now.getTime() - 30 * 86400000);
  const expiredSchools = await School.find({
    status: 'active',
    'subscription.endDate': { $lte: graceThreshold },
  }).lean();

  for (const school of expiredSchools) {
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
