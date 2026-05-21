const { Schema, model } = require('mongoose');

const TransactionLogSchema = new Schema({
  transactionId:    { type: String, required: true, unique: true, index: true },
  schoolId:         { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
  schoolName:       { type: String },
  schoolCode:       { type: String },

  amount:           { type: Number, required: true }, // INR paise
  currency:         { type: String, default: 'INR' },
  type:             {
    type: String,
    enum: ['PAYMENT', 'RENEWAL', 'REFUND', 'PARTIAL', 'RETRY'],
    default: 'PAYMENT',
  },
  status:           {
    type: String,
    enum: ['PAID', 'PENDING', 'FAILED', 'REFUNDED'],
    default: 'PENDING',
    index: true,
  },

  gateway:          {
    type: String,
    enum: ['Razorpay', 'Stripe', 'UPI', 'Bank', 'Manual'],
    default: 'Razorpay',
  },
  gatewayOrderId:   { type: String },
  gatewayPaymentId: { type: String },

  plan:             { type: String },
  fraudScore:       { type: Number, min: 0, max: 1, default: 0 },
  riskLevel:        { type: String, enum: ['LOW', 'MEDIUM', 'HIGH'], default: 'LOW' },

  retryCount:       { type: Number, default: 0 },
  reconciledAt:     { type: Date },
  isReconciled:     { type: Boolean, default: false },

  createdAt:        { type: Date, default: Date.now, index: true },
}, { timestamps: false });

TransactionLogSchema.index({ schoolId: 1, createdAt: -1 });
TransactionLogSchema.index({ status: 1, gateway: 1 });
TransactionLogSchema.index({ createdAt: -1 });
// TTL: keep 2 years
TransactionLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 63072000 });

module.exports = model('TransactionLog', TransactionLogSchema);
