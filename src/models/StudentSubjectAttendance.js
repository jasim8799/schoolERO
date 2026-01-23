const mongoose = require('mongoose');

const studentSubjectAttendanceSchema = new mongoose.Schema(
  {
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Student',
      required: true,
    },
    subjectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Subject',
      required: true,
    },
    classId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Class',
      required: true,
    },
    date: {
      type: Date,
      required: true,
      index: true
    },
    period: {
      type: Number,
    },
    status: {
      type: String,
      enum: ['PRESENT', 'ABSENT'],
      required: true,
    },
    teacherId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
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
  {
    timestamps: true,
  }
);

studentSubjectAttendanceSchema.index({ studentId: 1, subjectId: 1, date: 1, period: 1, schoolId: 1 }, { unique: true });
studentSubjectAttendanceSchema.index({ classId: 1, subjectId: 1, date: 1, schoolId: 1 });
studentSubjectAttendanceSchema.index({ schoolId: 1, sessionId: 1 });

module.exports = mongoose.model('StudentSubjectAttendance', studentSubjectAttendanceSchema);
