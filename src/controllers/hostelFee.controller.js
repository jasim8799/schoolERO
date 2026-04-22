const mongoose = require('mongoose');
const StudentHostel = require('../models/StudentHostel');
const Bill = require('../models/Bill');
const Payment = require('../models/Payment');
const AcademicSession = require('../models/AcademicSession');

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
    const hostelObjId  = new mongoose.Types.ObjectId(hostelId);
    const schoolObjId  = new mongoose.Types.ObjectId(schoolId);

    const activeSession = await AcademicSession.findOne({ schoolId: schoolObjId, isActive: true });
    if (!activeSession) {
      return res.status(400).json({ success: false, message: 'No active academic session found' });
    }

    const assignment = await StudentHostel.findOne({
      studentId: studentObjId, hostelId: hostelObjId, schoolId: schoolObjId, status: 'ACTIVE'
    });
    if (!assignment) {
      return res.status(404).json({ success: false, message: 'Active hostel assignment not found' });
    }

    const generateBillNumber = (sid) => {
      const ts = Date.now();
      const r  = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
      return `BILL-${sid.toString().slice(-4)}-${ts}-${r}`;
    };

    const monthNames = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const results = [];

    for (const m of months) {
      const month  = Number(m.month);
      const year   = Number(m.year);
      const amount = Number(m.amount || 0);
      if (!month || !year || month < 1 || month > 12) continue;

      const description = `Hostel Fee — ${monthNames[month]} ${year}`;

      // Pay pre-created assignment bill instead of creating a duplicate paid bill.
      const unpaidAssignmentBill = await Bill.findOne({
        studentId: studentObjId,
        schoolId: schoolObjId,
        billType: 'HOSTEL',
        sourceType: 'StudentHostel',
        sourceId: assignment._id,
        status: 'UNPAID',
      });

      if (unpaidAssignmentBill) {
        unpaidAssignmentBill.paidAmount = amount;
        await unpaidAssignmentBill.save();

        let receiptNumber, rAttempts = 0;
        do {
          const ts = Date.now();
          const r  = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
          receiptNumber = `RCP-${schoolId.toString().slice(-4)}-${ts}-${r}`;
          rAttempts++;
        } while (rAttempts < 10 && await Payment.findOne({ receiptNumber }));

        await Payment.create({
          receiptNumber,
          billId: unpaidAssignmentBill._id,
          studentId: studentObjId,
          schoolId: schoolObjId,
          sessionId: activeSession._id,
          amount,
          paymentMode: paymentMethod === 'ONLINE' ? 'Online' : paymentMethod === 'CHEQUE' ? 'Cheque' : 'Cash',
          paymentDate: new Date(),
          collectedBy: paidBy,
        });

        results.push({
          month,
          year,
          billNumber: unpaidAssignmentBill.billNumber,
          receiptNumber,
          amount,
          description: unpaidAssignmentBill.description,
        });
        continue;
      }

      const existingPaidBill = await Bill.findOne({
        studentId: studentObjId,
        schoolId: schoolObjId,
        billType: 'HOSTEL',
        sourceType: 'StudentHostel',
        sourceId: assignment._id,
        description,
        status: 'PAID',
      }).lean();

      if (existingPaidBill) {
        console.log(`Skipping duplicate hostel bill: ${description} for student ${studentId}`);
        results.push({
          month,
          year,
          billNumber: existingPaidBill.billNumber,
          receiptNumber: 'ALREADY_PAID',
          amount: existingPaidBill.totalAmount,
          description: existingPaidBill.description,
        });
        continue;
      }

      let billNumber, attempts = 0;
      do {
        billNumber = generateBillNumber(schoolId);
        attempts++;
      } while (attempts < 10 && await Bill.findOne({ billNumber }));

      const bill = await Bill.create({
        billNumber,
        studentId:   studentObjId,
        schoolId:    schoolObjId,
        sessionId:   activeSession._id,
        billType:    'HOSTEL',
        sourceType:  'StudentHostel',
        sourceId:    assignment._id,
        description,
        totalAmount: amount,
        paidAmount:  amount,
        dueAmount:   0,
        status:      'PAID',
        createdBy:   paidBy,
      });

      let receiptNumber, rAttempts = 0;
      do {
        const ts = Date.now();
        const r  = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
        receiptNumber = `RCP-${schoolId.toString().slice(-4)}-${ts}-${r}`;
        rAttempts++;
      } while (rAttempts < 10 && await Payment.findOne({ receiptNumber }));

      await Payment.create({
        receiptNumber,
        billId:      bill._id,
        studentId:   studentObjId,
        schoolId:    schoolObjId,
        sessionId:   activeSession._id,
        amount,
        paymentMode: paymentMethod === 'ONLINE' ? 'Online' : paymentMethod === 'CHEQUE' ? 'Cheque' : 'Cash',
        paymentDate: new Date(),
        collectedBy: paidBy,
      });

      results.push({ month, year, billNumber, receiptNumber, amount, description });
    }

    await StudentHostel.findOneAndUpdate(
      { studentId: studentObjId, hostelId: hostelObjId, schoolId: schoolObjId, status: 'ACTIVE' },
      { feeStatus: 'PAID', lastPaymentDate: new Date() }
    );

    return res.status(201).json({
      success: true,
      message: `${results.length} month(s) payment recorded`,
      data: results,
    });
  } catch (err) {
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
