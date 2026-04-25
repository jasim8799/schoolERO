const mongoose = require('mongoose');
const ObjectId = mongoose.Schema.Types.ObjectId;

const AutomationRuleSchema = new mongoose.Schema({
  schoolId: { type: ObjectId, ref: 'School', required: true },
  name: { type: String, required: true, trim: true },
  isActive: { type: Boolean, default: true },
  trigger: {
    type: String,
    enum: [
      'FEE_DUE',
      'FEE_OVERDUE',
      'EXAM_PUBLISHED',
      'RESULT_PUBLISHED',
      'ADMIT_CARD_PUBLISHED',
      'HOMEWORK_ASSIGNED',
      'PTM_SCHEDULED',
      'LOW_ATTENDANCE',
      'TC_ISSUED',
    ],
    required: true
  },
  condition: {
    field: { type: String },
    operator: { type: String, enum: ['gt', 'lt', 'eq', 'gte', 'lte'] },
    value: { type: mongoose.Schema.Types.Mixed }
  },
  action: {
    type: {
      type: String,
      enum: [
        'SEND_NOTIFICATION',
        'SEND_EMAIL',
        'SEND_SMS',
        'ASSIGN_FEE',
        'UPDATE_STATUS'
      ]
    },
    target: {
      type: String,
      enum: ['STUDENT', 'PARENT', 'TEACHER', 'OPERATOR', 'PRINCIPAL', 'ALL']
    },
    message: { type: String },
    template: { type: String },
  },
  // How long the notification stays active in the ticker/screens (hours)
  // 0 = no expiry. Min: 0, Max: 720 (30 days)
  expiryHours: {
    type: Number,
    default: 24,
    min: 0,
    max: 720,
  },
  // When the last notification was dispatched
  // Used to compute if ticker should still show it
  lastDispatchedAt: { type: Date },
  lastRunAt: { type: Date },
  runCount: { type: Number, default: 0 }
}, { timestamps: true });

AutomationRuleSchema.index({ schoolId: 1, trigger: 1, isActive: 1 });

module.exports = mongoose.model('AutomationRule', AutomationRuleSchema);
