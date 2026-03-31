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

    res.json({ message: 'Payment recorded successfully', data: fee });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = { getAllFees, payFee };
