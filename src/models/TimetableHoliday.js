const mongoose = require('mongoose');

const timetableHolidaySchema = new mongoose.Schema({
  schoolId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'School',
    required: true,
    index: true
  },
  sessionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AcademicSession',
    required: true,
    index: true
  },
  date: {
    type: Date,
    required: [true, 'Date is required'],
    index: true
  },
  reason: {
    type: String,
    trim: true,
    default: 'Holiday'
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, { timestamps: true });

// One holiday per date per school per session
timetableHolidaySchema.index(
  { schoolId: 1, sessionId: 1, date: 1 },
  { unique: true }
);

module.exports = mongoose.model('TimetableHoliday', timetableHolidaySchema);
