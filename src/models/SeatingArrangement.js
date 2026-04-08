const mongoose = require('mongoose');

const SeatSchema = new mongoose.Schema({
  row: Number,
  col: Number,
  seatLabel: String,
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student' },
  rollNumber: String,
}, { _id: false });

const HallSchema = new mongoose.Schema({
  hallName: String,
  rows: Number,
  cols: Number,
  seats: [SeatSchema],
}, { _id: false });

const SeatingArrangementSchema = new mongoose.Schema({
  examId: { type: mongoose.Schema.Types.ObjectId, ref: 'Exam', required: true },
  classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class' },
  schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
  sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'AcademicSession', required: true },
  halls: [HallSchema],
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

SeatingArrangementSchema.index({ examId: 1, schoolId: 1, sessionId: 1 });

module.exports = mongoose.model('SeatingArrangement', SeatingArrangementSchema);
