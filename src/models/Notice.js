const mongoose = require('mongoose');

const AttachmentSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      enum: ['image', 'pdf', 'document'],
      required: true,
    },
    data: {
      type: String,
      required: true,
    },
    mimeType: {
      type: String,
      required: true,
    },
  },
  { _id: false }
);

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
    announcementType: {
      type: String,
      enum: ['Notice', 'Announcement'],
      default: 'Notice',
    },
    eventDate: {
      type: Date,
      default: null,
    },
    attachments: [AttachmentSchema],
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
