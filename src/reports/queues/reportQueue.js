const { Queue, QueueEvents } = require('bullmq');
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

function createNoopQueueEvents() {
  return {
    on() {},
  };
}

const connection = redis?.supportsBullmq ? redis.connection : null;

if (!connection) {
  console.log('[REDIS_FALLBACK] BullMQ reportQueue disabled for Upstash REST mode');
}

const reportQueue = connection
  ? new Queue('reportQueue', {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 3000 },
      removeOnComplete: { count: 500, age: 86400 * 7 },
      removeOnFail: { count: 1000 },
    },
  })
  : createNoopQueue('reportQueue');

const reportQueueEvents = connection
  ? new QueueEvents('reportQueue', { connection })
  : createNoopQueueEvents();

reportQueueEvents.on('completed', ({ jobId, returnvalue }) => {
  global.io?.of('/reports').emit('report:completed', { jobId, result: returnvalue });
});

reportQueueEvents.on('failed', ({ jobId, failedReason }) => {
  global.io?.of('/reports').emit('report:failed', { jobId, reason: failedReason });
});

reportQueueEvents.on('progress', ({ jobId, data }) => {
  global.io?.of('/reports').emit('report:progress', { jobId, ...data });
});

module.exports = { reportQueue };
