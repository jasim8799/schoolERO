const cron = require('node-cron');
const { runAnalyticsSnapshot } = require('./analyticsSnapshot.job');
const { updateAllSchoolsHealth } = require('../services/healthScoring.service');
const { checkSubscriptions } = require('./subscriptionChecker.job');
const { collectInfraMetrics } = require('./infraMetrics.job');
const { runHealthScanner } = require('./healthScanner.job');
const { runNightlyBackup } = require('./backupJob');
const { runNotificationDispatch } = require('./notificationJob');
const { runCleanup } = require('./cleanupJob');
const { runInactiveUserScanner } = require('./inactiveUserScanner.job');
const { registerSubscriptionCronJobs } = require('../cron/subscription.cron');
const { registerRevenueCronJobs } = require('../cron/revenue.cron');
const { registerUsersCronJobs } = require('../cron/users.cron');

function registerAllCronJobs() {
  cron.schedule('*/5 * * * *', async () => {
    await collectInfraMetrics().catch((err) => console.error('[CRON][infra]', err.message));
  });

  cron.schedule('0 * * * *', async () => {
    await runAnalyticsSnapshot().catch((err) => console.error('[CRON][analytics]', err.message));
  });

  cron.schedule('0 2 * * *', async () => {
    await updateAllSchoolsHealth().catch((err) => console.error('[CRON][health]', err.message));
  });

  cron.schedule('30 2 * * *', async () => {
    await runHealthScanner().catch((err) => console.error('[CRON][health-scanner]', err.message));
  });

  cron.schedule('0 3 * * *', async () => {
    await checkSubscriptions().catch((err) => console.error('[CRON][subscription]', err.message));
  });

  cron.schedule('30 3 * * *', async () => {
    await runNightlyBackup().catch((err) => console.error('[CRON][backup]', err.message));
  });

  cron.schedule('*/10 * * * *', async () => {
    await runNotificationDispatch().catch((err) => console.error('[CRON][notification]', err.message));
  });

  cron.schedule('15 4 * * *', async () => {
    await runInactiveUserScanner().catch((err) => console.error('[CRON][inactive-users]', err.message));
  });

  cron.schedule('45 4 * * *', async () => {
    await runCleanup().catch((err) => console.error('[CRON][cleanup]', err.message));
  });

  // Enterprise subscription lifecycle + fraud
  registerSubscriptionCronJobs();

  // Enterprise revenue analytics + snapshots
  registerRevenueCronJobs();

  // Enterprise IAM threat profiling + session intelligence
  registerUsersCronJobs();

  console.log('[CRON] Enterprise jobs registered');
}

module.exports = { registerAllCronJobs };
