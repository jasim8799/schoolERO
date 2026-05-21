const School = require('../models/School');
const { notificationService } = require('../services/notification.service');
const redis = require('../config/redis');

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
