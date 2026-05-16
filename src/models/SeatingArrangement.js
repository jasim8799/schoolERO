const mongoose = require('mongoose');

// Supports up to 2 students per bench/seat
const SeatStudentSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student' },
  name:      { type: String },
  rollNumber:{ type: String },
  className: { type: String },
  section:   { type: String },
}, { _id: false });

const SeatSchema = new mongoose.Schema({
  row:        Number,
  col:        Number,
  seatLabel:  String,
  // students: supports 1 or 2 students per bench
  students:   [SeatStudentSchema],
  isBlocked:  { type: Boolean, default: false },
}, { _id: false });

const HallSchema = new mongoose.Schema({
  hallName:    String,
  rows:        Number,
  cols:        Number,
  studentsPerBench: { type: Number, default: 1 }, // 1 or 2
  seats:       [SeatSchema],
}, { _id: false });

const SeatingArrangementSchema = new mongoose.Schema({
  examId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Exam', required: true },
  classId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Class' },
  schoolId:  { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
  sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'AcademicSession', required: true },
  // date: optional - if set, this arrangement is for a specific exam day
  // if null, it's the default/all-days arrangement
  date:      { type: Date, default: null },
  halls:     [HallSchema],
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

// Index: examId + schoolId + sessionId + date (null = default)
SeatingArrangementSchema.index(
  { examId: 1, schoolId: 1, sessionId: 1, date: 1 },
  { unique: true, sparse: true }
);

module.exports = mongoose.model('SeatingArrangement', SeatingArrangementSchema);
