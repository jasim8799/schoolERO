const { Schema, model } = require('mongoose');

const RenewalReminderSchema = new Schema({
  schoolId:         { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
  channel:          { type: String, enum: ['EMAIL','WHATSAPP','SMS','IN_APP'] },
  daysBeforeExpiry: { type: Number },
  sentAt:           { type: Date },
  status:           { type: String, enum: ['PENDING','SENT','FAILED','DELIVERED'], default: 'PENDING' },
  responseAction:   { type: String },   // 'RENEWED', 'IGNORED', 'OPENED'
}, { timestamps: true });

RenewalReminderSchema.index({ schoolId: 1, createdAt: -1 });

module.exports = model('RenewalReminder', RenewalReminderSchema);
