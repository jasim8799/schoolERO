import mongoose from 'mongoose';
import { SCHOOL_STATUS } from '../config/constants.js';

const schoolSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'School name is required'],
    trim: true
  },
  code: {
    type: String,
    required: [true, 'School code is required'],
    unique: true,
    uppercase: true,
    trim: true
  },
  status: {
    type: String,
    enum: Object.values(SCHOOL_STATUS),
    default: SCHOOL_STATUS.ACTIVE
  },
  address: {
    type: String,
    trim: true
  },
  contact: {
    phone: String,
    email: String
  }
}, {
  timestamps: true
});

const School = mongoose.model('School', schoolSchema);

export default School;
