const Payment = require('../../models/Payment');
const Expense = require('../../models/Expense');
const School = require('../../models/School');

async function generateRevenueReport(filters = {}) {
  const { schoolId, startDate, endDate, sessionId } = filters;
  const dateRange = {};
  if (startDate) dateRange.$gte = new Date(startDate);
  if (endDate) dateRange.$lte = new Date(endDate);

  const paymentMatch = {};
  const expenseMatch = {};
  if (schoolId) {
    paymentMatch.schoolId = schoolId;
    expenseMatch.schoolId = schoolId;
  }
  if (Object.keys(dateRange).length > 0) {
    paymentMatch.createdAt = dateRange;
    expenseMatch.createdAt = dateRange;
  }
  if (sessionId) {
    paymentMatch.sessionId = sessionId;
    expenseMatch.sessionId = sessionId;
  }

  const [feeByMonth, totalFees, totalExpenses, schoolCount] = await Promise.all([
    Payment.aggregate([
      { $match: paymentMatch },
      {
        $group: {
          _id: { month: { $month: '$createdAt' }, year: { $year: '$createdAt' } },
          total: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
    ]),
    Payment.aggregate([
      { $match: paymentMatch },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
    Expense.aggregate([
      { $match: expenseMatch },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
    School.countDocuments(schoolId ? { _id: schoolId } : {}),
  ]);

  const totalRevenue = totalFees[0]?.total || 0;
  const totalExp = totalExpenses[0]?.total || 0;

  return {
    tenantId: schoolId ? schoolId.toString() : undefined,
    summary: {
      totalRevenue: Number(totalRevenue.toFixed(2)),
      totalExpenses: Number(totalExp.toFixed(2)),
      netProfit: Number((totalRevenue - totalExp).toFixed(2)),
      transactionCount: totalFees[0]?.count || 0,
      schoolsAnalyzed: schoolCount,
    },
    data: feeByMonth.map((m) => ({
      month: `${m._id.year}-${String(m._id.month).padStart(2, '0')}`,
      revenue: m.total,
      transactions: m.count,
    })),
    trendSeries: feeByMonth.map((m) => m.total),
  };
}

module.exports = { generateRevenueReport };
