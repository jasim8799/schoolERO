const { Worker } = require('bullmq');
const { connection } = require('../../config/redis');
const ExportHistory = require('../../models/ExportHistory');

function startExportWorker() {
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
