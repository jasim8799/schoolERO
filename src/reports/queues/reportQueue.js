const { Queue, QueueEvents } = require('bullmq');
const { connection } = require('../../config/redis');

const reportQueue = new Queue('reportQueue', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 3000 },
    removeOnComplete: { count: 500, age: 86400 * 7 },
    removeOnFail: { count: 1000 },
  },
});

const reportQueueEvents = new QueueEvents('reportQueue', { connection });

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
