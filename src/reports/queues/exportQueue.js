const { Queue } = require('bullmq');
const redis = require('../../config/redis');

function createNoopQueue(name) {
  return {
    name,
    async add(jobName, data) {
      console.log(`[REDIS_FALLBACK] No Redis queue backend available, noop add for ${name}:${jobName}`);
      return { id: `noop-${name}-${Date.now()}`, name: jobName, data };
    },
  };
}

const connection = redis?.supportsBullmq ? redis.connection : null;

if (!connection) {
  console.log('[REDIS_FALLBACK] BullMQ exportQueue disabled for Upstash REST mode');
}

const exportQueue = connection
  ? new Queue('exportQueue', {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: { count: 200 },
      removeOnFail: { count: 500 },
    },
  })
  : createNoopQueue('exportQueue');

module.exports = { exportQueue };
