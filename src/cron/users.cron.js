const cron = require('node-cron');
const User = require('../models/User');
const LoginSession = require('../models/LoginSession');
const UserActivityLog = require('../models/UserActivityLog');
const { updateAllUserThreatProfiles } = require('../security/user.threat.scorer');
const redis = require('../config/redis');

async function syncUserSessionStats() {
  const activeSessions = await LoginSession.aggregate([
    { $match: { isActive: true } },
    {
      $group: {
        _id: '$userId',
        activeSessions: { $sum: 1 },
        devices: { $addToSet: '$deviceHash' },
      },
    },
  ]);

  const updates = activeSessions.map((row) =>
    User.updateOne(
      { _id: row._id },
      {
        $set: {
          activeSessions: row.activeSessions,
          liveDevices: row.devices.filter(Boolean).length || 1,
        },
      }
    )
  );

  if (updates.length > 0) {
    await Promise.all(updates);
  }
}

async function cleanupOldUserActivity() {
  const cutoff = new Date(Date.now() - 90 * 86400000);
  await UserActivityLog.deleteMany({ createdAt: { $lt: cutoff } });
}

async function invalidateUserDashCaches() {
  const keys = await redis.keys('users:dashboard:*').catch(() => []);
  if (keys.length > 0) {
    await Promise.all(keys.map((key) => redis.del(key).catch(() => {})));
  }
  await redis.del('users:analytics:summary').catch(() => {});
}

function registerUsersCronJobs() {
  cron.schedule('*/20 * * * *', async () => {
    await syncUserSessionStats().catch((err) => console.error('[UsersCron][sessions]', err.message));
  });

  cron.schedule('0 */4 * * *', async () => {
    await updateAllUserThreatProfiles().catch((err) => console.error('[UsersCron][threats]', err.message));
    await invalidateUserDashCaches().catch(() => {});
  });

  cron.schedule('15 2 * * *', async () => {
    await cleanupOldUserActivity().catch((err) => console.error('[UsersCron][cleanup]', err.message));
  });

  console.log('[Cron] Users IAM cron jobs registered');
}

module.exports = { registerUsersCronJobs, syncUserSessionStats };
