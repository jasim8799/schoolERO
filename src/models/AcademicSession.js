const mongoose = require('mongoose');

const academicSessionSchema = new mongoose.Schema({
  schoolId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'School',
    required: [true, 'School ID is required']
  },
  name: {
    type: String,
    required: [true, 'Session name is required'],
    trim: true
  },
  startDate: {
    type: Date,
    required: [true, 'Start date is required']
  },
  endDate: {
    type: Date,
    required: [true, 'End date is required']
  },
  isActive: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Ensure only one active session per school
academicSessionSchema.index({ schoolId: 1, isActive: 1 });

// Pre-save middleware to ensure only one active session per school
academicSessionSchema.pre('save', async function(next) {
  if (this.isActive) {
    // Deactivate all other sessions for this school
    await mongoose.model('AcademicSession').updateMany(
      { schoolId: this.schoolId, _id: { $ne: this._id } },
      { isActive: false }
    );
  }
  next();
});

const AcademicSession = mongoose.model('AcademicSession', academicSessionSchema);

module.exports = AcademicSession;
