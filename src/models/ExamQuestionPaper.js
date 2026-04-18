const mongoose = require('mongoose');

const QuestionSchema = new mongoose.Schema(
  {
    questionNumber: { type: Number, required: true },
    text: { type: String, required: true, trim: true },
    marks: { type: Number, required: true },
    imageBase64: { type: String },
    imageType: { type: String },
  },
  { _id: false }
);

const ExamQuestionPaperSchema = new mongoose.Schema(
  {
    examId: { type: mongoose.Schema.Types.ObjectId, ref: 'Exam', required: true },
    subjectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Subject',
      required: true,
    },
    teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AcademicSession',
      required: true,
    },
    questions: [QuestionSchema],
    totalMarks: { type: Number, default: 0 },
    instructions: { type: String, trim: true },
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
