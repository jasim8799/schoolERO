/**
 * Financial Summary Service - Single Source of Truth
 * 
 * Used by both Principal Dashboard and Fee Dashboard to ensure
 * identical fee due calculations across the ERP.
 * 
 * DO NOT create duplicate aggregation logic elsewhere.
 * All fee due calculations must go through this service.
 * 
 * EXTENDED: Now includes Hostel Due and Transport Due calculations
 * for the Principal Dashboard's executive financial metrics.
 */

const mongoose = require('mongoose');
const Bill = require('../models/Bill');
const TransportFee = require('../models/TransportFee');

/**
 * Get Financial Summary - Single Source of Truth
 * 
 * Comprehensive financial summary including:
 * - Fee Due (all bill types - tuition, exam, admission, etc.)
 * - Hostel Due (HOSTEL bills only)
 * - Transport Due (TRANSPORT bills only)
 * 
 * @param {Object} params
 * @param {ObjectId|string} params.schoolId - School ID (required)
 * @param {ObjectId|string} params.sessionId - Optional session ID for filtering
 * @returns {Promise<Object>} Financial summary with all due amounts and counts
 */
module.exports.getFinancialSummary = async ({ schoolId, sessionId }) => {
  // Convert to ObjectId for consistency (same logic as bill.controller.js)
  const safeSchoolId = schoolId?._id
    ? new mongoose.Types.ObjectId(schoolId._id.toString())
    : new mongoose.Types.ObjectId(schoolId?.toString());

  const sessionMatch = sessionId
    ? { sessionId: new mongoose.Types.ObjectId(sessionId.toString()) }
    : {};

  const unpaidBillStatuses = ['UNPAID', 'PARTIAL', 'PENDING', 'NOT_BILLED'];

  // ============================================================
  // FORENSIC MASTER FIX: Extended to include ALL financial metrics
  // in a single aggregation for performance (Phase 8 requirement)
  // ============================================================
  
  // Run all aggregations in parallel for efficiency
  const [
    // Fee Due (all bill types combined - original logic)
    feeUnpaid, feePartial,
    // Hostel Due (billType = HOSTEL only)
    hostelPending,
    // Transport Due (month-level fee rows)
    transportFeePending,
    // Transport Due (billType = TRANSPORT only)
    transportBillPending
  ] = await Promise.all([
    // Fee: All bills with status UNPAID
    Bill.aggregate([
      { $match: { schoolId: safeSchoolId, status: 'UNPAID', dueAmount: { $gt: 0 }, ...sessionMatch } },
      { $group: { _id: null, total: { $sum: '$dueAmount' }, count: { $sum: 1 } } }
    ]),
    // Fee: All bills with status PARTIAL
    Bill.aggregate([
      { $match: { schoolId: safeSchoolId, status: 'PARTIAL', dueAmount: { $gt: 0 }, ...sessionMatch } },
      { $group: { _id: null, total: { $sum: '$dueAmount' }, count: { $sum: 1 } } }
    ]),
    // Hostel: billType = HOSTEL with unpaid statuses
    Bill.aggregate([
      { $match: { schoolId: safeSchoolId, billType: 'HOSTEL', status: { $in: unpaidBillStatuses }, dueAmount: { $gt: 0 }, ...sessionMatch } },
      { $group: { _id: null, total: { $sum: '$dueAmount' }, count: { $sum: 1 } } }
    ]),
    // Transport: month-level fee rows still pending
    TransportFee.aggregate([
      { $match: { schoolId: safeSchoolId, status: 'PENDING', amount: { $gt: 0 }, ...sessionMatch } },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }
    ]),
    // Transport: billType = TRANSPORT with unpaid statuses
    Bill.aggregate([
      { $match: { schoolId: safeSchoolId, billType: 'TRANSPORT', status: { $in: unpaidBillStatuses }, dueAmount: { $gt: 0 }, ...sessionMatch } },
      { $group: { _id: null, total: { $sum: '$dueAmount' }, count: { $sum: 1 } } }
    ])
  ]);

  // Calculate Fee Due totals (all bill types)
  const feeUnpaidTotal = feeUnpaid[0]?.total || 0;
  const feeUnpaidCount = feeUnpaid[0]?.count || 0;
  const feePartialTotal = feePartial[0]?.total || 0;
  const feePartialCount = feePartial[0]?.count || 0;

  // Calculate Hostel Due totals (billType = HOSTEL only)
  const hostelDueTotal = hostelPending[0]?.total || 0;
  const hostelDueCount = hostelPending[0]?.count || 0;

  // Calculate Transport Due totals from both month-level fee rows and bills
  const transportFeePendingTotal = transportFeePending[0]?.total || 0;
  const transportFeePendingCount = transportFeePending[0]?.count || 0;
  const transportBillPendingTotal = transportBillPending[0]?.total || 0;
  const transportBillPendingCount = transportBillPending[0]?.count || 0;

  // Build comprehensive result
  const result = {
    // Fee Due (All bill types) - Original fields maintained for backward compatibility
    totalDue: feeUnpaidTotal + feePartialTotal,
    unpaidDue: feeUnpaidTotal,
    unpaidCount: feeUnpaidCount,
    partialDue: feePartialTotal,
    partialCount: feePartialCount,
    feeDueCount: feeUnpaidCount + feePartialCount,
    
    // Hostel Due - NEW extending the single source of truth
    hostelDueAmount: hostelDueTotal,
    hostelDueCount: hostelDueCount,
    hostelUnpaidDue: hostelDueTotal,
    hostelPartialDue: 0,
    
    // Transport Due - NEW extending the single source of truth
    transportDueAmount: transportFeePendingTotal + transportBillPendingTotal,
    transportDueCount: transportFeePendingCount + transportBillPendingCount,
    transportUnpaidDue: transportFeePendingTotal,
    transportPartialDue: transportBillPendingTotal,
    
    // Combined total for reports (optional - future use)
    overallDueAmount: (feeUnpaidTotal + feePartialTotal) + hostelDueTotal + (transportFeePendingTotal + transportBillPendingTotal)
  };

  // FORENSIC DEBUG LOG
  console.log('[FinancialSummary] schoolId:', safeSchoolId, 'sessionId:', sessionId);
  console.log('[FinancialSummary] Fee Due:', result.totalDue, '| Hostel Due:', result.hostelDueAmount, '| Transport Due:', result.transportDueAmount);
  console.log('[FinancialSummary] Overall Due:', result.overallDueAmount);

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
