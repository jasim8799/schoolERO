const mongoose = require('mongoose');
const { USER_ROLES } = require('../config/constants.js');

const roleSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Role name is required'],
    unique: true,
    enum: Object.values(USER_ROLES)
  },
  description: {
    type: String,
    trim: true
  }
}, {
  timestamps: true
});

const Role = mongoose.model('Role', roleSchema);

module.exports = Role;
