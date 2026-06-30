/**
 * Financial Summary Service - Single Source of Truth
 * 
 * Used by both Principal Dashboard and Fee Dashboard to ensure
 * identical fee due calculations across the ERP.
 * 
 * DO NOT create duplicate aggregation logic elsewhere.
 * All fee due calculations must go through this service.
 */

const mongoose = require('mongoose');
const Bill = require('../models/Bill');

/**
 * Get Financial Summary - Single Source of Truth
 * 
 * @param {Object} params
 * @param {ObjectId|string} params.schoolId - School ID (required)
 * @param {ObjectId|string} params.sessionId - Optional session ID for filtering
 * @returns {Promise<Object>} Financial summary with totalDue, unpaidDue, partialDue, counts
 */
module.exports.getFinancialSummary = async ({ schoolId, sessionId }) => {
  // Convert to ObjectId for consistency (same logic as bill.controller.js)
  const safeSchoolId = schoolId?._id
    ? new mongoose.Types.ObjectId(schoolId._id.toString())
    : new mongoose.Types.ObjectId(schoolId?.toString());

  const sessionMatch = sessionId
    ? { sessionId: new mongoose.Types.ObjectId(sessionId.toString()) }
    : {};

  const [totalUnpaid, totalPartial] = await Promise.all([
    Bill.aggregate([
      { $match: { schoolId: safeSchoolId, status: 'UNPAID', ...sessionMatch } },
      { $group: { _id: null, total: { $sum: '$dueAmount' }, count: { $sum: 1 } } }
    ]),
    Bill.aggregate([
      { $match: { schoolId: safeSchoolId, status: 'PARTIAL', ...sessionMatch } },
      { $group: { _id: null, total: { $sum: '$dueAmount' }, count: { $sum: 1 } } }
    ])
  ]);

  const result = {
    totalDue: (totalUnpaid[0]?.total || 0) + (totalPartial[0]?.total || 0),
    unpaidDue: totalUnpaid[0]?.total || 0,
    unpaidCount: totalUnpaid[0]?.count || 0,
    partialDue: totalPartial[0]?.total || 0,
    partialCount: totalPartial[0]?.count || 0
  };

  // FORENSIC DEBUG LOG
  console.log('[FinancialSummary] schoolId:', safeSchoolId, 'sessionId:', sessionId);
  console.log('[FinancialSummary] Result:', JSON.stringify(result));

  return result;
};

/**
 * Get Fee Overdue Count
 * Count of bills that are overdue (UNPAID or PARTIAL) with past dueDate
 * 
 * @param {Object} params
 * @param {ObjectId|string} params.schoolId - School ID
 * @param {ObjectId|string} params.sessionId - Optional session ID
 * @returns {Promise<number>} Count of overdue bills
 */
module.exports.getFeeOverdueCount = async ({ schoolId, sessionId }) => {
  const mongoose = require('mongoose');
  
  const safeSchoolId = schoolId?._id
    ? new mongoose.Types.ObjectId(schoolId._id.toString())
    : new mongoose.Types.ObjectId(schoolId?.toString());

  const sessionMatch = sessionId
    ? { sessionId: new mongoose.Types.ObjectId(sessionId.toString()) }
    : {};

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const count = await Bill.countDocuments({
    schoolId: safeSchoolId,
    ...sessionMatch,
    status: { $in: ['UNPAID', 'PARTIAL'] },
    dueAmount: { $gt: 0 },
    dueDate: { $lt: today }
  });

  return count;
};

/**
 * Get Today's Collection
 * Total payment collected today
 * 
 * @param {Object} params
 * @param {ObjectId|string} params.schoolId - School ID
 * @param {ObjectId|string} params.sessionId - Optional session ID
 * @returns {Promise<number>} Today's total collection
 */
module.exports.getTodayCollection = async ({ schoolId, sessionId }) => {
  const mongoose = require('mongoose');
  const Payment = require('../models/Payment');
  
  const safeSchoolId = schoolId?._id
    ? new mongoose.Types.ObjectId(schoolId._id.toString())
    : new mongoose.Types.ObjectId(schoolId?.toString());

  const sessionMatch = sessionId
    ? { sessionId: new mongoose.Types.ObjectId(sessionId.toString()) }
    : {};

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const [todayPayments] = await Promise.all([
    Payment.aggregate([
      {
        $match: {
          schoolId: safeSchoolId,
          ...sessionMatch,
          paymentDate: { $gte: today, $lt: tomorrow }
        }
      },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }
    ])
  ]);

  return {
    total: todayPayments[0]?.total || 0,
    count: todayPayments[0]?.count || 0
  };
};
