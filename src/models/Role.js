import mongoose from 'mongoose';
import { USER_ROLES } from '../config/constants.js';

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

export default Role;
