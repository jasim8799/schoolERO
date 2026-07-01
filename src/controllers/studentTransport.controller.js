const StudentTransport = require('../models/StudentTransport.js');
const Student = require('../models/Student.js');
const Route = require('../models/Route.js');
const Bill = require('../models/Bill.js');
const { getFinancialSummary } = require('../services/financialSummary.service');

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

const parseMonthYearFromDescription = (description = '') => {
  const text = String(description || '');
  const slashMatch = text.match(/\b(\d{1,2})\s*\/\s*(\d{4})\b/);
  if (slashMatch) {
    const month = Number(slashMatch[1]);
    const year = Number(slashMatch[2]);
    if (month >= 1 && month <= 12) return { month, year };
  }

  const monthMap = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  };
  const namedMatch = text.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b\s*(\d{4})/i);
  if (namedMatch) {
    return {
      month: monthMap[namedMatch[1].slice(0, 3).toLowerCase()] || null,
      year: Number(namedMatch[2]) || null,
    };
  }

  return { month: null, year: null };
};

const assignTransport = async (req, res) => {
  try {
    const { studentId, routeId } = req.body;
    const { schoolId } = req.user;

    // Check student exists and same school
    const student = await Student.findOne({ _id: studentId, schoolId });
    if (!student) {
      return res.status(404).json({ message: 'Student not found' });
    }

    // Check no active transport
    const existing = await StudentTransport.findOne({ studentId, status: 'ACTIVE', schoolId });
    if (existing) {
      return res.status(409).json({ message: 'Student already has active transport' });
    }

    // Get route and vehicle
    const route = await Route.findById(routeId).populate('vehicleId');
    if (!route) {
      return res.status(404).json({ message: 'Route not found' });
    }

    const transport = await StudentTransport.create({
      studentId,
      routeId,
      vehicleId: route.vehicleId._id,
      schoolId,
    });

    res.status(201).json(transport);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getStudentTransport = async (req, res) => {
  try {
    const { id } = req.params;
    const { schoolId, sessionId } = req.user;

    let transport = await StudentTransport.findOne({ studentId: id, schoolId, status: 'ACTIVE' })
      .populate('routeId', 'name stops monthlyFee')
      .populate('vehicleId', 'vehicleNumber driverName driverContact capacity')
      .lean();

    if (!transport) {
      const student = await Student.findOne({ userId: id, schoolId }).select('_id').lean();
      if (student?._id) {
        transport = await StudentTransport.findOne({ studentId: student._id, schoolId, status: 'ACTIVE' })
          .populate('routeId', 'name stops monthlyFee')
          .populate('vehicleId', 'vehicleNumber driverName driverContact capacity')
          .lean();
      }
    }

    if (!transport) {
      return res.json({ success: true, data: null });
    }

    const studentIdToUse = transport.studentId?._id || transport.studentId;
    const fees = await Bill.find({
      studentId: studentIdToUse,
      schoolId,
      billType: 'TRANSPORT',
      sourceType: { $ne: 'Admission' },
      ..._sessionFilter(sessionId),
    })
      .sort({ createdAt: -1 })
      .lean();

    const totalPaid = fees
      .reduce((sum, f) => sum + Number(f.paidAmount || 0), 0);
    const totalPending = fees
      .reduce((sum, f) => sum + Number(f.dueAmount || 0), 0);
    const totalAmount = totalPaid + totalPending;

    const feeHistory = fees.map((bill) => {
      const { month, year } = parseMonthYearFromDescription(bill.description);
      return {
        _id: bill._id,
        billId: bill._id,
        billNumber: bill.billNumber,
        description: bill.description,
        month,
        year,
        amount: Number(bill.totalAmount || 0),
        paidAmount: Number(bill.paidAmount || 0),
        dueAmount: Number(bill.dueAmount || 0),
        status: bill.status,
        createdAt: bill.createdAt,
        updatedAt: bill.updatedAt,
      };
    });

    const enriched = {
      ...transport,
      feeHistory,
      feeSummary: {
        total: totalAmount,
        paid: totalPaid,
        pending: totalPending,
      },
    };

    res.json({ success: true, data: enriched });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getAllAssignments = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const assignments = await StudentTransport.find({
      schoolId,
      status: 'ACTIVE'
    })
      .populate({
        path: 'studentId',
        select: 'name rollNumber classId',
        populate: { path: 'classId', select: 'name' }
      })
      .populate('routeId', 'name stops monthlyFee')
      .populate('vehicleId', 'vehicleNumber driverName driverContact')
      .sort({ createdAt: -1 })
      .lean();

    res.json({ success: true, data: assignments });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getTransportPaymentSummary = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const financialSummary = await getFinancialSummary({
      schoolId,
      sessionId: req.user?.sessionId,
    });

    return res.json({
      success: true,
      data: {
        pendingAmount: financialSummary.transportDueAmount || 0,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

const removeStudentTransport = async (req, res) => {
  try {
    const { id } = req.params;
    const { schoolId } = req.user;

    const assignment = await StudentTransport.findOne({ _id: id, schoolId });
    if (!assignment) {
      return res.status(404).json({ success: false, message: 'Assignment not found' });
    }

    assignment.status = 'INACTIVE';
    await assignment.save();

    res.json({ success: true, message: 'Student removed from transport' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const reassignStudentTransport = async (req, res) => {
  try {
    const { id } = req.params;
    const { routeId } = req.body;
    const { schoolId } = req.user;

    if (!routeId) {
      return res.status(400).json({ success: false, message: 'routeId is required' });
    }

    const assignment = await StudentTransport.findOne({
      _id: id,
      schoolId,
      status: 'ACTIVE'
    });
    if (!assignment) {
      return res.status(404).json({ success: false, message: 'Active assignment not found' });
    }

    const route = await Route.findById(routeId).populate('vehicleId');
    if (!route) {
      return res.status(404).json({ success: false, message: 'Route not found' });
    }

    assignment.routeId = routeId;
    assignment.vehicleId = route.vehicleId._id;
    await assignment.save();

    const updated = await StudentTransport.findById(id)
      .populate({
        path: 'studentId',
        select: 'name rollNumber'
      })
      .populate('routeId', 'name stops monthlyFee')
      .populate('vehicleId', 'vehicleNumber driverName')
      .lean();

    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  assignTransport,
  getStudentTransport,
  getAllAssignments,
  removeStudentTransport,
  reassignStudentTransport,
  getTransportPaymentSummary,
};
