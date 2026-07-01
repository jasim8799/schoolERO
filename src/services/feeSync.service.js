const TransportFee = require('../models/TransportFee');
const StudentHostel = require('../models/StudentHostel');
const StudentFee = require('../models/StudentFee');
const StudentFeeAssignment = require('../models/StudentFeeAssignment');
const ExamPayment = require('../models/ExamPayment');

const getExactSessionFilter = (sessionId) => (sessionId ? { sessionId } : {});

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
          const query = {
            _id: bill.sourceId,
            studentId: bill.studentId,
            schoolId: bill.schoolId,
            ...(month && year ? { month, year } : {}),
            ...getExactSessionFilter(sessionId || bill.sessionId),
          };

          await TransportFee.findOneAndUpdate(
            query,
            { status: 'PAID', paymentDate: new Date() },
            { new: true, session: mongoSession }
          );

          if (!(month && year)) {
            console.warn(`[FeeSync] Transport sync executed without month/year for bill ${bill._id}`);
          }
        }
        break;
      }

      case 'StudentHostel': {
        if (bill.status === 'PAID') {
          await StudentHostel.findOneAndUpdate(
            {
              _id: bill.sourceId,
              studentId: bill.studentId,
              schoolId: bill.schoolId,
            },
            { feeStatus: 'PAID', lastPaymentDate: new Date() },
            { new: true, session: mongoSession }
          );
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
