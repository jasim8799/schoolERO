const StudentHostel = require('../models/StudentHostel');
const Bill = require('../models/Bill');
const Payment = require('../models/Payment');
const AcademicSession = require('../models/AcademicSession');

const payHostelFee = async (req, res) => {
  try {
    const { studentId, hostelId, roomId, amount, paymentMethod } = req.body;
    const { schoolId, _id: paidBy } = req.user;

    if (!studentId || !hostelId || !amount) {
      return res.status(400).json({ success: false, message: 'studentId, hostelId, and amount are required' });
    }

    const activeSession = await AcademicSession.findOne({ schoolId, isActive: true });
    if (!activeSession) {
      return res.status(400).json({ success: false, message: 'No active academic session found' });
    }

    const assignment = await StudentHostel.findOne({ studentId, hostelId, schoolId, status: 'ACTIVE' });
    if (!assignment) {
      return res.status(404).json({ success: false, message: 'Active hostel assignment not found for student' });
    }

    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();

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
      studentId,
      schoolId,
      sessionId: activeSession._id,
      billType: 'HOSTEL',
      sourceType: 'StudentHostel',
      sourceId: roomId || assignment._id,
      description: `Hostel Fee — ${month}/${year}`,
      totalAmount: amount,
      paidAmount: amount,
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
      studentId,
      schoolId,
      sessionId: activeSession._id,
      amount,
      paymentMode: paymentMethod === 'ONLINE' ? 'Online' : paymentMethod === 'CHEQUE' ? 'Cheque' : 'Cash',
      paymentDate: new Date(),
      collectedBy: paidBy
    });

    return res.status(201).json({
      success: true,
      message: 'Hostel fee payment recorded',
      data: { bill, payment }
    });
  } catch (err) {
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
