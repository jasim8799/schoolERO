const mongoose = require('mongoose');

const PtmBookingSchema = new mongoose.Schema({
  ptmId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Ptm', required: true },
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
  parentId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Parent' },
  schoolId:  { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
  bookedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  status:    { type: String, enum: ['BOOKED', 'CANCELLED', 'ATTENDED'], default: 'BOOKED' },
  notes:     { type: String, default: '' },
}, { timestamps: true });

PtmBookingSchema.index({ ptmId: 1, studentId: 1 }, { unique: true });
PtmBookingSchema.index({ schoolId: 1, studentId: 1 });
module.exports = mongoose.model('PtmBooking', PtmBookingSchema);
