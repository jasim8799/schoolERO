const TransportFee = require('../models/TransportFee');
const StudentHostel = require('../models/StudentHostel');
const StudentFee = require('../models/StudentFee');
const StudentFeeAssignment = require('../models/StudentFeeAssignment');
const ExamPayment = require('../models/ExamPayment');

const getExactSessionFilter = (sessionId) => (sessionId ? { sessionId } : {});

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

const parseBillMonthYear = (bill) => {
  const description = String(bill?.description || '');

  const slashMatch = description.match(/\b(\d{1,2})\s*\/\s*(\d{4})\b/);
  if (slashMatch) {
    const month = Number(slashMatch[1]);
    const year = Number(slashMatch[2]);
    if (month >= 1 && month <= 12) return { month, year };
  }

  for (let i = 0; i < MONTHS.length; i++) {
    const regex = new RegExp(`\\b${MONTHS[i]}\\b\\s*(\\d{4})?`, 'i');
    const match = description.match(regex);
    if (match?.[1]) {
      return { month: i + 1, year: Number(match[1]) };
    }
  }

  const dueDate = bill?.dueDate ? new Date(bill.dueDate) : null;
  if (dueDate && !Number.isNaN(dueDate.getTime())) {
    return { month: dueDate.getMonth() + 1, year: dueDate.getFullYear() };
  }

  const createdAt = bill?.createdAt ? new Date(bill.createdAt) : null;
  if (createdAt && !Number.isNaN(createdAt.getTime())) {
    return { month: createdAt.getMonth() + 1, year: createdAt.getFullYear() };
  }

  return { month: null, year: null };
};

/**
 * After any Bill payment, sync the status back to the source model.
 * opts = { mongoSession, sessionId, month, year }
 */
const syncBillPaymentToSource = async (bill, opts = {}) => {
  if (!bill?.sourceId || !bill?.sourceType) return;

  const { mongoSession, sessionId, month, year } = opts;

  try {
    switch (bill.sourceType) {
      case 'StudentTransport': {
        if (bill.status === 'PAID') {
          const { month, year } = parseBillMonthYear(bill);
          const query = {
            _id: bill.sourceId,
            studentId: bill.studentId,
            schoolId: bill.schoolId,
            ...getExactSessionFilter(sessionId || bill.sessionId),
          };

          if (month && year) {
            query.month = month;
            query.year = year;
          }

          let transportFee = await TransportFee.findOneAndUpdate(
            query,
            { status: 'PAID', paymentDate: new Date() },
            { new: true, session: mongoSession }
          );

          if (!transportFee && month && year) {
            const assignment = await require('../models/StudentTransport').findOne({
              _id: bill.sourceId,
              studentId: bill.studentId,
              schoolId: bill.schoolId,
            }).session(mongoSession);

            if (assignment) {
              transportFee = await TransportFee.findOneAndUpdate(
                {
                  studentId: bill.studentId,
                  schoolId: bill.schoolId,
                  routeId: assignment.routeId,
                  month,
                  year,
                  ...getExactSessionFilter(sessionId || bill.sessionId),
                },
                { status: 'PAID', paymentDate: new Date() },
                { new: true, session: mongoSession }
              );

              if (transportFee) {
                bill.sourceId = transportFee._id;
                bill.sourceType = 'StudentTransport';
                await bill.save({ session: mongoSession });
              }
            }
          }

          if (!month || !year) {
            console.warn(`[FeeSync] Transport sync executed without month/year for bill ${bill._id}`);
          }
        }
        break;
      }

      case 'StudentHostel': {
        if (bill.status === 'PAID') {
          let hostelAssignment = await StudentHostel.findOneAndUpdate(
            {
              _id: bill.sourceId,
              studentId: bill.studentId,
              schoolId: bill.schoolId,
            },
            { feeStatus: 'PAID', lastPaymentDate: new Date() },
            { new: true, session: mongoSession }
          );

          if (!hostelAssignment) {
            hostelAssignment = await StudentHostel.findOneAndUpdate(
              {
                studentId: bill.studentId,
                schoolId: bill.schoolId,
                status: 'ACTIVE',
              },
              { feeStatus: 'PAID', lastPaymentDate: new Date() },
              { new: true, session: mongoSession }
            );

            if (hostelAssignment) {
              bill.sourceId = hostelAssignment._id;
              bill.sourceType = 'StudentHostel';
              await bill.save({ session: mongoSession });
            }
          }
        }
        break;
      }

      case 'ExamPayment': {
        if (bill.status === 'PAID') {
          await ExamPayment.findOneAndUpdate(
            {
              _id: bill.sourceId,
              studentId: bill.studentId,
              schoolId: bill.schoolId,
              ...getExactSessionFilter(sessionId || bill.sessionId),
            },
            { status: 'Paid' },
            { session: mongoSession }
          );
        }
        break;
      }

      case 'StudentFee': {
        const studentFee = await StudentFee.findById(bill.sourceId).session(mongoSession);
        if (studentFee) {
          studentFee.paidAmount = bill.paidAmount;
          studentFee.dueAmount = bill.dueAmount;
          if (bill.status === 'PAID') studentFee.status = 'Paid';
          else if (bill.paidAmount > 0) studentFee.status = 'Partial';
          else studentFee.status = 'Due';
          await studentFee.save({ session: mongoSession });
        }
        break;
      }

      case 'StudentFeeAssignment': {
        const assignment = await StudentFeeAssignment.findById(bill.sourceId).session(mongoSession);
        if (assignment) {
          assignment.paidAmount = bill.paidAmount;
          assignment.dueAmount = bill.dueAmount;
          if (bill.status === 'PAID') assignment.status = 'PAID';
          else if (bill.paidAmount > 0) assignment.status = 'PARTIAL';
          else assignment.status = 'PENDING';
          await assignment.save({ session: mongoSession });
        }
        break;
      }

      default:
        break;
    }
  } catch (err) {
    console.error(`[FeeSync] Failed to sync bill ${bill._id} to ${bill.sourceType}:`, err.message);
  }
};

module.exports = { syncBillPaymentToSource };
