const LoginSession = require('../models/LoginSession');
const SecurityLog = require('../models/SecurityLog');

async function runCleanup() {
  const oldSessionsDate = new Date(Date.now() - 30 * 86400000);
  const oldSecurityDate = new Date(Date.now() - 90 * 86400000);

  const [sessions, logs] = await Promise.all([
    LoginSession.deleteMany({ isActive: false, updatedAt: { $lt: oldSessionsDate } }),
    SecurityLog.deleteMany({ createdAt: { $lt: oldSecurityDate } })
  ]);

  return {
    deletedSessions: sessions.deletedCount || 0,
    deletedSecurityLogs: logs.deletedCount || 0
  };
}

module.exports = { runCleanup };
