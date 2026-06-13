const mongoose = require('mongoose');

const systemSettingsSchema = new mongoose.Schema({
  // Platform Settings
  maintenanceMode: {
    type: Boolean,
    default: false
  },
  maintenanceMessage: {
    type: String,
    default: 'System is currently under maintenance. Please try again later.'
  },
  registrationOpen: {
    type: Boolean,
    default: true
  },
  apiEnabled: {
    type: Boolean,
    default: true
  },
  
  // Notification Settings
  emailNotifications: {
    type: Boolean,
    default: true
  },
  smsNotifications: {
    type: Boolean,
    default: false
  },
  
  // Platform Info
  platformName: {
    type: String,
    default: 'School ERP'
  },
  supportEmail: {
    type: String,
    default: ''
  },
  supportPhone: {
    type: String,
    default: ''
  },
  
  // Security Settings
  twoFactorEnabled: {
    type: Boolean,
    default: false
  },
  
  // Last updated tracking
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
