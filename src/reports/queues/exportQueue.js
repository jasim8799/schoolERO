const { Queue } = require('bullmq');
const { connection } = require('../../config/redis');

const exportQueue = new Queue('exportQueue', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 500 },
  },
});

module.exports = { exportQueue };
