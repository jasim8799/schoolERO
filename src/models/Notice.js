const mongoose = require('mongoose');

const NoticeSchema = new mongoose.Schema(
  {
    schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'School',
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    target: {
      type: String,
      enum: ['All School', 'Students', 'Parents', 'Teachers', 'Class'],
      default: 'All School',
    },
    classId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Class',
      default: null,
    },
    isImportant: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    expiryDate: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

NoticeSchema.index({ schoolId: 1, createdAt: -1 });
NoticeSchema.index({ schoolId: 1, target: 1 });

module.exports = mongoose.model('Notice', NoticeSchema);
