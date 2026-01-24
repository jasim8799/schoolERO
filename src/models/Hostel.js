const mongoose = require('mongoose');

const HostelSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  capacity: {
    type: Number,
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
