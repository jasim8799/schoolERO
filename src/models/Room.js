const mongoose = require('mongoose');

const RoomSchema = new mongoose.Schema({
  hostelId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Hostel',
    required: true
  },
  roomNumber: {
    type: String,
    required: true
  },
  totalBeds: {
    type: Number,
    required: true,
    min: 1
  },
  availableBeds: {
    type: Number,
    required: true,
    min: 0
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

RoomSchema.index({ roomNumber: 1, hostelId: 1 }, { unique: true });

module.exports = mongoose.model('Room', RoomSchema);
