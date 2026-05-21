const School = require('../models/School');

function getSubscriptionStatus(subscription = {}) {
  const now = new Date();
  const endDate = new Date(subscription.endDate || now);
  const graceDays = subscription.gracePeriodDays || 30;
  const graceEnd = new Date(endDate.getTime() + graceDays * 86400000);

  if (now > graceEnd) return 'EXPIRED';
  if (now > endDate) return 'GRACE';
  return 'ACTIVE';
}

async function renewSubscription(schoolId, months = 12) {
  const school = await School.findById(schoolId);
  if (!school) return null;

  const base = new Date(Math.max(Date.now(), new Date(school.subscription?.endDate || Date.now()).getTime()));
  base.setMonth(base.getMonth() + months);

  school.subscription = school.subscription || {};
  school.subscription.endDate = base;
  school.subscription.lastRenewalDate = new Date();
  school.subscription.isExpired = false;
  school.status = 'active';
  await school.save();
  return school;
}

module.exports = { getSubscriptionStatus, renewSubscription };
