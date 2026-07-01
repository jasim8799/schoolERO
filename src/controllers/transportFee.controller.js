const mongoose = require('mongoose');
const TransportFee = require('../models/TransportFee.js');
const StudentTransport = require('../models/StudentTransport.js');
const Bill = require('../models/Bill.js');
const {
  processTransportMonthsPayment,
  PaymentEngineError,
} = require('../services/paymentEngine.service');

const _sessionFilter = (sessionId) =>
  sessionId
    ? {
        $or: [
          { sessionId },
          { sessionId: null },
          { sessionId: { $exists: false } },
        ],
      }
    : {};

const getAllFees = async (req, res) => {
  try {
    const { schoolId, sessionId } = req.user;
    const { studentId } = req.query;

    const filter = { schoolId, ..._sessionFilter(sessionId) };
    if (studentId) {
      filter.studentId = new mongoose.Types.ObjectId(studentId);
    }

    const fees = await TransportFee.find(filter)
      .populate({ path: 'studentId', select: 'name rollNumber', populate: { path: 'userId', select: 'name' } })
      .populate('routeId', 'name monthlyFee stops')
      .populate('vehicleId', 'vehicleNumber driverName')
      .sort({ createdAt: -1 })
      .lean();

    const enriched = await Promise.all(fees.map(async (fee) => {
      const bill = await Bill.findOne({
        sourceType: 'StudentTransport',
        sourceId: fee._id,
      }).select('status totalAmount paidAmount dueAmount billNumber').lean();

      return { ...fee, bill };
    }));

    res.json({ success: true, data: enriched });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const payFee = async (req, res) => {
  try {
    const { studentId, routeId, vehicleId, months, paymentMethod } = req.body;
    const { schoolId, _id: paidBy, sessionId } = req.user;

    if (!studentId || !routeId || !Array.isArray(months) || months.length === 0) {
      return res.status(400).json({ success: false, message: 'studentId, routeId, and months[] are required' });
    }

    const studentObjId = new mongoose.Types.ObjectId(studentId);
    const routeObjId = new mongoose.Types.ObjectId(routeId);
    const schoolObjId = new mongoose.Types.ObjectId(schoolId);
    const vehicleObjId = vehicleId ? new mongoose.Types.ObjectId(vehicleId) : null;

    const result = await processTransportMonthsPayment({
      schoolId: schoolObjId,
      actorId: paidBy,
      reqSessionId: sessionId,
      studentId: studentObjId,
      routeId: routeObjId,
      vehicleId: vehicleObjId,
      months,
      paymentMethod,
    });

    const results = months
      .map((m) => {
        const month = Number(m.month);
        const year = Number(m.year);
        const receipt = result.receipts.find((r) =>
          String(r.description || '').includes(`Transport Fee — ${month}/${year}`)
        );
        if (!receipt) return null;
        return {
          month,
          year,
          billNumber: receipt.billNumber,
          receiptNumber: receipt.receiptNumber,
          amount: receipt.amount,
          description: receipt.description,
        };
      })
      .filter(Boolean);

    return res.status(201).json({
      success: true,
      message: `${results.length} month(s) payment recorded`,
      data: results,
    });
  } catch (err) {
    if (err instanceof PaymentEngineError) {
      return res.status(err.statusCode || 400).json({ success: false, message: err.message });
    }
    console.error('payFee error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getAllFees, payFee };
