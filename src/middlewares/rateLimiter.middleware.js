const redis = require('../config/redis');

function redisRateLimiter({ keyPrefix = 'ratelimit', windowSeconds = 60, max = 120 } = {}) {
  return async (req, res, next) => {
    try {
      const key = `${keyPrefix}:${req.ip}`;
      const count = await redis.incr(key);
      if (count === 1) await redis.expire(key, windowSeconds);

      if (count > max) {
        return res.status(429).json({ success: false, message: 'Too many requests' });
      }
      return next();
    } catch (_) {
      return next();
    }
  };
}

module.exports = { redisRateLimiter };
