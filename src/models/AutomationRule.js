const mongoose = require('mongoose');
const ObjectId = mongoose.Schema.Types.ObjectId;

const AutomationRuleSchema = new mongoose.Schema({
  schoolId: { type: ObjectId, ref: 'School', required: true },
  name: { type: String, required: true },
  isActive: { type: Boolean, default: true },
  trigger: {
    type: String,
    enum: [
      'FEE_DUE',
      'STUDENT_ABSENT',
      'EXAM_DATE_NEAR',
      'RESULT_PUBLISHED',
      'SALARY_DUE',
      'ATTENDANCE_NOT_MARKED'
    ],
    required: true
  },
  condition: {
    field: { type: String },      // e.g. 'daysOverdue'
    operator: { type: String },   // 'gt', 'lt', 'eq'
    value: { type: mongoose.Schema.Types.Mixed }
  },
  action: {
    type: {
      type: String,
      enum: ['SEND_NOTIFICATION', 'SEND_SMS', 'FLAG_RECORD', 'GENERATE_REPORT']
    },
    target: {
      type: String,
      enum: ['PARENT', 'STUDENT', 'TEACHER', 'PRINCIPAL', 'OPERATOR']
    },
    template: { type: String },
    templateVars: [{ type: String }]
  },
  lastRunAt: { type: Date },
  runCount: { type: Number, default: 0 }
}, { timestamps: true });

AutomationRuleSchema.index({ schoolId: 1, trigger: 1, isActive: 1 });

module.exports = mongoose.model('AutomationRule', AutomationRuleSchema);
