const Hostel = require('../models/Hostel.js');

const createHostel = async (req, res) => {
  try {
    const { name, capacity, monthlyFee, gender, address } = req.body;
    const { schoolId, _id: createdBy } = req.user;

    const hostel = await Hostel.create({
      name,
      capacity,
      monthlyFee: monthlyFee || 0,
      gender: gender || 'MIXED',
      address: address || '',
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
    res.json({ success: true, data: hostels });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const updateHostel = async (req, res) => {
  try {
    const { id } = req.params;
    const { schoolId } = req.user;
    const { name, capacity, monthlyFee, gender, address } = req.body;

    const payload = {
      ...(name !== undefined && { name }),
      ...(capacity !== undefined && { capacity }),
      ...(monthlyFee !== undefined && { monthlyFee }),
      ...(gender !== undefined && { gender }),
      ...(address !== undefined && { address }),
    };

    const hostel = await Hostel.findOneAndUpdate(
      { _id: id, schoolId },
      payload,
      { new: true, runValidators: true }
    );

    if (!hostel) {
      return res.status(404).json({ message: 'Hostel not found' });
    }

    res.json({ success: true, data: hostel });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = { createHostel, getHostels, updateHostel };
