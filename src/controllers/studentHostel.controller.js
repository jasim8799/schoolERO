import StudentHostel from '../models/StudentHostel.js';
import Student from '../models/Student.js';
import Room from '../models/Room.js';

export const assignHostel = async (req, res) => {
  try {
    const { studentId, hostelId, roomId, bedNumber } = req.body;
    const { schoolId } = req.user;

    // Check student
    const student = await Student.findOne({ _id: studentId, schoolId });
    if (!student) {
      return res.status(404).json({ message: 'Student not found' });
    }

    // Check no active hostel
    const existing = await StudentHostel.findOne({ studentId, status: 'ACTIVE', schoolId });
    if (existing) {
      return res.status(409).json({ message: 'Student already has active hostel' });
    }

    // Check room available
    const room = await Room.findOne({ _id: roomId, hostelId, schoolId });
    if (!room || room.availableBeds <= 0) {
      return res.status(409).json({ message: 'No available beds in this room' });
    }

    // Assign
    const hostel = await StudentHostel.create({
      studentId,
      hostelId,
      roomId,
      bedNumber,
      schoolId,
    });

    // Update available beds
    await Room.findByIdAndUpdate(roomId, { $inc: { availableBeds: -1 } });

    res.status(201).json(hostel);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const getStudentHostel = async (req, res) => {
  try {
    const { id } = req.params;
    const { schoolId } = req.user;

    const hostel = await StudentHostel.findOne({ studentId: id, schoolId }).populate('hostelId roomId');
    res.json(hostel);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
