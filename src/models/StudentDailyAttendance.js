import mongoose from 'mongoose';

const studentDailyAttendanceSchema = new mongoose.Schema(
  {
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Student',
      required: true,
    },
    classId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Class',
      required: true,
    },
    sectionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Section',
      required: true,
    },
    date: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ['PRESENT', 'ABSENT'],
      required: true,
    },
    markedBy: {
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

studentDailyAttendanceSchema.index({ studentId: 1, date: 1, schoolId: 1 }, { unique: true });
studentDailyAttendanceSchema.index({ classId: 1, date: 1, schoolId: 1 });
studentDailyAttendanceSchema.index({ schoolId: 1, sessionId: 1 });

export default mongoose.model('StudentDailyAttendance', studentDailyAttendanceSchema);
