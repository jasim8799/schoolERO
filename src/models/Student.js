const mongoose = require('mongoose');

const studentSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Student name is required'],
    trim: true
  },
  rollNumber: {
    type: String,
    required: [true, 'Roll number is required'],
    trim: true
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
  parentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Parent',
    required: [true, 'Parent ID is required']
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true
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
  status: {
    type: String,
    enum: ['ACTIVE', 'PROMOTED', 'LEFT'],
    default: 'ACTIVE'
  },
  dateOfBirth: {
    type: Date
  },
  gender: {
    type: String,
    enum: ['Male', 'Female', 'Other']
  },
  address: {
    type: String,
    trim: true
  }
}, {
  timestamps: true
});

// Compound unique index: one roll number per class per session per school
studentSchema.index({ rollNumber: 1, classId: 1, schoolId: 1, sessionId: 1 }, { unique: true });

const Student = mongoose.model('Student', studentSchema);

module.exports = Student;
