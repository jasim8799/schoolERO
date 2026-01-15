const mongoose = require('mongoose');

const systemSettingsSchema = new mongoose.Schema({
  maintenanceMode: {
    type: Boolean,
    default: false
  },
  maintenanceMessage: {
    type: String,
    default: 'System is currently under maintenance. Please try again later.'
  },
  lastUpdatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

// Ensure only one document exists
systemSettingsSchema.pre('save', async function(next) {
  const count = await mongoose.model('SystemSettings').countDocuments();
  if (count > 0 && this.isNew) {
    const error = new Error('Only one system settings document is allowed');
    return next(error);
  }
  next();
});

const SystemSettings = mongoose.model('SystemSettings', systemSettingsSchema);

module.exports = SystemSettings;
