const { Redis } = require('ioredis');

const connection = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD,
  lazyConnect: true,
  connectTimeout: 5000,
  maxRetriesPerRequest: null, // Required by BullMQ
  enableReadyCheck: false,
  retryStrategy: (times) => Math.min(times * 100, 3000),
  reconnectOnError: (err) => {
    const targetErrors = ['READONLY', 'ECONNRESET', 'ETIMEDOUT'];
    return targetErrors.some((e) => err.message.includes(e));
  },
});

connection.on('connect', () => console.log('[Redis] Connected'));

// Keep logs useful without flooding the terminal when Redis is offline.
let lastRedisErrorLogAt = 0;
connection.on('error', (err) => {
  const now = Date.now();
  if (now - lastRedisErrorLogAt > 30000) {
    console.error('[Redis] Error:', err.message);
    lastRedisErrorLogAt = now;
  }
});

module.exports = { connection };
