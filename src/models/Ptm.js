const mongoose = require('mongoose');

const PtmSchema = new mongoose.Schema({
  schoolId:    { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
  title:       { type: String, required: true },
  description: { type: String, default: '' },
  date:        { type: Date, required: true },
  startTime:   { type: String, required: true }, // e.g. "10:00 AM"
  endTime:     { type: String, required: true },
  teacherId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Teacher', required: true },
  classId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Class' },
  maxSlots:    { type: Number, default: 20 },
  status:      { type: String, enum: ['UPCOMING', 'ONGOING', 'COMPLETED', 'CANCELLED'], default: 'UPCOMING' },
  createdBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

PtmSchema.index({ schoolId: 1, date: -1 });
module.exports = mongoose.model('Ptm', PtmSchema);
