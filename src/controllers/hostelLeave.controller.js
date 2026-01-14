import HostelLeave from '../models/HostelLeave.js';
import StudentHostel from '../models/StudentHostel.js';
import Student from '../models/Student.js';

export const createLeave = async (req, res) => {
  try {
    const { studentId, fromDate, toDate, reason } = req.body;
    const { schoolId, _id: createdBy } = req.user;

    // Check student has active hostel
    const hostel = await StudentHostel.findOne({ studentId, status: 'ACTIVE', schoolId });
    if (!hostel) {
      return res.status(404).json({ message: 'Student does not have active hostel assignment' });
    }

    const leave = await HostelLeave.create({
      studentId,
      fromDate,
      toDate,
      reason,
      schoolId,
      createdBy,
    });
    res.status(201).json(leave);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const approveLeave = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const { schoolId, _id: approvedBy } = req.user;

    const leave = await HostelLeave.findOneAndUpdate(
      { _id: id, schoolId },
      { status, approvedBy },
      { new: true }
    );
    if (!leave) {
      return res.status(404).json({ message: 'Leave request not found' });
    }
    res.json(leave);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const getLeaves = async (req, res) => {
  try {
    const { id } = req.params;
    const { schoolId } = req.user;

    const leaves = await HostelLeave.find({ studentId: id, schoolId }).sort({ createdAt: -1 });
    res.json(leaves);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const getHostelFees = async (req, res) => {
  try {
    const { id } = req.params;
    const { schoolId } = req.user;

    const hostel = await StudentHostel.findOne({ studentId: id, status: 'ACTIVE', schoolId }).populate('hostelId roomId');
    if (!hostel) {
      return res.status(404).json({ message: 'No active hostel assignment' });
    }
    res.json(hostel);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
