const TransactionLog = require('../models/TransactionLog');
const { calculateRealMRR } = require('../analytics/mrr.analytics');

function initRevenueSocket(io) {
  const revenueNs = io.of('/revenue');

  revenueNs.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Auth required'));

    try {
      const jwt = require('jsonwebtoken');
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (decoded.role !== 'SUPER_ADMIN') return next(new Error('Unauthorized'));
      next();
    } catch (_) {
      next(new Error('Invalid token'));
    }
  });

  revenueNs.on('connection', async (socket) => {
    console.log(`[RevenueSocket] Connected: ${socket.id}`);
    socket.emit('revenue:snapshot', await _buildLiveSnapshot());
    socket.on('disconnect', () => console.log(`[RevenueSocket] Disconnected: ${socket.id}`));
  });

  setInterval(async () => {
    try {
      const snapshot = await _buildLiveSnapshot();
      revenueNs.emit('revenue:snapshot', snapshot);
    } catch (err) {
      console.error('[RevenueSocket] Error:', err.message);
    }
  }, 20000);

  global.broadcastTransaction = (transaction) => {
    revenueNs.emit('revenue:transaction', transaction);
  };

  return revenueNs;
}

async function _buildLiveSnapshot() {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [recentTx, todayStats, mrrData] = await Promise.all([
    TransactionLog.find().sort({ createdAt: -1 }).limit(5).populate('schoolId', 'name').lean(),
    TransactionLog.aggregate([
      { $match: { createdAt: { $gte: todayStart } } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          paid: { $sum: { $cond: [{ $eq: ['$status', 'PAID'] }, 1, 0] } },
          volume: {
            $sum: {
              $cond: [{ $eq: ['$status', 'PAID'] }, { $divide: ['$amount', 100] }, 0],
            },
          },
        },
      },
    ]),
    calculateRealMRR(),
  ]);

  return {
    timestamp: new Date(),
    liveMRR: mrrData.totalMRR,
    liveARR: mrrData.totalARR,
    todayTransactions: todayStats[0]?.total || 0,
    todayVolume: todayStats[0]?.volume || 0,
    recentTransactions: recentTx.map((t) => ({
      school: t.schoolId?.name || t.schoolName,
      amount: Number(t.amount || 0) / 100,
      status: t.status,
      gateway: t.gateway,
      risk: t.riskLevel,
      time: t.createdAt,
    })),
  };
}

module.exports = { initRevenueSocket };
