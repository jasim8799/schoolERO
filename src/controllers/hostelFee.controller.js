const mongoose = require('mongoose');
const Bill = require('../models/Bill');
const {
  processHostelMonthsPayment,
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

const payHostelFee = async (req, res) => {
  try {
    const { studentId, hostelId, roomId, months, paymentMethod } = req.body;
    // months = [{ month: N, year: YYYY, amount: N }, ...]
    const { schoolId, _id: paidBy } = req.user;

    if (!studentId || !hostelId || !Array.isArray(months) || months.length === 0) {
      return res.status(400).json({ success: false, message: 'studentId, hostelId, and months[] are required' });
    }

    const studentObjId = new mongoose.Types.ObjectId(studentId);
    const hostelObjId = new mongoose.Types.ObjectId(hostelId);
    const schoolObjId = new mongoose.Types.ObjectId(schoolId);

    const result = await processHostelMonthsPayment({
      schoolId: schoolObjId,
      actorId: paidBy,
      reqSessionId: req.user?.sessionId,
      studentId: studentObjId,
      hostelId: hostelObjId,
      months,
      paymentMethod,
    });

    const receiptsByMonth = new Map();
    for (const r of result.receipts) {
      const match = String(r.description || '').match(/Hostel Fee\s+—\s+([A-Za-z]{3})\s+(\d{4})/i);
      if (match) {
        const monthLabel = match[1].toLowerCase();
        const monthMap = {
          jan: 1,
          feb: 2,
          mar: 3,
          apr: 4,
          may: 5,
          jun: 6,
          jul: 7,
          aug: 8,
          sep: 9,
          oct: 10,
          nov: 11,
          dec: 12,
        };
        const key = `${monthMap[monthLabel]}-${Number(match[2])}`;
        receiptsByMonth.set(key, r);
      }
    }

    const results = months
      .map((m) => {
        const month = Number(m.month);
        const year = Number(m.year);
        const key = `${month}-${year}`;
        const receipt = receiptsByMonth.get(key);
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
    console.error('payHostelFee error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

const getHostelFeeHistory = async (req, res) => {
  try {
    const { schoolId, sessionId } = req.user;
    const { studentId } = req.query;

    const filter = { schoolId, billType: 'HOSTEL', ..._sessionFilter(sessionId) };
    if (studentId) filter.studentId = studentId;

    const bills = await Bill.find(filter)
      .populate('studentId', 'name rollNumber')
      .sort({ createdAt: -1 })
      .lean();

    return res.json({ success: true, data: bills });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  payHostelFee,
  getHostelFeeHistory,
};
