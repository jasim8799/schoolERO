const Ptm        = require('../models/Ptm');
const PtmBooking = require('../models/PtmBooking');
const Student    = require('../models/Student');
const Parent     = require('../models/Parent');
const Teacher    = require('../models/Teacher');

// Helpers
async function _enrichPtms(ptms) {
  const ids = ptms.map(p => p._id);
  const bookings = await PtmBooking.find({
    ptmId: { $in: ids }, status: 'BOOKED' }).select('ptmId').lean();
  const countMap = {};
  for (const b of bookings) {
    const k = b.ptmId.toString();
    countMap[k] = (countMap[k] || 0) + 1;
  }
  return ptms.map(p => ({ ...p, bookedCount: countMap[p._id.toString()] || 0 }));
}

// PRINCIPAL/OPERATOR: Create PTM
const createPtm = async (req, res) => {
  try {
    const { title, description, date, startTime, endTime,
            teacherId, classId, maxSlots, agendaPoints } = req.body;
    const { schoolId, _id: createdBy } = req.user;
    const ptm = await Ptm.create({
      schoolId,
      title,
      description: description || '',
      date: new Date(date),
      startTime,
      endTime,
      teacherId,
      classId: classId || null,
      maxSlots: maxSlots || 20,
      createdBy,
      agendaPoints: Array.isArray(agendaPoints) ? agendaPoints : [],
    });
    return res.status(201).json({ success: true, data: ptm });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ALL roles: Get PTMs for this school
const getPtms = async (req, res) => {
  try {
    const { schoolId, _id: userId, role } = req.user;
    const { classId, status } = req.query;
    const filter = { schoolId };
    if (status) filter.status = status;

    if (role === 'TEACHER') {
      const teacher = await Teacher.findOne({ userId, schoolId })
        .select('_id')
        .lean();
      if (teacher) filter.teacherId = teacher._id;
      if (classId) filter.classId = classId;
    } else if (role === 'STUDENT') {
      const student = await Student.findOne({ userId, schoolId })
        .select('classId')
        .lean();
      if (student?.classId) {
        filter.$or = [
          { classId: student.classId },
          { classId: null },
          { classId: { $exists: false } },
        ];
      }
    } else if (role === 'PARENT') {
      const studentId = req.query.studentId;
      if (studentId) {
        const student = await Student.findById(studentId)
          .select('classId')
          .lean();
        if (student?.classId) {
          filter.$or = [
            { classId: student.classId },
            { classId: null },
            { classId: { $exists: false } },
          ];
        }
      }
    } else {
      if (classId) filter.classId = classId;
    }

    const ptms = await Ptm.find(filter)
      .populate({ path: 'teacherId', select: 'userId',
          populate: { path: 'userId', select: 'name' } })
      .populate('classId', 'name')
      .sort({ date: 1 })
      .lean();

    const enriched = await _enrichPtms(ptms);
    return res.json({ success: true, data: enriched });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// STUDENT/PARENT: Book PTM with optional note
const bookPtm = async (req, res) => {
  try {
    const { ptmId, studentId: bodyStudentId, notes } = req.body;
    const { schoolId, _id: userId, role } = req.user;
    if (!ptmId) return res.status(400).json({
      success: false, message: 'ptmId is required' });

    const ptm = await Ptm.findOne({ _id: ptmId, schoolId });
    if (!ptm) return res.status(404).json({
      success: false, message: 'PTM not found' });
    if (ptm.status === 'CANCELLED' || ptm.status === 'COMPLETED')
      return res.status(400).json({
        success: false, message: 'PTM no longer accepting bookings' });

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
      notes: notes || '',
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
      .populate({ path: 'studentId', select: 'rollNumber classId sectionId',
          populate: [
            { path: 'userId', select: 'name' },
            { path: 'classId', select: 'name' },
            { path: 'sectionId', select: 'name' },
          ] })
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

// PRINCIPAL/OPERATOR: Mark booking as attended
const markAttendance = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { schoolId } = req.user;
    const booking = await PtmBooking.findOneAndUpdate(
      { _id: bookingId, schoolId },
      { status: 'ATTENDED' },
      { new: true }
    );
    if (!booking) return res.status(404).json({
      success: false, message: 'Booking not found' });
    return res.json({ success: true, data: booking });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// PRINCIPAL/OPERATOR/TEACHER: Save meeting notes and recording info
const addMeetingNotes = async (req, res) => {
  try {
    const { id } = req.params;
    const { meetingSummary, discussionPoints, recordingUrl, recordingTitle } = req.body;
    const { schoolId } = req.user;

    const update = {};
    if (meetingSummary !== undefined) update.meetingSummary = meetingSummary;
    if (discussionPoints !== undefined) {
      update.discussionPoints = Array.isArray(discussionPoints) ? discussionPoints : [];
    }
    if (recordingUrl !== undefined) update.recordingUrl = recordingUrl;
    if (recordingTitle !== undefined) update.recordingTitle = recordingTitle;

    const ptm = await Ptm.findOneAndUpdate(
      { _id: id, schoolId },
      update,
      { new: true }
    )
      .populate({ path: 'teacherId', select: 'userId', populate: { path: 'userId', select: 'name' } })
      .populate('classId', 'name');

    if (!ptm) return res.status(404).json({
      success: false, message: 'PTM not found' });
    return res.json({ success: true, data: ptm });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  createPtm, getPtms, bookPtm,
  getMyBookings, getPtmBookings,
  updatePtmStatus, cancelBooking,
  markAttendance, addMeetingNotes,
};
