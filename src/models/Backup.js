const mongoose = require('mongoose');

const backupSchema = new mongoose.Schema(
  {
    schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'School',
      required: true
    },
    status: {
      type: String,
      enum: ['PENDING', 'COMPLETED', 'FAILED'],
      default: 'PENDING'
    },
    size: {
      type: Number, // Size in bytes
      default: 0
    },
    filepath: {
      type: String,
      required: true
    },
    checksum: {
      type: String,
      required: true
    },
    type: {
      type: String,
      enum: ['FULL', 'INCREMENTAL'],
      default: 'FULL'
    },
    error: {
      type: String
    }
  },
  {
    timestamps: true
  }
);

// Index for efficient queries
backupSchema.index({ schoolId: 1, createdAt: -1 });
backupSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Backup', backupSchema);
