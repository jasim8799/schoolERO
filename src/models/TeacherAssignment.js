const mongoose = require('mongoose');

const teacherAssignmentSchema = new mongoose.Schema({
  teacherId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Teacher',
    required: [true, 'Teacher ID is required']
  },
  classId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Class',
    required: [true, 'Class ID is required']
  },
  sectionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Section',
    required: [true, 'Section ID is required']
  },
  subjectId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Subject',
    required: [true, 'Subject ID is required']
  },
  day: {
    type: String,
    enum: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    required: [true, 'Day is required']
  },
  periodNumber: {
    type: Number,
    required: [true, 'Period number is required'],
    min: [1, 'Period number must be at least 1'],
    max: [10, 'Period number must not exceed 10']
  },
  startTime: {
    type: String,
    required: [true, 'Start time is required'],
    match: [/^\d{2}:\d{2}$/, 'Start time must be in HH:MM format']
  },
  endTime: {
    type: String,
    required: [true, 'End time is required'],
    match: [/^\d{2}:\d{2}$/, 'End time must be in HH:MM format']
  },
  schoolId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'School',
    required: [true, 'School ID is required']
  },
  sessionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AcademicSession',
    required: [true, 'Session ID is required']
  },
  isPublished: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Prevent two different teachers from occupying the same class+section+day+period
teacherAssignmentSchema.index(
  { classId: 1, sectionId: 1, day: 1, periodNumber: 1, sessionId: 1 },
  { unique: true }
);

// Prevent the same teacher from being double-booked at the same day+period
teacherAssignmentSchema.index(
  { teacherId: 1, day: 1, periodNumber: 1, sessionId: 1 },
  { unique: true }
);

const TeacherAssignment = mongoose.model('TeacherAssignment', teacherAssignmentSchema);

module.exports = TeacherAssignment;
