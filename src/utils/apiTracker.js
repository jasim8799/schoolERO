const redis = require('../config/redis');

async function trackApiRequest(schoolId) {
  if (!schoolId) return;
  const dateKey = new Date().toISOString().slice(0, 10);
  const key = `metrics:api:${schoolId}:${dateKey}`;
  await redis.incr(key);
  await redis.expire(key, 3 * 86400);
}

module.exports = { trackApiRequest };
