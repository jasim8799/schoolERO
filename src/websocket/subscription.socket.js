const School = require('../models/School');
const BillingHistory = require('../models/BillingHistory');
const FraudAlert = require('../models/FraudAlert');

function initSubscriptionSocket(io) {
  const subsNs = io.of('/subscriptions');

  // Middleware: JWT auth, SUPER_ADMIN only
  subsNs.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Authentication required'));
    try {
      const jwt     = require('jsonwebtoken');
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (decoded.role !== 'SUPER_ADMIN') return next(new Error('Unauthorized'));
      next();
    } catch (e) {
      next(new Error('Invalid token'));
    }
  });

  subsNs.on('connection', async (socket) => {
    console.log(`[SubscriptionSocket] Connected: ${socket.id}`);

    // Send immediate snapshot on connect
    try {
      socket.emit('subscriptions:snapshot', await _buildLiveSnapshot());
    } catch (err) {
      console.error('[SubscriptionSocket] Initial snapshot error:', err.message);
    }

    socket.on('disconnect', () => {
      console.log(`[SubscriptionSocket] Disconnected: ${socket.id}`);
    });
  });

  // Broadcast live snapshot every 15 seconds
  setInterval(async () => {
    try {
      const snapshot = await _buildLiveSnapshot();
      subsNs.emit('subscriptions:snapshot', snapshot);
    } catch (err) {
      console.error('[SubscriptionSocket] Snapshot error:', err.message);
    }
  }, 15000);

  return subsNs;
}

async function _buildLiveSnapshot() {
  const now    = new Date();
  const hourAgo = new Date(now - 3600000);

  const [
    expiringSchools,
    recentBilling,
    unresolvedFraud,
    schoolAnalytics,
  ] = await Promise.all([
    School.countDocuments({
      'subscription.endDate': { $gte: now, $lte: new Date(now.getTime() + 7 * 86400000) },
      status: 'active',
    }),
    BillingHistory.find({ createdAt: { $gte: hourAgo } }).sort({ createdAt: -1 }).limit(5).lean(),
    FraudAlert.countDocuments({ resolved: false, severity: { $in: ['HIGH', 'CRITICAL'] } }),
    School.aggregate([
      { $match: { isDeleted: { $ne: true } } },
      { $group: {
        _id: null,
        totalMRR: { $sum: {
          $switch: {
            branches: [
              { case: { $eq: ['$plan', 'BASIC'] },      then: 9000 },
              { case: { $eq: ['$plan', 'STANDARD'] },   then: 18000 },
              { case: { $eq: ['$plan', 'PREMIUM'] },    then: 32000 },
              { case: { $eq: ['$plan', 'ENTERPRISE'] }, then: 58000 },
            ],
            default: 9000,
          },
        }},
        activeCount: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } },
      }},
    ]),
  ]);

  return {
    timestamp:              now,
    expiringIn7Days:        expiringSchools,
    unresolvedFraudAlerts:  unresolvedFraud,
    liveRevenue:            schoolAnalytics[0]?.totalMRR || 0,
    activeSubscriptions:    schoolAnalytics[0]?.activeCount || 0,
    recentPayments: recentBilling.map((b) => ({
      invoiceNumber: b.invoiceNumber,
      amount:        b.amount / 100,   // Convert paise to INR
      status:        b.status,
      plan:          b.plan,
      createdAt:     b.createdAt,
    })),
  };
}

module.exports = { initSubscriptionSocket };
