const mongoose = require('mongoose');

const staffAttendanceSchema = new mongoose.Schema(
  {
    staffId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    // Denormalised role so reports can filter without joining User every time
    role: {
      type: String,
      enum: ['TEACHER', 'OPERATOR', 'PRINCIPAL', 'SUPER_ADMIN'],
      required: true,
    },
    date: {
      type: Date,
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['PRESENT', 'ABSENT', 'LATE', 'HALF_DAY', 'LEAVE', 'SICK_LEAVE'],
      required: true,
    },
    checkIn:  { type: String },
    checkOut: { type: String },
    markedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'School',
      required: true,
    },
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AcademicSession',
      required: true,
    },
  },
  { timestamps: true }
);

// Unique: one record per staff per day per school
staffAttendanceSchema.index(
  { staffId: 1, date: 1, schoolId: 1 },
  { unique: true }
);
staffAttendanceSchema.index({ schoolId: 1, sessionId: 1, date: 1 });
staffAttendanceSchema.index({ schoolId: 1, role: 1, date: 1 });

module.exports = mongoose.model('StaffAttendance', staffAttendanceSchema);
