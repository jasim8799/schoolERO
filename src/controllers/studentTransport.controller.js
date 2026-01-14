import StudentTransport from '../models/StudentTransport.js';
import Student from '../models/Student.js';
import Route from '../models/Route.js';

export const assignTransport = async (req, res) => {
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

export const getStudentTransport = async (req, res) => {
  try {
    const { id } = req.params;
    const { schoolId } = req.user;

    const transport = await StudentTransport.findOne({ studentId: id, schoolId }).populate('routeId vehicleId');
    res.json(transport);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
