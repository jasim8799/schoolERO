const redis = require('../config/redis');

module.exports = {
  get: (key) => redis.get(key),
  set: (key, value) => redis.set(key, value),
  setex: (key, ttl, value) => redis.setex(key, ttl, value),
  del: (key) => redis.del(key),
  incr: (key) => redis.incr(key),
  expire: (key, ttl) => redis.expire(key, ttl)
};
