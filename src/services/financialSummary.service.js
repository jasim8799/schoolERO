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
const StudentHostel = require('../models/StudentHostel');
const Hostel = require('../models/Hostel');
const StudentTransport = require('../models/StudentTransport');
const Route = require('../models/Route');

const MONTH_NAMES = [
  '',
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

function normalizeStatus(rawStatus) {
  const status = (rawStatus ?? '').toString().toUpperCase();
  switch (status) {
    case 'PAID':
    case 'UNPAID':
    case 'PARTIAL':
    case 'PENDING':
    case 'NOT_BILLED':
    case 'CANCELLED':
      return status;
    default:
      return 'NOT_BILLED';
  }
}

function buildAcademicMonths(now = new Date()) {
  const academicStartYear = now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1;
  const months = [];

  for (let month = 4; month <= 12; month++) {
    months.push({
      month,
      year: academicStartYear,
      label: `${MONTH_NAMES[month]} ${academicStartYear}`,
    });
  }

  for (let month = 1; month <= 3; month++) {
    months.push({
      month,
      year: academicStartYear + 1,
      label: `${MONTH_NAMES[month]} ${academicStartYear + 1}`,
    });
  }

  const cutoff = new Date(now.getFullYear(), now.getMonth());
  return months.filter((md) => new Date(md.year, md.month - 1) <= cutoff);
}

function isPendingStatus(status) {
  const normalized = normalizeStatus(status);
  return normalized !== 'PAID' && normalized !== 'CANCELLED';
}

function extractStudentId(record) {
  const studentData = record?.studentId;
  if (studentData && typeof studentData === 'object') {
    return studentData._id?.toString() ?? studentData.id?.toString() ?? '';
  }
  return studentData?.toString() ?? '';
}

function findMonthMatch(history, label, month, year) {
  for (const raw of history) {
    const item = raw && typeof raw === 'object' ? raw : {};
    const description = item.description?.toString() ?? '';
    if (description.includes(label) || description.includes(`${month}/${year}`)) {
      return item;
    }
  }
  return null;
}

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

  const now = new Date();
  const academicMonths = buildAcademicMonths(now);

  // Fee Due (existing global summary) still uses the shared Bill-based logic.
  const [feeUnpaid, feePartial] = await Promise.all([
    Bill.aggregate([
      { $match: { schoolId: safeSchoolId, status: 'UNPAID', dueAmount: { $gt: 0 }, ...sessionMatch } },
      { $group: { _id: null, total: { $sum: '$dueAmount' }, count: { $sum: 1 } } },
    ]),
    Bill.aggregate([
      { $match: { schoolId: safeSchoolId, status: 'PARTIAL', dueAmount: { $gt: 0 }, ...sessionMatch } },
      { $group: { _id: null, total: { $sum: '$dueAmount' }, count: { $sum: 1 } } },
    ]),
  ]);

  const [hostelAssignments, hostelBills, transportAssignments, transportBills, transportFees] =
    await Promise.all([
      StudentHostel.find({ schoolId: safeSchoolId, status: 'ACTIVE' })
        .populate('hostelId', 'monthlyFee')
        .lean(),
      Bill.find({ schoolId: safeSchoolId, billType: 'HOSTEL', ...sessionMatch, status: { $ne: 'CANCELLED' } })
        .select('studentId description status totalAmount dueAmount createdAt')
        .lean(),
      StudentTransport.find({ schoolId: safeSchoolId, status: 'ACTIVE' })
        .populate('routeId', 'monthlyFee')
        .lean(),
      Bill.find({ schoolId: safeSchoolId, billType: 'TRANSPORT', ...sessionMatch, status: { $ne: 'CANCELLED' } })
        .select('studentId description status totalAmount dueAmount createdAt')
        .lean(),
      TransportFee.find({ schoolId: safeSchoolId, ...sessionMatch })
        .select('studentId month year amount status')
        .lean(),
    ]);

  const [hostelAssignmentStudentIds, transportAssignmentStudentIds] = [
    new Set(hostelAssignments.map((assignment) => extractStudentId(assignment)).filter(Boolean)),
    new Set(transportAssignments.map((assignment) => extractStudentId(assignment)).filter(Boolean)),
  ];

  const hostelAdmissionBills = hostelBills.filter((bill) => {
    const status = normalizeStatus(bill.status);
    if (status === 'CANCELLED') return false;
    const studentId = extractStudentId(bill);
    const description = bill.description?.toString() ?? '';
    return studentId && (!hostelAssignmentStudentIds.has(studentId) || description.toLowerCase().includes('admission'));
  });

  const transportAdmissionBills = transportBills.filter((bill) => {
    const status = normalizeStatus(bill.status);
    if (status === 'CANCELLED') return false;
    const studentId = extractStudentId(bill);
    const description = bill.description?.toString() ?? '';
    return studentId && (!transportAssignmentStudentIds.has(studentId) || description.toLowerCase().includes('admission'));
  });

  const hostelBillsByStudent = new Map();
  for (const bill of hostelBills) {
    const studentId = extractStudentId(bill);
    if (!studentId) continue;
    if (!hostelBillsByStudent.has(studentId)) hostelBillsByStudent.set(studentId, []);
    hostelBillsByStudent.get(studentId).push(bill);
  }

  const transportBillsByStudent = new Map();
  for (const bill of transportBills) {
    const studentId = extractStudentId(bill);
    if (!studentId) continue;
    if (!transportBillsByStudent.has(studentId)) transportBillsByStudent.set(studentId, []);
    transportBillsByStudent.get(studentId).push(bill);
  }

  const transportFeesByStudentMonth = new Map();
  for (const fee of transportFees) {
    const studentId = extractStudentId(fee);
    if (!studentId) continue;
    const key = `${studentId}|${fee.month}|${fee.year}`;
    transportFeesByStudentMonth.set(key, fee);
  }

  let hostelDueTotal = 0;
  let hostelDueCount = 0;
  for (const assignment of hostelAssignments) {
    const studentId = extractStudentId(assignment);
    if (!studentId) continue;
    const monthlyFee = assignment?.hostelId?.monthlyFee || 0;
    const history = hostelBillsByStudent.get(studentId) || [];

    for (const monthData of academicMonths) {
      const match = findMonthMatch(history, monthData.label, monthData.month, monthData.year);
      const status = normalizeStatus(match?.status);
      const totalAmount = match?.totalAmount;
      const dueAmount = match?.dueAmount;
      const effectiveAmount = status === 'PAID'
        ? (totalAmount ?? monthlyFee)
        : (dueAmount ?? totalAmount ?? monthlyFee);

      if (isPendingStatus(status)) {
        hostelDueTotal += effectiveAmount;
        hostelDueCount += 1;
      }
    }
  }

  for (const bill of hostelAdmissionBills) {
    const status = normalizeStatus(bill.status);
    if (status === 'PAID') continue;
    const totalAmount = bill.totalAmount;
    const dueAmount = bill.dueAmount;
    hostelDueTotal += (dueAmount ?? totalAmount ?? 0);
    hostelDueCount += 1;
  }

  let transportDueTotal = 0;
  let transportDueCount = 0;
  for (const assignment of transportAssignments) {
    const studentId = extractStudentId(assignment);
    if (!studentId) continue;
    const monthlyFee = assignment?.routeId?.monthlyFee || 0;
    const history = transportBillsByStudent.get(studentId) || [];

    for (const monthData of academicMonths) {
      const match = findMonthMatch(history, monthData.label, monthData.month, monthData.year);
      const feeKey = `${studentId}|${monthData.month}|${monthData.year}`;
      const feeRecord = transportFeesByStudentMonth.get(feeKey);

      let status = 'NOT_BILLED';
      let totalAmount = null;
      let dueAmount = null;

      if (match) {
        status = normalizeStatus(match.status);
        totalAmount = match.totalAmount;
        dueAmount = match.dueAmount;
      } else if (feeRecord) {
        status = normalizeStatus(feeRecord.status);
        totalAmount = feeRecord.amount;
        dueAmount = feeRecord.amount;
      }

      const effectiveAmount = status === 'PAID'
        ? (totalAmount ?? monthlyFee)
        : (dueAmount ?? totalAmount ?? monthlyFee);

      if (isPendingStatus(status)) {
        transportDueTotal += effectiveAmount;
        transportDueCount += 1;
      }
    }
  }

  for (const bill of transportAdmissionBills) {
    const status = normalizeStatus(bill.status);
    if (status === 'PAID') continue;
    const totalAmount = bill.totalAmount;
    const dueAmount = bill.dueAmount;
    transportDueTotal += (dueAmount ?? totalAmount ?? 0);
    transportDueCount += 1;
  }

  const transportDueAmount = transportDueTotal;

  const feeUnpaidTotal = feeUnpaid[0]?.total || 0;
  const feeUnpaidCount = feeUnpaid[0]?.count || 0;
  const feePartialTotal = feePartial[0]?.total || 0;
  const feePartialCount = feePartial[0]?.count || 0;

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
    hostelDueCount,
    hostelUnpaidDue: hostelDueTotal,
    hostelPartialDue: 0,
    
    // Transport Due - NEW extending the single source of truth
    transportDueAmount,
    transportDueCount,
    transportUnpaidDue: transportDueTotal,
    transportPartialDue: 0,
    
    // Combined total for reports (optional - future use)
    overallDueAmount: (feeUnpaidTotal + feePartialTotal) + hostelDueTotal + transportDueTotal
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
