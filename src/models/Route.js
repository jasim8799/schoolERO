const mongoose = require('mongoose');

const RouteSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  stops: [{
    type: String
  }],
  vehicleId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Vehicle',
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
  },
  monthlyFee: {
    type: Number,
    default: 0,
    min: 0
  },
  startPoint: {
    type: String,
    default: ''
  },
  endPoint: {
    type: String,
    default: ''
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Route', RouteSchema);
