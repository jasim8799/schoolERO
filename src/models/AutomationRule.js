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
      'ATTENDANCE_ABSENT'
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
  lastRunAt: { type: Date },
  runCount: { type: Number, default: 0 }
}, { timestamps: true });

AutomationRuleSchema.index({ schoolId: 1, trigger: 1, isActive: 1 });

module.exports = mongoose.model('AutomationRule', AutomationRuleSchema);
