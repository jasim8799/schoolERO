const mongoose = require('mongoose');

const ResultSchema = new mongoose.Schema({
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Student',
    required: true
  },
  examId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Exam',
    required: true
  },
  marks: [
    {
      subjectId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Subject'
      },
      marksObtained: {
        type: Number
      },
      isPass: {
        type: Boolean
      }
    }
  ],
  totalMarks: {
    type: Number,
    required: true
  },
  percentage: {
    type: Number,
    required: true
  },
  grade: {
    type: String
  },
  status: {
    type: String,
    enum: ['Draft', 'Published', 'Revised'],
    default: 'Draft'
  },
  overallStatus: {
    type: String,
    enum: ['PASS', 'FAIL']
  },
  rank: {
    type: Number
  },
  promotionStatus: {
    type: String,
    enum: ['ELIGIBLE', 'NOT_ELIGIBLE']
  },
  sessionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AcademicSession',
    required: true
  },
  schoolId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'School',
    required: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true
});

ResultSchema.index({ studentId: 1, examId: 1, sessionId: 1, schoolId: 1 }, { unique: true });
ResultSchema.index({ examId: 1, percentage: -1 });

module.exports = mongoose.model('Result', ResultSchema);
