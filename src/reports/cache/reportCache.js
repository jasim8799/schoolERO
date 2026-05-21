const { connection: redis } = require('../../config/redis');

async function get(key) {
  try {
    const data = await redis.get(`reports:${key}`);
    return data ? JSON.parse(data) : null;
  } catch (_) {
    return null;
  }
}

async function set(key, value, ttlSeconds = 60) {
  try {
    await redis.setex(`reports:${key}`, ttlSeconds, JSON.stringify(value));
  } catch (_) {
    // Ignore cache write failures.
  }
}

async function invalidate(pattern) {
  try {
    const keys = await redis.keys(`reports:${pattern}*`);
    if (keys.length) {
      await redis.del(...keys);
    }
  } catch (_) {
    // Ignore cache invalidation failures.
  }
}

module.exports = { reportCache: { get, set, invalidate } };
