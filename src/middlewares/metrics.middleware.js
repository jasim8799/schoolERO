const redis = require('../config/redis');

async function metricsCollector(req, res, next) {
  const start = Date.now();
  res.on('finish', async () => {
    try {
      const latency = Date.now() - start;
      await redis.incr('stats:requestCount');
      await redis.lpush('metrics:latency', latency);
      await redis.ltrim('metrics:latency', 0, 999);
      if (res.statusCode >= 400) await redis.incr('stats:errorCount');
    } catch (_) {}
  });
  next();
}

module.exports = { metricsCollector };
