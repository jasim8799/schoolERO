const { Worker } = require('bullmq');
const redis = require('../../config/redis');
const ExportHistory = require('../../models/ExportHistory');

function startExportWorker() {
  const connection = redis?.supportsBullmq ? redis.connection : null;
  if (!connection) {
    console.log('[REDIS_FALLBACK] Export worker not started (BullMQ disabled for Upstash REST mode)');
    return {
      on() {},
      async close() {},
    };
  }

  return new Worker(
    'exportQueue',
    async (job) => {
      const { reportId, destination, exportType } = job.data;

      await ExportHistory.create({
        reportId,
        exportType,
        destination,
        deliveryStatus: 'DELIVERED',
        deliveredAt: new Date(),
      });

      return { reportId, destination, delivered: true };
    },
    { connection, concurrency: 2 }
  );
}

module.exports = { startExportWorker };
