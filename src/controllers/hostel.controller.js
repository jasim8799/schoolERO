const Hostel = require('../models/Hostel.js');
const Room = require('../models/Room.js');

const createHostel = async (req, res) => {
  try {
    const { name, capacity, monthlyFee, gender, address, wardenName, wardenPhone, wardenEmail } = req.body;
    const { schoolId, _id: createdBy } = req.user;

    const hostel = await Hostel.create({
      name,
      capacity,
      monthlyFee: monthlyFee || 0,
      gender: gender || 'MIXED',
      address: address || '',
      wardenName: wardenName || '',
      wardenPhone: wardenPhone || '',
      wardenEmail: wardenEmail || '',
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

    const hostels = await Hostel.find({ schoolId }).lean();
    const hostelIds = hostels.map((h) => h._id);

    const rooms = hostelIds.length > 0
      ? await Room.find({ hostelId: { $in: hostelIds }, schoolId })
        .select('hostelId roomNumber totalBeds availableBeds wardenName wardenPhone wardenEmail')
        .lean()
      : [];

    const roomsByHostel = {};
    for (const room of rooms) {
      const key = room.hostelId.toString();
      if (!roomsByHostel[key]) roomsByHostel[key] = [];
      roomsByHostel[key].push(room);
    }

    const enriched = hostels.map((h) => {
      const key = h._id.toString();
      const hostelRooms = roomsByHostel[key] || [];
      return {
        ...h,
        rooms: hostelRooms,
        roomCount: hostelRooms.length,
      };
    });

    res.json({ success: true, data: enriched });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const updateHostel = async (req, res) => {
  try {
    const { id } = req.params;
    const { schoolId } = req.user;
    const { name, capacity, monthlyFee, gender, address, wardenName, wardenPhone, wardenEmail } = req.body;

    const payload = {
      ...(name !== undefined && { name }),
      ...(capacity !== undefined && { capacity }),
      ...(monthlyFee !== undefined && { monthlyFee }),
      ...(gender !== undefined && { gender }),
      ...(address !== undefined && { address }),
      ...(wardenName !== undefined && { wardenName }),
      ...(wardenPhone !== undefined && { wardenPhone }),
      ...(wardenEmail !== undefined && { wardenEmail }),
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

const deleteHostel = async (req, res) => {
  try {
    const { id } = req.params;
    const { schoolId } = req.user;

    // Check for active student assignments
    const StudentHostel = require('../models/StudentHostel');
    const activeCount = await StudentHostel.countDocuments({
      hostelId: id, schoolId, status: 'ACTIVE'
    });
    if (activeCount > 0) {
      return res.status(409).json({
        success: false,
        message: `Cannot delete hostel — ${activeCount} student(s) are currently assigned. Remove them first.`
      });
    }

    const hostel = await Hostel.findOneAndDelete({ _id: id, schoolId });
    if (!hostel) {
      return res.status(404).json({ success: false, message: 'Hostel not found' });
    }

    // Also delete rooms belonging to this hostel
    await Room.deleteMany({ hostelId: id, schoolId });

    return res.json({ success: true, message: 'Hostel deleted successfully' });
  } catch (err) {
    if (err.name === 'CastError') {
      return res.status(400).json({ success: false, message: 'Invalid hostel ID' });
    }
    return res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { createHostel, getHostels, updateHostel, deleteHostel };
