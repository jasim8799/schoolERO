import mongoose from 'mongoose';

const teacherAttendanceSchema = new mongoose.Schema(
  {
    teacherId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
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
    checkIn: {
      type: String,
    },
    checkOut: {
      type: String,
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

teacherAttendanceSchema.index({ teacherId: 1, date: 1, schoolId: 1 }, { unique: true });
teacherAttendanceSchema.index({ schoolId: 1, sessionId: 1, date: 1 });

export default mongoose.model('TeacherAttendance', teacherAttendanceSchema);
