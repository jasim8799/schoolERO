const mongoose = require('mongoose');
const { USER_ROLES } = require('../config/constants.js');

const systemAnnouncementSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Title is required'],
    trim: true,
    maxlength: 200
  },
  message: {
    type: String,
    required: [true, 'Message is required'],
    trim: true,
    maxlength: 2000
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },
  targetRoles: [{
    type: String,
    enum: Object.values(USER_ROLES)
  }], // If empty, visible to all roles
  expiresAt: {
    type: Date,
    default: null // If set, announcement expires after this date
  }
}, {
  timestamps: true
});

// Index for efficient queries
systemAnnouncementSchema.index({ isActive: 1, createdAt: -1 });
systemAnnouncementSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL index for auto-expiry

const SystemAnnouncement = mongoose.model('SystemAnnouncement', systemAnnouncementSchema);

module.exports = SystemAnnouncement;
