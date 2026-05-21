const Payment = require('../../models/Payment');

async function generateFeeReport(filters = {}) {
  const { schoolId, startDate, endDate, sessionId } = filters;
  const match = {};
  if (schoolId) match.schoolId = schoolId;
  if (sessionId) match.sessionId = sessionId;
  if (startDate || endDate) {
    match.createdAt = {};
    if (startDate) match.createdAt.$gte = new Date(startDate);
    if (endDate) match.createdAt.$lte = new Date(endDate);
  }

  const [totals, byMode] = await Promise.all([
    Payment.aggregate([
      { $match: match },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
    Payment.aggregate([
      { $match: match },
      { $group: { _id: '$paymentMode', total: { $sum: '$amount' }, count: { $sum: 1 } } },
      { $sort: { total: -1 } },
    ]),
  ]);

  return {
    summary: {
      totalCollected: totals[0]?.total || 0,
      transactionCount: totals[0]?.count || 0,
      channels: byMode.length,
    },
    data: byMode.map((m) => ({ mode: m._id, total: m.total, count: m.count })),
    trendSeries: byMode.map((m) => m.total),
  };
}

module.exports = { generateFeeReport };
