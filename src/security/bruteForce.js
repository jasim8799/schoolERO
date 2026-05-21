const redis = require('../config/redis');

async function recordFailedAttempt(key, ttlSeconds = 900) {
  const redisKey = `auth:failed:${key}`;
  const count = await redis.incr(redisKey);
  if (count === 1) await redis.expire(redisKey, ttlSeconds);
  return count;
}

async function clearFailedAttempts(key) {
  return redis.del(`auth:failed:${key}`);
}

async function isBruteForceSuspected(key, threshold = 6) {
  const value = await redis.get(`auth:failed:${key}`);
  return Number(value || 0) >= threshold;
}

module.exports = { recordFailedAttempt, clearFailedAttempts, isBruteForceSuspected };
