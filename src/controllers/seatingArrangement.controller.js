const SeatingArrangement = require('../models/SeatingArrangement');
const Exam = require('../models/Exam');

const _ip = (req) =>
  req.headers['x-forwarded-for']?.split(',')[0]?.trim()
  || req.socket?.remoteAddress || req.ip || '0.0.0.0';

// ── Save or update arrangement (supports per-day) ─────────────────────────────
const saveArrangement = async (req, res) => {
  try {
    const { examId, classId, halls, date } = req.body;
    const { schoolId, sessionId, _id: createdBy } = req.user;

    if (!examId) {
      return res.status(400).json({
        success: false,
        message: 'examId is required'
      });
    }
    if (!halls || !Array.isArray(halls) || halls.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'halls array is required and cannot be empty'
      });
    }

    // Validate exam belongs to school
    const exam = await Exam.findOne({ _id: examId, schoolId, sessionId });
    if (!exam) {
      return res.status(404).json({
        success: false,
        message: 'Exam not found'
      });
    }

    // Normalize date: if provided parse it, otherwise null (default arrangement)
    let arrangeDate = null;
    if (date) {
      arrangeDate = new Date(date);
      if (isNaN(arrangeDate.getTime())) {
        return res.status(400).json({
          success: false,
          message: 'Invalid date format. Use ISO 8601 (YYYY-MM-DD)'
        });
      }
      // Normalize to start of day UTC
      arrangeDate.setUTCHours(0, 0, 0, 0);
    }

    // Build filter for upsert
    const filter = { examId, schoolId, sessionId };
    if (arrangeDate) {
      filter.date = arrangeDate;
    } else {
      filter.date = null;
    }

    const arrangement = await SeatingArrangement.findOneAndUpdate(
      filter,
      {
        examId,
        classId: classId || null,
        schoolId,
        sessionId,
        date: arrangeDate,
        halls,
        createdBy
      },
      { upsert: true, new: true, runValidators: false }
    );

    res.status(201).json({
      success: true,
      data: arrangement,
      message: arrangeDate
        ? `Seating arrangement saved for ${arrangeDate.toISOString().split('T')[0]}`
        : 'Seating arrangement saved (default/all-days)'
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'A seating arrangement already exists for this exam and date. It has been updated.'
      });
    }
    console.error('[saveArrangement] Error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Get arrangement for exam (optionally by date) ──────────────────────────────
const getArrangement = async (req, res) => {
  try {
    const { examId } = req.params;
    const { schoolId, sessionId } = req.user;
    const { date } = req.query;

    if (!examId) {
      return res.status(400).json({ success: false, message: 'examId is required' });
    }

    const filter = { examId, schoolId, sessionId };

    if (date) {
      const d = new Date(date);
      if (isNaN(d.getTime())) {
        return res.status(400).json({
          success: false,
          message: 'Invalid date format. Use YYYY-MM-DD'
        });
      }
      d.setUTCHours(0, 0, 0, 0);
      filter.date = d;
    } else {
      filter.date = null; // fetch default arrangement
    }

    const arrangement = await SeatingArrangement.findOne(filter)
      .populate({
        path: 'halls.seats.students.studentId',
        select: 'name rollNumber classId',
        populate: { path: 'classId', select: 'name' }
      })
      .lean();

    if (!arrangement) {
      return res.status(404).json({
        success: false,
        message: date
          ? `No seating arrangement found for ${date}`
          : 'No seating arrangement found'
      });
    }

    res.json({ success: true, data: arrangement });
  } catch (err) {
    console.error('[getArrangement] Error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── List all arrangements for an exam (all dates) ──────────────────────────────
const listArrangements = async (req, res) => {
  try {
    const { examId } = req.params;
    const { schoolId, sessionId } = req.user;

    const arrangements = await SeatingArrangement.find({
      examId, schoolId, sessionId
    })
      .select('date halls createdAt updatedAt')
      .sort({ date: 1 })
      .lean();

    // Summarize each arrangement
    const summary = arrangements.map((a) => ({
      _id: a._id,
      date: a.date,
      hallCount: a.halls.length,
      totalSeats: a.halls.reduce((sum, h) =>
        sum + h.seats.filter((s) => !s.isBlocked).length, 0),
      assignedSeats: a.halls.reduce((sum, h) =>
        sum + h.seats.filter((s) => s.students && s.students.length > 0).length, 0),
      updatedAt: a.updatedAt,
    }));

    res.json({ success: true, data: summary });
  } catch (err) {
    console.error('[listArrangements] Error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Delete an arrangement ──────────────────────────────────────────────────────
const deleteArrangement = async (req, res) => {
  try {
    const { arrangementId } = req.params;
    const { schoolId } = req.user;

    const result = await SeatingArrangement.findOneAndDelete({
      _id: arrangementId, schoolId
    });

    if (!result) {
      return res.status(404).json({
        success: false,
        message: 'Arrangement not found'
      });
    }

    res.json({ success: true, message: 'Arrangement deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  saveArrangement,
  getArrangement,
  listArrangements,
  deleteArrangement,
};
