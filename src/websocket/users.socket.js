const User = require('../models/User');
const LoginSession = require('../models/LoginSession');

function initUsersSocket(io) {
  const usersNs = io.of('/users');

  usersNs.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Auth required'));

    try {
      const jwt = require('jsonwebtoken');
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (!['SUPER_ADMIN', 'PRINCIPAL'].includes(decoded.role)) {
        return next(new Error('Unauthorized'));
      }
      socket.user = decoded;
      return next();
    } catch (_) {
      return next(new Error('Invalid token'));
    }
  });

  usersNs.on('connection', async (socket) => {
    socket.emit('users:snapshot', await _buildUsersSnapshot());
    socket.on('disconnect', () => {});
  });

  setInterval(async () => {
    try {
      usersNs.emit('users:snapshot', await _buildUsersSnapshot());
    } catch (err) {
      console.error('[UsersSocket] Snapshot error:', err.message);
    }
  }, 30000);

  global.broadcastUserSecurityUpdate = (payload) => {
    usersNs.emit('users:security-update', payload);
  };

  return usersNs;
}

async function _buildUsersSnapshot() {
  const [totals, activeSessions] = await Promise.all([
    User.aggregate([
      { $match: { isDeleted: { $ne: true } } },
      {
        $group: {
          _id: '$riskLevel',
          count: { $sum: 1 },
        },
      },
    ]),
    LoginSession.countDocuments({ isActive: true }),
  ]);

  const byRisk = { LOW: 0, MEDIUM: 0, HIGH: 0 };
  totals.forEach((row) => {
    const key = row._id || 'LOW';
    byRisk[key] = row.count;
  });

  return {
    timestamp: new Date(),
    activeSessions,
    risk: byRisk,
  };
}

module.exports = { initUsersSocket };
