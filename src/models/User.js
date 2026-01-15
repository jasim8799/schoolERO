const mongoose = require('mongoose');
const { USER_ROLES, USER_STATUS } = require('../config/constants');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true
  },
  email: {
    type: String,
    trim: true,
    lowercase: true
  },
  mobile: {
    type: String,
    trim: true
  },
  whatsappNumber: {
    type: String,
    trim: true
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: 6,
    select: false  // Don't return password by default
  },
  role: {
    type: String,
    required: [true, 'Role is required'],
    enum: Object.values(USER_ROLES)
  },
  schoolId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'School',
    required: function() {
      // schoolId is not required for SUPER_ADMIN
      return this.role !== USER_ROLES.SUPER_ADMIN;
    }
  },
  status: {
    type: String,
    enum: Object.values(USER_STATUS),
    default: USER_STATUS.ACTIVE
  },
  deactivatedAt: {
    type: Date
  },
  deactivatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

// Compound index for email and mobile uniqueness
userSchema.index({ email: 1 }, { unique: true, sparse: true });
userSchema.index({ mobile: 1 }, { unique: true, sparse: true });

// Ensure at least email or mobile is provided
userSchema.pre('save', function(next) {
  if (!this.email && !this.mobile) {
    next(new Error('Either email or mobile is required'));
  }
  next();
});

const User = mongoose.model('User', userSchema);

module.exports = User;
