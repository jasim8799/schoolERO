const mongoose = require('mongoose');

const VideoSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    topic: {
      type: String,
      trim: true,
    },
    classId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Class',
      required: true,
    },
    subjectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Subject',
      required: true,
    },
    videoUrl: {
      type: String,
      required: true,
    },
    videoType: {
      type: String,
      enum: ['youtube', 'external'],
      default: 'external',
    },
    thumbnailUrl: {
      type: String,
    },
    duration: {
      type: String, // e.g. "12:30"
    },
    isFree: {
      type: Boolean,
      default: true,
    },
    visibility: {
      type: String,
      enum: ['all', 'class'],
      default: 'class',
    },
    createdBy: {
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
    },
  },
  { timestamps: true }
);

VideoSchema.index({ classId: 1, schoolId: 1 });
VideoSchema.index({ subjectId: 1, schoolId: 1 });

module.exports = mongoose.model('Video', VideoSchema);
