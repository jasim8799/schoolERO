import Room from '../models/Room.js';
import Hostel from '../models/Hostel.js';

export const createRoom = async (req, res) => {
  try {
    const { hostelId, roomNumber, totalBeds } = req.body;
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

export const getRooms = async (req, res) => {
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
