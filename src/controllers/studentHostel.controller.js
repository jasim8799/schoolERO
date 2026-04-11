const StudentHostel = require('../models/StudentHostel.js');
const Student = require('../models/Student.js');
const Room = require('../models/Room.js');
const School = require('../models/School.js');

const assignHostel = async (req, res) => {
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

        const Hostel = require('../models/Hostel');
        const hostelDoc = await Hostel.findById(hostelId)
          .select('name monthlyFee').lean();

        const monthlyFee = hostelDoc?.monthlyFee || 0;
        const description = hostelDoc?.name
          ? `Hostel Fee — ${hostelDoc.name} Room ${bedNumber}`
          : `Hostel Fee — Room ${bedNumber}`;

        await Bill.create({
          billNumber,
          studentId,
          schoolId,
          sessionId: activeSession._id,
          billType: 'HOSTEL',
          sourceType: 'StudentHostel',
          sourceId: hostel._id,
          description,
          totalAmount: monthlyFee,
          paidAmount: 0,
          dueAmount: monthlyFee,
          status: 'UNPAID',
          createdBy: req.user._id
        });
      }
    } catch (billErr) {
      console.error('Hostel bill dual-write failed:', billErr.message);
    }
    // ── End billing dual-write ──────────────────────────────────────

    res.status(201).json(hostel);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getStudentHostel = async (req, res) => {
  try {
    const { id } = req.params;
    const { schoolId } = req.user;

    let assignment = await StudentHostel.findOne({ studentId: id, schoolId, status: 'ACTIVE' })
      .populate('hostelId', 'name monthlyFee gender address capacity wardenName wardenPhone wardenEmail')
      .populate('roomId', 'roomNumber totalBeds availableBeds wardenName wardenPhone wardenEmail');

    if (!assignment) {
      const student = await Student.findOne({ userId: id, schoolId }).select('_id').lean();
      if (student?._id) {
        assignment = await StudentHostel.findOne({ studentId: student._id, schoolId, status: 'ACTIVE' })
          .populate('hostelId', 'name monthlyFee gender address capacity wardenName wardenPhone wardenEmail')
          .populate('roomId', 'roomNumber totalBeds availableBeds wardenName wardenPhone wardenEmail');
      }
    }

    if (!assignment) {
      return res.json({ success: true, data: null });
    }

    const school = await School.findById(schoolId).select('address name contact').lean();
    const hostelAddress = assignment.hostelId?.address?.trim() || '';
    const schoolAddress = school?.address?.trim() || '';

    const data = assignment.toObject ? assignment.toObject() : assignment;
    data.schoolAddress = schoolAddress;
    data.schoolName = school?.name || '';
    data.schoolPhone = school?.contact?.phone || '';

    if (!hostelAddress && schoolAddress && data.hostelId) {
      data.hostelId.address = schoolAddress;
    }

    return res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getAllStudentHostels = async (req, res) => {
  try {
    const { schoolId } = req.user;

    const assignments = await StudentHostel.find({ schoolId, status: 'ACTIVE' })
      .populate('studentId', 'name rollNumber')
      .populate('hostelId', 'name monthlyFee gender address capacity wardenName wardenPhone wardenEmail')
      .populate('roomId', 'roomNumber totalBeds availableBeds wardenName wardenPhone wardenEmail')
      .sort({ createdAt: -1 });

    res.json({ success: true, data: assignments });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  assignHostel,
  getStudentHostel,
  getAllStudentHostels
};
