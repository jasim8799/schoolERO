const StudentTransport = require('../models/StudentTransport.js');
const Student = require('../models/Student.js');
const Route = require('../models/Route.js');

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

    // ── Billing dual-write ──────────────────────────────────────────────
    try {
      const Bill = require('../models/Bill');
      const AcademicSession = require('../models/AcademicSession');

      const activeSession = await AcademicSession.findOne({
        schoolId, isActive: true
      });

      if (activeSession) {
        const generateBillNumber = (sid) => {
          const ts = Date.now();
          const r = Math.floor(Math.random() * 1000)
            .toString().padStart(3, '0');
          return `BILL-${sid.toString().slice(-4)}-${ts}-${r}`;
        };

        let billNumber;
        let attempts = 0;
        do {
          billNumber = generateBillNumber(schoolId);
          attempts++;
        } while (attempts < 10 && await Bill.findOne({ billNumber }));

        const description = route?.name
          ? `Transport Fee — Route: ${route.name}`
          : 'Transport Fee';

        const monthlyFee = route?.monthlyFee || 0;

        await Bill.create({
          billNumber,
          studentId,
          schoolId,
          sessionId: activeSession._id,
          billType: 'TRANSPORT',
          sourceType: 'StudentTransport',
          sourceId: transport._id,
          description,
          totalAmount: monthlyFee,
          paidAmount: 0,
          dueAmount: monthlyFee,
          status: 'UNPAID',
          createdBy: req.user._id
        });
      }
    } catch (billErr) {
      console.error('Transport bill dual-write failed:', billErr.message);
    }
    // ── End billing dual-write ──────────────────────────────────────

    res.status(201).json(transport);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getStudentTransport = async (req, res) => {
  try {
    const { id } = req.params;
    const { schoolId } = req.user;

    const transport = await StudentTransport.findOne({ studentId: id, schoolId }).populate('routeId vehicleId');
    res.json(transport);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = {
  assignTransport,
  getStudentTransport,
};
