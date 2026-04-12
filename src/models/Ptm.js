const mongoose = require('mongoose');

const PtmSchema = new mongoose.Schema({
  schoolId:      { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
  title:         { type: String, required: true },
  description:   { type: String, default: '' },
  date:          { type: Date, required: true },
  startTime:     { type: String, required: true },
  endTime:       { type: String, required: true },
  teacherId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Teacher', required: true },
  classId:       { type: mongoose.Schema.Types.ObjectId, ref: 'Class' },
  maxSlots:      { type: Number, default: 20 },
  status:        { type: String, enum: ['UPCOMING', 'ONGOING', 'COMPLETED', 'CANCELLED'], default: 'UPCOMING' },
  createdBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  // Agenda items configured while scheduling PTM.
  agendaPoints:  [{ type: String }],

  // Post-meeting notes and recording details.
  meetingSummary:   { type: String, default: '' },
  discussionPoints: [{ type: String }],
  recordingUrl:     { type: String, default: '' },
  recordingTitle:   { type: String, default: '' },
}, { timestamps: true });

PtmSchema.index({ schoolId: 1, date: -1 });
PtmSchema.index({ teacherId: 1, schoolId: 1 });
module.exports = mongoose.model('Ptm', PtmSchema);
