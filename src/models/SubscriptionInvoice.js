const mongoose = require('mongoose');

const SubscriptionInvoiceSchema = new mongoose.Schema({
  schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true, index: true },
  invoiceNo: { type: String, required: true, unique: true },
  plan: { type: String, required: true },
  periodStart: { type: Date, required: true },
  periodEnd: { type: Date, required: true },
  amount: { type: Number, required: true },
  taxAmount: { type: Number, default: 0 },
  totalAmount: { type: Number, required: true },
  currency: { type: String, default: 'INR' },
  status: { type: String, enum: ['DRAFT', 'ISSUED', 'PAID', 'OVERDUE', 'CANCELLED'], default: 'ISSUED', index: true },
  paidAt: { type: Date },
  notes: { type: String }
}, { timestamps: true });

SubscriptionInvoiceSchema.index({ schoolId: 1, createdAt: -1 });

module.exports = mongoose.model('SubscriptionInvoice', SubscriptionInvoiceSchema);
