const HostelLeave = require('../models/HostelLeave.js');
const StudentHostel = require('../models/StudentHostel.js');
const Student = require('../models/Student.js');

const createLeave = async (req, res) => {
  try {
    const { fromDate, toDate, reason } = req.body;
    const { schoolId, _id: createdBy, role } = req.user;
    const userId = req.user._id;
    let studentId = req.body.studentId;

    // Auto-resolve studentId from authenticated student user
    if (role === 'STUDENT' && !studentId) {
      const studentDoc = await Student.findOne({ userId, schoolId });
      if (!studentDoc) {
        return res.status(404).json({ message: 'Student profile not found' });
      }
      studentId = studentDoc._id;
    }

    // Validate student exists in same school
    const student = await Student.findOne({ _id: studentId, schoolId });
    if (!student) {
      return res.status(404).json({ message: 'Student not found in your school' });
    }

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

const approveLeave = async (req, res) => {
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

const getLeaves = async (req, res) => {
  try {
    const { id } = req.params;
    const { schoolId } = req.user;

    const leaves = await HostelLeave.find({ studentId: id, schoolId }).sort({ createdAt: -1 });
    res.json({ success: true, data: leaves });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getAllLeaves = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { status } = req.query;
    const filter = { schoolId };
    if (status) filter.status = status;

    const leaves = await HostelLeave.find(filter)
      .populate('studentId', 'name rollNumber')
      .populate('approvedBy', 'name')
      .sort({ createdAt: -1 });

    res.json({ success: true, data: leaves });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getHostelFees = async (req, res) => {
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

module.exports = { createLeave, approveLeave, getLeaves, getHostelFees, getAllLeaves };
