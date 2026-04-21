const TransportFee = require('../models/TransportFee');
const StudentHostel = require('../models/StudentHostel');
const StudentFee = require('../models/StudentFee');

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
          await TransportFee.findByIdAndUpdate(bill.sourceId, {
            status: 'PAID',
            paymentDate: new Date(),
          });
        }
        break;
      }

      case 'StudentHostel': {
        if (bill.status === 'PAID') {
          await StudentHostel.findByIdAndUpdate(bill.sourceId, {
            feeStatus: 'PAID',
            lastPaymentDate: new Date(),
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
