const mongoose = require('mongoose');
const TransportFee = require('../models/TransportFee.js');
const Bill = require('../models/Bill.js');
const Payment = require('../models/Payment.js');
const AcademicSession = require('../models/AcademicSession.js');

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

    const activeSession = await AcademicSession.findOne({ schoolId: schoolObjId, isActive: true });
    if (!activeSession) {
      return res.status(400).json({ success: false, message: 'No active academic session found' });
    }

    const results = [];

    for (const m of months) {
      const month = Number(m.month);
      const year = Number(m.year);
      const amount = Number(m.amount || 0);

      if (!month || !year || month < 1 || month > 12) {
        continue;
      }

      let feeRecord = await TransportFee.findOne({
        studentId: studentObjId,
        routeId: routeObjId,
        schoolId: schoolObjId,
        month,
        year,
        ..._sessionFilter(sessionId),
      });

      if (!feeRecord) {
        try {
          feeRecord = await TransportFee.create({
            studentId: studentObjId,
            routeId: routeObjId,
            vehicleId: vehicleObjId,
            schoolId: schoolObjId,
            sessionId: activeSession._id,
            amount,
            month,
            year,
            status: 'PENDING',
          });
        } catch (createErr) {
          if (createErr?.code === 11000) {
            feeRecord = await TransportFee.findOne({
              studentId: studentObjId,
              routeId: routeObjId,
              schoolId: schoolObjId,
              month,
              year,
              ..._sessionFilter(sessionId),
            });
          } else {
            throw createErr;
          }
        }
      }

      if (!feeRecord) {
        throw new Error(`Unable to create or load transport fee record for ${month}/${year}`);
      }

      if (feeRecord.status === 'PAID') {
        const existingPaidBill = await Bill.findOne({
          studentId: studentObjId,
          schoolId: schoolObjId,
          billType: 'TRANSPORT',
          sourceType: 'StudentTransport',
          sourceId: feeRecord._id,
          status: 'PAID',
        }).lean();

        if (existingPaidBill) {
          console.log(`Transport fee already paid for student ${studentId} month ${month}/${year}`);
          results.push({
            month,
            year,
            billNumber: existingPaidBill.billNumber,
            receiptNumber: 'ALREADY_PAID',
            amount: feeRecord.amount,
          });
          continue;
        }
      }

      const existingBill = await Bill.findOne({
        studentId: studentObjId,
        schoolId: schoolObjId,
        billType: 'TRANSPORT',
        sourceType: 'StudentTransport',
        sourceId: feeRecord._id,
      }).lean();

      if (existingBill && existingBill.status === 'PAID') {
        console.log(`Skipping duplicate transport bill for feeRecord ${feeRecord._id}`);
        results.push({
          month,
          year,
          billNumber: existingBill.billNumber,
          receiptNumber: 'ALREADY_PAID',
          amount: existingBill.totalAmount,
          description: existingBill.description,
        });
        continue;
      }

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
        studentId: studentObjId,
        schoolId: schoolObjId,
        sessionId: activeSession._id,
        billType: 'TRANSPORT',
        sourceType: 'StudentTransport',
        sourceId: feeRecord._id,
        description: `Transport Fee — ${month}/${year}`,
        totalAmount: amount,
        paidAmount: amount,
        dueAmount: 0,
        status: 'PAID',
        createdBy: paidBy,
      });

      let receiptNumber;
      let rAttempts = 0;
      do {
        const ts = Date.now();
        const r = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
        receiptNumber = `RCP-${schoolId.toString().slice(-4)}-${ts}-${r}`;
        rAttempts++;
      } while (rAttempts < 10 && await Payment.findOne({ receiptNumber }));

      await Payment.create({
        receiptNumber,
        billId: bill._id,
        studentId: studentObjId,
        schoolId: schoolObjId,
        sessionId: activeSession._id,
        amount,
        paymentMode: paymentMethod === 'ONLINE' ? 'Online' : paymentMethod === 'CHEQUE' ? 'Cheque' : 'Cash',
        paymentDate: new Date(),
        collectedBy: paidBy,
      });

      await TransportFee.findByIdAndUpdate(feeRecord._id, {
        status: 'PAID',
        paymentDate: new Date(),
        paymentMethod: paymentMethod || 'CASH',
        paidBy,
      });

      results.push({ month, year, billNumber, receiptNumber, amount });
    }

    return res.status(201).json({
      success: true,
      message: `${results.length} month(s) payment recorded`,
      data: results,
    });
  } catch (err) {
    console.error('payFee error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getAllFees, payFee };
