const User = require('../models/User');
const AuditLog = require('../models/AuditLog');

async function runInactiveUserScanner(days = 45) {
  const threshold = new Date(Date.now() - days * 86400000);
  const users = await User.find({
    isDeleted: { $ne: true },
    $or: [{ lastLogin: { $exists: false } }, { lastLogin: { $lt: threshold } }]
  })
    .select('_id schoolId role')
    .lean();

  if (users.length) {
    await AuditLog.create({
      role: 'SYSTEM',
      action: 'SESSION_UPDATED',
      entityType: 'LOGIN_SESSION',
      description: `Inactive users detected: ${users.length}`,
      details: { count: users.length },
      ipAddress: '0.0.0.0'
    });
  }

  return { inactiveUsers: users.length };
}

module.exports = { runInactiveUserScanner };
