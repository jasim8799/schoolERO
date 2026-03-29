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
  },
  lifecycleStatus: {
    type: String,
    enum: ['SETUP', 'ACTIVE', 'EXAM_PHASE', 'RESULT_PHASE', 'CLOSED'],
    default: 'SETUP'
  },
  closedAt: { type: Date },
  settings: {
    attendanceCutoffTime: { type: String, default: '10:00' },
    lateFeeEnabled: { type: Boolean, default: false },
    lateFeeAmount: { type: Number, default: 0 },
    lateFeeAfterDays: { type: Number, default: 5 }
  }
}, {
  timestamps: true
});

// Enforce only one active session per school at DB level
academicSessionSchema.index(
  { schoolId: 1 },
  { unique: true, partialFilterExpression: { isActive: true } }
);

// Prevent duplicate session names per school
academicSessionSchema.index(
  { schoolId: 1, name: 1 },
  { unique: true }
);

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
