const mongoose = require('mongoose');

const { Schema } = mongoose;

const ComplianceAuditSchema = new Schema(
  {
    reportId: { type: String, index: true },
    tenantId: { type: String, index: true },
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', index: true },
    checks: {
      gdpr: { type: Boolean, default: false },
      iso27001: { type: Boolean, default: false },
      soc2: { type: Boolean, default: false },
      piiDetected: { type: Boolean, default: false },
      encrypted: { type: Boolean, default: true },
    },
    notes: { type: String },
    createdAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: false }
);

module.exports = mongoose.model('ComplianceAudit', ComplianceAuditSchema);
