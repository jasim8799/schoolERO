const mongoose = require('mongoose');

const HostelSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  type: {
    type: String,
    enum: ['BOYS', 'GIRLS', 'MIXED'],
    required: true
  },
  address: {
    type: String,
    required: true
  },
  wardenName: {
    type: String,
    required: true
  },
  wardenContact: {
    type: String,
    required: true
  },
  schoolId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'School',
    required: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true
});

HostelSchema.index({ name: 1, schoolId: 1 }, { unique: true });

module.exports = mongoose.model('Hostel', HostelSchema);
