const redis = require('../config/redis');

const cache = {
  async get(key) {
    try {
      const data = await redis.get(key);
      return data ? JSON.parse(data) : null;
    } catch (_) {
      return null;
    }
  },

  async set(key, value, ttlSeconds = 60) {
    try {
      await redis.setex(key, ttlSeconds, JSON.stringify(value));
    } catch (_) {}
  },

  async invalidate(pattern) {
    try {
      const keys = await redis.keys(pattern);
      if (keys.length > 0) await redis.del(...keys);
    } catch (_) {}
  },

  async invalidateSchool(schoolId) {
    await this.invalidate(`school:${schoolId}:*`);
    await this.invalidate('superadmin:dashboard:*');
  }
};

module.exports = { cache };
