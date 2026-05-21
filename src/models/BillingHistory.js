const { Schema, model } = require('mongoose');

const BillingHistorySchema = new Schema({
  schoolId:       { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
  invoiceNumber:  { type: String, unique: true, sparse: true },
  billingType:    { type: String, enum: ['RENEWAL','UPGRADE','DOWNGRADE','TRIAL_CONVERT','MANUAL'], default: 'RENEWAL' },
  plan:           { type: String, enum: ['BASIC','STANDARD','PREMIUM','ENTERPRISE'] },
  previousPlan:   { type: String },
  amount:         { type: Number, required: true },    // in INR paise (e.g. 900000 = INR 9000)
  tax:            { type: Number, default: 0 },        // GST in paise
  discount:       { type: Number, default: 0 },
  netAmount:      { type: Number },                    // amount + tax - discount
  currency:       { type: String, default: 'INR' },
  status:         { type: String, enum: ['PENDING','PAID','FAILED','REFUNDED','PARTIAL'], default: 'PENDING' },
  paymentMethod:  { type: String, enum: ['RAZORPAY','STRIPE','UPI','BANK_TRANSFER','MANUAL','WAIVED'] },
  gatewayOrderId:   { type: String },
  gatewayPaymentId: { type: String },
  durationMonths: { type: Number, default: 12 },
  billingPeriodStart: { type: Date },
  billingPeriodEnd:   { type: Date },
  dueDate:        { type: Date },
  paidAt:         { type: Date },
  retryCount:     { type: Number, default: 0 },
  nextRetryAt:    { type: Date },
  notes:          { type: String },
  createdBy:      { type: Schema.Types.ObjectId, ref: 'User' },
  isDeleted:      { type: Boolean, default: false },
}, { timestamps: true });

BillingHistorySchema.index({ schoolId: 1, createdAt: -1 });
BillingHistorySchema.index({ status: 1, dueDate: 1 });
BillingHistorySchema.index({ invoiceNumber: 1 }, { unique: true, sparse: true });

module.exports = model('BillingHistory', BillingHistorySchema);
