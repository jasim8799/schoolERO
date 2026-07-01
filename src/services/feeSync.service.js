const TransportFee = require('../models/TransportFee');
const StudentHostel = require('../models/StudentHostel');
const StudentFee = require('../models/StudentFee');
const StudentFeeAssignment = require('../models/StudentFeeAssignment');
const ExamPayment = require('../models/ExamPayment');

/**
 * After any Bill payment, sync the status back to the source model.
 * Call this after bill.paidAmount is updated and bill.save() is called.
 */
const syncBillPaymentToSource = async (bill) => {
  if (!bill?.sourceId || !bill?.sourceType) return;

  try {
    switch (bill.sourceType) {
      case 'StudentTransport': {
        if (bill.status === 'PAID') {
          let synced = await TransportFee.findByIdAndUpdate(
            bill.sourceId,
            {
              status: 'PAID',
              paymentDate: new Date(),
            },
            { new: true }
          );

          // Some transport bills point sourceId to StudentTransport assignment.
          // In that case, sync the latest pending monthly TransportFee row.
          if (!synced) {
            synced = await TransportFee.findOneAndUpdate(
              {
                studentId: bill.studentId,
                schoolId: bill.schoolId,
                status: 'PENDING',
              },
              {
                status: 'PAID',
                paymentDate: new Date(),
              },
              {
                sort: { createdAt: -1 },
                new: true,
              }
            );
          }
        }
        break;
      }

      case 'StudentHostel': {
        if (bill.status === 'PAID') {
          let synced = await StudentHostel.findByIdAndUpdate(
            bill.sourceId,
            {
              feeStatus: 'PAID',
              lastPaymentDate: new Date(),
            },
            { new: true }
          );

          // Backward compatibility for bills missing direct source linkage.
          if (!synced) {
            synced = await StudentHostel.findOneAndUpdate(
              {
                studentId: bill.studentId,
                schoolId: bill.schoolId,
                status: 'ACTIVE',
              },
              {
                feeStatus: 'PAID',
                lastPaymentDate: new Date(),
              },
              { new: true }
            );
          }
        }
        break;
      }

      case 'ExamPayment': {
        if (bill.status === 'PAID') {
          await ExamPayment.findByIdAndUpdate(bill.sourceId, {
            status: 'Paid',
          });
        }
        break;
      }

      case 'StudentFee': {
        const studentFee = await StudentFee.findById(bill.sourceId);
        if (studentFee) {
          studentFee.paidAmount = bill.paidAmount;
          studentFee.dueAmount = bill.dueAmount;
          if (bill.status === 'PAID') studentFee.status = 'Paid';
          else if (bill.paidAmount > 0) studentFee.status = 'Partial';
          else studentFee.status = 'Due';
          await studentFee.save();
        }
        break;
      }

      case 'StudentFeeAssignment': {
        const assignment = await StudentFeeAssignment.findById(bill.sourceId);
        if (assignment) {
          assignment.paidAmount = bill.paidAmount;
          assignment.dueAmount = bill.dueAmount;
          if (bill.status === 'PAID') assignment.status = 'PAID';
          else if (bill.paidAmount > 0) assignment.status = 'PARTIAL';
          else assignment.status = 'PENDING';
          await assignment.save();
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

/**
 * When collecting fees by billType without a sourceId,
 * find the most recent pending source record and mark it paid.
 */
const syncByStudentAndType = async ({ studentId, schoolId, billType }) => {
  try {
    if (billType === 'TRANSPORT') {
      await TransportFee.findOneAndUpdate(
        { studentId, schoolId, status: 'PENDING' },
        { status: 'PAID', paymentDate: new Date() },
        { sort: { createdAt: -1 } }
      );
    } else if (billType === 'HOSTEL') {
      await StudentHostel.findOneAndUpdate(
        { studentId, schoolId, status: 'ACTIVE' },
        { feeStatus: 'PAID', lastPaymentDate: new Date() }
      );
    }
  } catch (err) {
    console.error('[FeeSync] syncByStudentAndType failed:', err.message);
  }
};

module.exports = { syncBillPaymentToSource, syncByStudentAndType };
