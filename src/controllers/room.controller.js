const Room = require('../models/Room.js');
const Hostel = require('../models/Hostel.js');

const createRoom = async (req, res) => {
  try {
    const { hostelId, roomNumber, totalBeds, wardenName, wardenPhone, wardenEmail } = req.body;
    const { schoolId, _id: createdBy } = req.user;

    // Validate hostel belongs to same school
    const hostel = await Hostel.findOne({ _id: hostelId, schoolId });
    if (!hostel) {
      return res.status(404).json({ message: 'Hostel not found or does not belong to your school.' });
    }

    const room = await Room.create({
      hostelId,
      roomNumber,
      totalBeds,
      availableBeds: totalBeds,
      wardenName: wardenName || '',
      wardenPhone: wardenPhone || '',
      wardenEmail: wardenEmail || '',
      schoolId,
      createdBy,
    });
    res.status(201).json(room);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: 'Room number already exists in this hostel.' });
    }
    res.status(500).json({ message: err.message });
  }
};

const getRooms = async (req, res) => {
  try {
    const { hostelId } = req.query;
    const { schoolId } = req.user;

    const filter = { schoolId };
    if (hostelId) filter.hostelId = hostelId;

    const rooms = await Room.find(filter).populate('hostelId', 'name');
    res.json(rooms);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const updateRoom = async (req, res) => {
  try {
    const { id } = req.params;
    const { schoolId } = req.user;
    const { roomNumber, totalBeds, availableBeds, wardenName, wardenPhone, wardenEmail } = req.body;

    const payload = {
      ...(roomNumber !== undefined && { roomNumber }),
      ...(totalBeds !== undefined && { totalBeds }),
      ...(availableBeds !== undefined && { availableBeds }),
      ...(wardenName !== undefined && { wardenName }),
      ...(wardenPhone !== undefined && { wardenPhone }),
      ...(wardenEmail !== undefined && { wardenEmail }),
    };

    const room = await Room.findOneAndUpdate(
      { _id: id, schoolId },
      payload,
      { new: true, runValidators: true }
    );

    if (!room) {
      return res.status(404).json({ message: 'Room not found' });
    }

    res.json({ success: true, data: room });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const deleteRoom = async (req, res) => {
  try {
    const { id } = req.params;
    const { schoolId } = req.user;

    // Check for active student assignments in this room
    const StudentHostel = require('../models/StudentHostel');
    const activeCount = await StudentHostel.countDocuments({
      roomId: id, schoolId, status: 'ACTIVE'
    });
    if (activeCount > 0) {
      return res.status(409).json({
        success: false,
        message: `Cannot delete room — ${activeCount} student(s) assigned. Remove them first.`
      });
    }

    const room = await Room.findOneAndDelete({ _id: id, schoolId });
    if (!room) {
      return res.status(404).json({ success: false, message: 'Room not found' });
    }

    // Restore available beds count on hostel (optional: hostel capacity tracking)
    return res.json({ success: true, message: 'Room deleted successfully' });
  } catch (err) {
    if (err.name === 'CastError') {
      return res.status(400).json({ success: false, message: 'Invalid room ID' });
    }
    return res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  createRoom,
  getRooms,
  updateRoom,
  deleteRoom
};
