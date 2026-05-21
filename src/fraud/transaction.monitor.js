const TransactionLog = require('../models/TransactionLog');
const FraudSignal = require('../models/FraudSignal');

async function runRevenueTransactionMonitor() {
  const sixHoursAgo = new Date(Date.now() - 6 * 3600000);

  const suspicious = await TransactionLog.aggregate([
    { $match: { createdAt: { $gte: sixHoursAgo } } },
    {
      $group: {
        _id: '$schoolId',
        total: { $sum: 1 },
        failed: { $sum: { $cond: [{ $eq: ['$status', 'FAILED'] }, 1, 0] } },
        retries: { $sum: { $cond: [{ $gt: ['$retryCount', 1] }, 1, 0] } },
      },
    },
    {
      $project: {
        schoolId: '$_id',
        failRate: {
          $cond: [{ $gt: ['$total', 0] }, { $divide: ['$failed', '$total'] }, 0],
        },
        retries: 1,
        total: 1,
      },
    },
    {
      $match: {
        $or: [
          { failRate: { $gte: 0.35 }, total: { $gte: 5 } },
          { retries: { $gte: 5 } },
        ],
      },
    },
  ]);

  for (const row of suspicious) {
    const score = Math.min(1, parseFloat((row.failRate * 0.7 + (row.retries / 10) * 0.3).toFixed(3)));
    const severity = score >= 0.8 ? 'CRITICAL' : score >= 0.6 ? 'HIGH' : 'MEDIUM';

    await FraudSignal.create({
      schoolId: row.schoolId,
      signalType: row.failRate >= 0.35 ? 'FAILED_PAYMENT_SPIKE' : 'RETRY_ABUSE',
      score,
      severity,
      metadata: {
        totalTransactions: row.total,
        failRate: row.failRate,
        retries: row.retries,
      },
    });
  }

  return { scannedGroups: suspicious.length };
}

module.exports = { runRevenueTransactionMonitor };
