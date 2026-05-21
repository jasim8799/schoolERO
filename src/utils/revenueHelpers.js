const redis = require('../config/redis');

const PLAN_MRR = {
  BASIC: 9000,
  STANDARD: 18000,
  PREMIUM: 32000,
  ENTERPRISE: 58000,
};

const GST_RATE = 0.18;

function safePlan(plan) {
  const normalized = (plan || 'BASIC').toUpperCase();
  return PLAN_MRR[normalized] ? normalized : 'BASIC';
}

function planMrr(plan) {
  return PLAN_MRR[safePlan(plan)] || PLAN_MRR.BASIC;
}

function getSubscriptionDaysLeft(school) {
  if (!school?.subscription?.endDate) return 0;
  return Math.ceil((new Date(school.subscription.endDate) - new Date()) / 86400000);
}

function paymentStatusFromSchool(school) {
  const daysLeft = getSubscriptionDaysLeft(school);
  if (daysLeft < 0) return 'FAILED';
  if (daysLeft < 7) return 'PENDING';
  return 'PAID';
}

function relativeTime(date) {
  if (!date) return 'N/A';
  const mins = Math.floor((Date.now() - new Date(date).getTime()) / 60000);
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

async function redisGet(key) {
  try {
    if (typeof redis.get === 'function') return await redis.get(key);
    return await redis.connection.get(key);
  } catch (_) {
    return null;
  }
}

async function redisSetex(key, ttl, value) {
  try {
    if (typeof redis.setex === 'function') return await redis.setex(key, ttl, value);
    return await redis.connection.setex(key, ttl, value);
  } catch (_) {
    return null;
  }
}

async function redisKeys(pattern) {
  try {
    if (typeof redis.keys === 'function') return await redis.keys(pattern);
    return await redis.connection.keys(pattern);
  } catch (_) {
    return [];
  }
}

async function redisDel(...keys) {
  try {
    if (!keys.length) return 0;
    if (typeof redis.del === 'function') return await redis.del(...keys);
    return await redis.connection.del(...keys);
  } catch (_) {
    return 0;
  }
}

module.exports = {
  PLAN_MRR,
  GST_RATE,
  safePlan,
  planMrr,
  getSubscriptionDaysLeft,
  paymentStatusFromSchool,
  relativeTime,
  redisGet,
  redisSetex,
  redisKeys,
  redisDel,
};
