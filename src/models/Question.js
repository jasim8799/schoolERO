const mongoose = require('mongoose');

const QuestionSchema = new mongoose.Schema(
  {
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Student',
      required: true,
    },
    teacherId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Teacher',
      required: true,
    },
    subjectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Subject',
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
      required: false,
    },
    chapter: { type: String, default: '' },
    topic: { type: String, default: '' },
    questionText: { type: String, default: '' },
    questionImage: { type: String, default: '' },
    answerText: { type: String, default: '' },
    answerImage: { type: String, default: '' },
    status: {
      type: String,
      enum: ['PENDING', 'ANSWERED'],
      default: 'PENDING',
    },
    answeredAt: { type: Date },
  },
  { timestamps: true }
);

QuestionSchema.index({ studentId: 1, schoolId: 1 });
QuestionSchema.index({ teacherId: 1, schoolId: 1 });
QuestionSchema.index({ schoolId: 1, status: 1 });
QuestionSchema.index({ schoolId: 1, sessionId: 1 });

module.exports = mongoose.model('Question', QuestionSchema);
