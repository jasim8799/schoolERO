const LoginSession = require('../models/LoginSession');

async function terminateSession(sessionId) {
  return LoginSession.findByIdAndUpdate(
    sessionId,
    { $set: { isActive: false, forceLoggedOut: true, logoutAt: new Date() } },
    { new: true }
  ).lean();
}

async function terminateUserSessions(userId) {
  const result = await LoginSession.updateMany(
    { userId, isActive: true },
    { $set: { isActive: false, forceLoggedOut: true, logoutAt: new Date() } }
  );
  return result.modifiedCount || 0;
}

module.exports = { terminateSession, terminateUserSessions };
