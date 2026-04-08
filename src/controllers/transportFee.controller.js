const TransportFee = require('../models/TransportFee.js');

const getAllFees = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const fees = await TransportFee.find({ schoolId })
      .populate({ path: 'studentId', select: 'name rollNumber', populate: { path: 'userId', select: 'name' } })
      .populate('routeId', 'name monthlyFee stops')
      .populate('vehicleId', 'vehicleNumber driverName')
      .sort({ createdAt: -1 });

    res.json({ data: fees });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const payFee = async (req, res) => {
  try {
    const { feeId, paymentMethod } = req.body;
    const { schoolId, _id: paidBy } = req.user;

    if (!feeId || !paymentMethod) {
      return res.status(400).json({ message: 'feeId and paymentMethod are required' });
    }

    const fee = await TransportFee.findOneAndUpdate(
      { _id: feeId, schoolId, status: 'PENDING' },
      {
        status: 'PAID',
        paymentDate: new Date(),
        paymentMethod,
        paidBy,
      },
      { new: true }
    );

    if (!fee) {
      return res.status(404).json({ message: 'Fee record not found or already paid' });
    }

    try {
      const Bill = require('../models/Bill');
      const Payment = require('../models/Payment');
      const AcademicSession = require('../models/AcademicSession');

      const activeSession = await AcademicSession.findOne({ schoolId, isActive: true });

      const generateBillNumber = (sid) => {
        const ts = Date.now();
        const r = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
        return `BILL-${sid.toString().slice(-4)}-${ts}-${r}`;
      };

      let billNumber;
      let attempts = 0;
      do {
        billNumber = generateBillNumber(schoolId);
        attempts++;
      } while (attempts < 10 && await Bill.findOne({ billNumber }));

      const bill = await Bill.create({
        billNumber,
        studentId: fee.studentId,
        schoolId,
        sessionId: activeSession?._id,
        billType: 'TRANSPORT',
        sourceType: 'StudentTransport',
        sourceId: fee._id,
        description: `Transport Fee — Month ${fee.month}/${fee.year}`,
        totalAmount: fee.amount,
        paidAmount: fee.amount,
        dueAmount: 0,
        status: 'PAID',
        createdBy: paidBy
      });

      const generateReceiptNumber = (sid) => {
        const ts = Date.now();
        const r = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
        return `RCP-${sid.toString().slice(-4)}-${ts}-${r}`;
      };

      let receiptNumber;
      attempts = 0;
      do {
        receiptNumber = generateReceiptNumber(schoolId);
        attempts++;
      } while (attempts < 10 && await Payment.findOne({ receiptNumber }));

      await Payment.create({
        receiptNumber,
        billId: bill._id,
        studentId: fee.studentId,
        schoolId,
        sessionId: activeSession?._id,
        amount: fee.amount,
        paymentMode: paymentMethod === 'ONLINE' ? 'Online' : paymentMethod === 'CHEQUE' ? 'Cheque' : 'Cash',
        paymentDate: new Date(),
        collectedBy: paidBy
      });
    } catch (billErr) {
      console.error('Transport fee bill dual-write failed:', billErr.message);
    }

    res.json({ message: 'Payment recorded successfully', data: fee });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = { getAllFees, payFee };
