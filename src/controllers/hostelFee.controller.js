const mongoose = require('mongoose');
const StudentHostel = require('../models/StudentHostel');
const Bill = require('../models/Bill');
const Payment = require('../models/Payment');
const AcademicSession = require('../models/AcademicSession');

const payHostelFee = async (req, res) => {
  try {
    const { studentId, hostelId, roomId, amount, paymentMethod, months } = req.body;
    const { schoolId, _id: paidBy } = req.user;

    if (!studentId || !hostelId || amount === undefined || amount === null) {
      return res.status(400).json({ success: false, message: 'studentId, hostelId, and amount are required' });
    }

    const parsedAmount = Number(amount);
    if (Number.isNaN(parsedAmount) || parsedAmount < 0) {
      return res.status(400).json({ success: false, message: 'Amount must be 0 or greater' });
    }

    let studentObjId;
    let hostelObjId;
    let schoolObjId;
    let roomObjId;
    try {
      studentObjId = new mongoose.Types.ObjectId(studentId);
      hostelObjId = new mongoose.Types.ObjectId(hostelId);
      schoolObjId = new mongoose.Types.ObjectId(schoolId);
      roomObjId = roomId ? new mongoose.Types.ObjectId(roomId) : null;
    } catch (_) {
      return res.status(400).json({ success: false, message: 'Invalid ID format' });
    }

    const activeSession = await AcademicSession.findOne({ schoolId: schoolObjId, isActive: true });
    if (!activeSession) {
      return res.status(400).json({ success: false, message: 'No active academic session found' });
    }

    const assignment = await StudentHostel.findOne({
      studentId: studentObjId,
      hostelId: hostelObjId,
      schoolId: schoolObjId,
      status: 'ACTIVE'
    });
    if (!assignment) {
      return res.status(404).json({ success: false, message: 'Active hostel assignment not found for student' });
    }

    const monthsToPayFor =
      Array.isArray(months) && months.length > 0
        ? months
        : [{ month: new Date().getMonth() + 1, year: new Date().getFullYear() }];

    const description = monthsToPayFor.length > 1
      ? `Hostel Fee — ${monthsToPayFor.map((m) => `${m.month}/${m.year}`).join(', ')}`
      : `Hostel Fee — ${monthsToPayFor[0].month}/${monthsToPayFor[0].year}`;

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
      billType: 'HOSTEL',
      sourceType: 'StudentHostel',
      sourceId: roomObjId || assignment._id,
      description,
      totalAmount: parsedAmount,
      paidAmount: parsedAmount,
      dueAmount: 0,
      status: 'PAID',
      createdBy: paidBy
    });

    let receiptNumber;
    attempts = 0;
    do {
      const ts = Date.now();
      const r = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
      receiptNumber = `RCP-${schoolId.toString().slice(-4)}-${ts}-${r}`;
      attempts++;
    } while (attempts < 10 && await Payment.findOne({ receiptNumber }));

    const payment = await Payment.create({
      receiptNumber,
      billId: bill._id,
      studentId: studentObjId,
      schoolId: schoolObjId,
      sessionId: activeSession._id,
      amount: parsedAmount,
      paymentMode: paymentMethod === 'ONLINE' ? 'Online' : paymentMethod === 'CHEQUE' ? 'Cheque' : 'Cash',
      paymentDate: new Date(),
      collectedBy: paidBy
    });

    await StudentHostel.findOneAndUpdate(
      {
        studentId: studentObjId,
        hostelId: hostelObjId,
        schoolId: schoolObjId,
        status: 'ACTIVE'
      },
      { feeStatus: 'PAID', lastPaymentDate: new Date() }
    );

    return res.status(201).json({
      success: true,
      message: 'Hostel fee payment recorded',
      data: { bill, payment }
    });
  } catch (err) {
    console.error('payHostelFee error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

const getHostelFeeHistory = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { studentId } = req.query;

    const filter = { schoolId, billType: 'HOSTEL' };
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
