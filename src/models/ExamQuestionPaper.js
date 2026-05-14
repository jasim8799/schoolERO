const mongoose = require('mongoose');

const QuestionSchema = new mongoose.Schema(
  {
    questionNumber: { type: Number, required: true },
    text: { type: String, required: true, trim: true },
    marks: { type: Number, required: true },
    section: { type: String, trim: true },
    questionType: {
      type: String,
      enum: ['MCQ', 'Short', 'Long', 'Assertion', 'Fill', 'Other'],
      default: 'Other',
    },
    imageBase64: { type: String },
    imageType: { type: String },
  },
  { _id: false }
);

const ExamQuestionPaperSchema = new mongoose.Schema(
  {
    examId: { type: mongoose.Schema.Types.ObjectId, ref: 'Exam', required: true },
    subjectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true },
    classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class' },
    teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
    sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'AcademicSession', required: true },

    // Manual questions
    questions: [QuestionSchema],
    totalMarks: { type: Number, default: 0 },
    instructions: { type: String, trim: true },

    // PDF upload
    pdfBase64: { type: String },
    pdfFileName: { type: String },
    uploadType: {
      type: String,
      enum: ['manual', 'pdf'],
      default: 'manual',
    },

    // Professional print metadata
    maxTime: { type: String, default: '3 hours' },
    maxMarks: { type: Number },

    // Principal edit fields
    principalNotes: { type: String },
    principalEditedAt: { type: Date },

    status: { type: String, enum: ['Draft', 'Submitted'], default: 'Draft' },
    submittedAt: { type: Date },
  },
  { timestamps: true }
);

ExamQuestionPaperSchema.index(
  { examId: 1, subjectId: 1, teacherId: 1, schoolId: 1, sessionId: 1 },
  { unique: true }
);

module.exports = mongoose.model('ExamQuestionPaper', ExamQuestionPaperSchema);
