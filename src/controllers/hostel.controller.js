const Hostel = require('../models/Hostel.js');

const createHostel = async (req, res) => {
  try {
    const { name, capacity } = req.body;
    const { schoolId, _id: createdBy } = req.user;

    const hostel = await Hostel.create({
      name,
      capacity,
      schoolId,
      createdBy,
    });
    res.status(201).json(hostel);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: 'Hostel name already exists for this school.' });
    }
    res.status(500).json({ message: err.message });
  }
};

const getHostels = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const hostels = await Hostel.find({ schoolId });
    res.json(hostels);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = { createHostel, getHostels };
