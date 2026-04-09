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
  photoUrl: {
    type: String,
    default: null
  },
  // Personal details
  gender: {
    type: String,
    enum: ['Male', 'Female', 'Other'],
    default: null
  },
  dateOfBirth: {
    type: Date,
    default: null
  },
  bloodGroup: {
    type: String,
    default: null
  },
  address: {
    type: String,
    trim: true,
    default: null
  },
  city: {
    type: String,
    trim: true,
    default: null
  },
  state: {
    type: String,
    trim: true,
    default: null
  },
  pincode: {
    type: String,
    trim: true,
    default: null
  },

  // Professional details
  employeeId: {
    type: String,
    trim: true,
    default: null
  },
  designation: {
    type: String,
    trim: true,
    default: null
  },
  department: {
    type: String,
    trim: true,
    default: null
  },
  dateOfJoining: {
    type: Date,
    default: null
  },
  qualification: {
    type: String,
    trim: true,
    default: null
  },
  experienceYears: {
    type: Number,
    default: 0
  },
  previousSchool: {
    type: String,
    trim: true,
    default: null
  },
  subjects: {
    type: [String],
    default: []
  },

  // Salary / bank details
  monthlySalary: {
    type: Number,
    default: 0
  },
  accountNumber: {
    type: String,
    trim: true,
    default: null
  },
  bankName: {
    type: String,
    trim: true,
    default: null
  },
  ifscCode: {
    type: String,
    trim: true,
    default: null
  },
  upiId: {
    type: String,
    trim: true,
    default: null
  },

  // Emergency / family
  emergencyContactName: {
    type: String,
    trim: true,
    default: null
  },
  emergencyContactRelation: {
    type: String,
    trim: true,
    default: null
  },
  emergencyContactPhone: {
    type: String,
    trim: true,
    default: null
  },
  spouseName: {
    type: String,
    trim: true,
    default: null
  },
  spouseMobile: {
    type: String,
    trim: true,
    default: null
  },

  // Documents (base64 dataUrls)
  documents: {
    aadhaarCard: {
      fileName: String,
      dataUrl: { type: String, select: false },
      uploadedAt: Date
    },
    panCard: {
      fileName: String,
      dataUrl: { type: String, select: false },
      uploadedAt: Date
    },
    degreeCertificate: {
      fileName: String,
      dataUrl: { type: String, select: false },
      uploadedAt: Date
    },
    experienceCertificate: {
      fileName: String,
      dataUrl: { type: String, select: false },
      uploadedAt: Date
    },
    staffPhoto: {
      fileName: String,
      dataUrl: { type: String, select: false },
      uploadedAt: Date
    }
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
