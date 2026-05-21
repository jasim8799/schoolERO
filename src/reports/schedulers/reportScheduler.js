const cron = require('node-cron');
const ReportSchedule = require('../../models/ReportSchedule');
const { createReport } = require('../engine/reportEngine');

const schedulerRegistry = [];

async function registerReportSchedulers() {
  schedulerRegistry.forEach((job) => job.stop());
  schedulerRegistry.length = 0;

  const schedules = await ReportSchedule.find({ enabled: true }).lean();

  schedules.forEach((schedule) => {
    if (!cron.validate(schedule.cronExpression)) {
      return;
    }

    const task = cron.schedule(
      schedule.cronExpression,
      async () => {
        await createReport({
          category: schedule.reportCategory,
          exportType: schedule.exportType || 'PDF',
          schoolId: schedule.schoolId,
          tenantId: schedule.tenantId,
          mode: 'Scheduled',
          filters: schedule.filters || {},
          generatedBy: 'scheduler@erp',
          generatedById: schedule.createdBy,
          scheduleId: schedule._id,
        });

        await ReportSchedule.updateOne(
          { _id: schedule._id },
          { $set: { lastRun: new Date() } }
        );
      },
      { timezone: schedule.timezone || 'Asia/Kolkata' }
    );

    schedulerRegistry.push(task);
  });

  return schedulerRegistry.length;
}

module.exports = { registerReportSchedulers };
