const Ptm        = require('../models/Ptm');
const PtmBooking = require('../models/PtmBooking');
const Student    = require('../models/Student');
const Parent     = require('../models/Parent');

// PRINCIPAL/OPERATOR: Create PTM
const createPtm = async (req, res) => {
  try {
    const { title, description, date, startTime, endTime,
            teacherId, classId, maxSlots } = req.body;
    const { schoolId, _id: createdBy } = req.user;
    const ptm = await Ptm.create({
      schoolId, title, description: description || '',
      date: new Date(date), startTime, endTime,
      teacherId, classId: classId || null,
      maxSlots: maxSlots || 20, createdBy,
    });
    return res.status(201).json({ success: true, data: ptm });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ALL: Get PTMs for this school
const getPtms = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { classId, status } = req.query;
    const filter = { schoolId };
    if (classId) filter.classId = classId;
    if (status)  filter.status  = status;
    const ptms = await Ptm.find(filter)
      .populate({ path: 'teacherId', select: 'userId',
          populate: { path: 'userId', select: 'name' } })
      .populate('classId', 'name')
      .sort({ date: 1 })
      .lean();
    // Attach booking count to each PTM
    const ptmIds = ptms.map(p => p._id);
    const bookings = await PtmBooking.find({
      ptmId: { $in: ptmIds }, status: 'BOOKED' })
      .select('ptmId').lean();
    const countMap = {};
    for (const b of bookings) {
      const key = b.ptmId.toString();
      countMap[key] = (countMap[key] || 0) + 1;
    }
    const enriched = ptms.map(p => ({
      ...p,
      bookedCount: countMap[p._id.toString()] || 0,
    }));
    return res.json({ success: true, data: enriched });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// PARENT/STUDENT: Book a PTM slot
const bookPtm = async (req, res) => {
  try {
    const { ptmId, studentId: bodyStudentId } = req.body;
    const { schoolId, _id: userId, role } = req.user;
    if (!ptmId) return res.status(400).json({
      success: false, message: 'ptmId is required' });

    const ptm = await Ptm.findOne({ _id: ptmId, schoolId });
    if (!ptm) return res.status(404).json({
      success: false, message: 'PTM not found' });
    if (ptm.status === 'CANCELLED' || ptm.status === 'COMPLETED')
      return res.status(400).json({
        success: false, message: 'This PTM is no longer accepting bookings' });

    // Check slot availability
    const existingCount = await PtmBooking.countDocuments({
      ptmId, status: 'BOOKED' });
    if (existingCount >= ptm.maxSlots)
      return res.status(400).json({
        success: false, message: 'No slots available' });

    let studentId, parentId;
    if (role === 'STUDENT') {
      const student = await Student.findOne({
        userId, schoolId }).select('_id').lean();
      if (!student) return res.status(404).json({
        success: false, message: 'Student not found' });
      studentId = student._id;
    } else if (role === 'PARENT') {
      studentId = bodyStudentId;
      const parent = await Parent.findOne({
        userId, schoolId }).select('_id').lean();
      parentId = parent?._id;
    } else {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    // Check duplicate booking
    const existing = await PtmBooking.findOne({ ptmId, studentId });
    if (existing) return res.status(409).json({
      success: false, message: 'Already booked for this PTM' });

    const booking = await PtmBooking.create({
      ptmId, studentId, parentId: parentId || null,
      schoolId, bookedBy: userId,
    });
    return res.status(201).json({ success: true, data: booking });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// STUDENT/PARENT: Get my bookings
const getMyBookings = async (req, res) => {
  try {
    const { schoolId, _id: userId, role } = req.user;
    let studentId;
    if (role === 'STUDENT') {
      const student = await Student.findOne({
        userId, schoolId }).select('_id').lean();
      if (!student) return res.json({ success: true, data: [] });
      studentId = student._id;
    } else {
      studentId = req.query.studentId;
    }
    const filter = { schoolId };
    if (studentId) filter.studentId = studentId;
    const bookings = await PtmBooking.find(filter)
      .populate({ path: 'ptmId',
          populate: [
            { path: 'teacherId', select: 'userId',
                populate: { path: 'userId', select: 'name' } },
            { path: 'classId', select: 'name' },
          ]
      })
      .sort({ createdAt: -1 })
      .lean();
    return res.json({ success: true, data: bookings });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// PRINCIPAL/OPERATOR: Get all bookings for a PTM
const getPtmBookings = async (req, res) => {
  try {
    const { ptmId } = req.params;
    const { schoolId } = req.user;
    const bookings = await PtmBooking.find({ ptmId, schoolId })
      .populate({ path: 'studentId', select: 'rollNumber',
          populate: { path: 'userId', select: 'name' } })
      .sort({ createdAt: 1 })
      .lean();
    return res.json({ success: true, data: bookings });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// PRINCIPAL/OPERATOR: Update PTM status
const updatePtmStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const { schoolId } = req.user;
    const ptm = await Ptm.findOneAndUpdate(
      { _id: id, schoolId }, { status }, { new: true });
    if (!ptm) return res.status(404).json({
      success: false, message: 'PTM not found' });
    return res.json({ success: true, data: ptm });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// STUDENT/PARENT: Cancel booking
const cancelBooking = async (req, res) => {
  try {
    const { id } = req.params;
    const { schoolId } = req.user;
    const booking = await PtmBooking.findOneAndUpdate(
      { _id: id, schoolId }, { status: 'CANCELLED' }, { new: true });
    if (!booking) return res.status(404).json({
      success: false, message: 'Booking not found' });
    return res.json({ success: true, data: booking });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  createPtm, getPtms, bookPtm,
  getMyBookings, getPtmBookings,
  updatePtmStatus, cancelBooking,
};
