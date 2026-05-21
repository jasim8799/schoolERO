const Payment = require('../../models/Payment');

async function getRevenueByMonth(months = 6) {
  const start = new Date();
  start.setMonth(start.getMonth() - months);

  return Payment.aggregate([
    { $match: { paymentDate: { $gte: start }, status: { $in: ['PAID', 'SUCCESS'] } } },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m', date: '$paymentDate' } },
        amount: { $sum: '$amount' },
        txCount: { $sum: 1 }
      }
    },
    { $sort: { _id: 1 } }
  ]);
}

module.exports = { getRevenueByMonth };
