const School = require('../models/School');
const { notificationService } = require('../services/notification.service');
const redis = require('../config/redis');
const { auditLog } = require('../utils/auditLog');

async function checkSubscriptions() {
  const now = new Date();
  const in7Days = new Date(now.getTime() + 7 * 86400000);
  const in30Days = new Date(now.getTime() + 30 * 86400000);

  const urgentSchools = await School.find({
    isDeleted: false,
    'subscription.endDate': { $gte: now, $lte: in7Days }
  }).lean();

  for (const school of urgentSchools) {
    await notificationService.sendRenewalReminder(school, 'URGENT');
  }

  const reminderSchools = await School.find({
    isDeleted: false,
    'subscription.endDate': { $gt: in7Days, $lte: in30Days }
  }).lean();

  for (const school of reminderSchools) {
    await notificationService.sendRenewalReminder(school, 'STANDARD');
  }

  const expiredSchools = await School.find({
    isDeleted: false,
    status: 'active',
    'subscription.endDate': { $lte: new Date(now.getTime() - 30 * 86400000) }
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
      `status=active && endDate<=now-30d | (${school.status}) && ` +
      `${subEnd ? subEnd.toISOString() : 'INVALID_END_DATE'} <= ${new Date(now.getTime() - 30 * 86400000).toISOString()}`;

    console.log('===== SCHOOL SUSPENSION =====');
    console.log('Job:', 'subscriptionChecker');
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
    console.log('Call Stack:', new Error('[subscriptionChecker] school suspension').stack);
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
      description: `School auto-suspended by subscription checker: ${school.name || school._id}`,
      details: {
        jobName: 'subscriptionChecker',
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
        callStack: new Error('[subscriptionChecker] school suspension audit').stack,
      },
    });

    await School.findByIdAndUpdate(school._id, { status: 'inactive' });
    await notificationService.sendSuspensionNotice(school);
  }

  const expiredCount = await School.countDocuments({
    isDeleted: false,
    'subscription.endDate': { $lte: now }
  });
  await redis.setex('stats:expiredSchools', 3600, expiredCount.toString());

  return {
    urgent: urgentSchools.length,
    reminder: reminderSchools.length,
    suspended: expiredSchools.length
  };
}

module.exports = { checkSubscriptions };
