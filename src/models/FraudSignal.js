const { Schema, model } = require('mongoose');

const FraudSignalSchema = new Schema({
  schoolId:       { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
  transactionId:  { type: String, index: true },
  signalType:     {
    type: String,
    enum: [
      'FAILED_PAYMENT_SPIKE',
      'REFUND_SPIKE',
      'RETRY_ABUSE',
      'VELOCITY_ANOMALY',
      'AMOUNT_ANOMALY',
      'GATEWAY_ANOMALY',
    ],
    required: true,
    index: true,
  },
  score:          { type: Number, min: 0, max: 1, default: 0 },
  severity:       { type: String, enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'], default: 'MEDIUM' },
  metadata:       { type: Schema.Types.Mixed },
  resolved:       { type: Boolean, default: false, index: true },
  resolvedAt:     { type: Date },
  createdAt:      { type: Date, default: Date.now, index: true },
}, { timestamps: false });

FraudSignalSchema.index({ schoolId: 1, createdAt: -1 });
FraudSignalSchema.index({ signalType: 1, severity: 1, resolved: 1 });
// TTL: keep 1 year
FraudSignalSchema.index({ createdAt: 1 }, { expireAfterSeconds: 31536000 });

module.exports = model('FraudSignal', FraudSignalSchema);
