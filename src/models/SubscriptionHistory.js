const mongoose = require('mongoose');

const subscriptionHistorySchema = new mongoose.Schema({
  schoolId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'School',
    required: true,
    index: true
  },
  oldEndDate: {
    type: Date,
    default: null
  },
  newEndDate: {
    type: Date,
    required: true
  },
  durationMonths: {
    type: Number,
    required: true,
    min: 1,
    max: 36
  },
  monthlyPrice: {
    type: Number,
    required: true
  },
  totalAmount: {
    type: Number,
    required: true
  },
  renewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  renewedAt: {
    type: Date,
    default: Date.now
  },
  oldPlan: {
    type: String,
    default: null
  },
  newPlan: {
    type: String,
    default: null
  },
  paymentMethod: {
    type: String,
    default: 'MANUAL'
  },
  notes: {
    type: String,
    default: null
  }
}, {
  timestamps: true
});

// Index for efficient queries
subscriptionHistorySchema.index({ schoolId: 1, renewedAt: -1 });
subscriptionHistorySchema.index({ renewedAt: -1 });

// Helper method to create a renewal record
subscriptionHistorySchema.statics.createRenewalRecord = async function(data, options = {}) {
  const session = options.session || null;
  const record = new this({
    schoolId: data.schoolId,
    oldEndDate: data.oldEndDate,
    newEndDate: data.newEndDate,
    durationMonths: data.durationMonths,
    monthlyPrice: data.monthlyPrice,
    totalAmount: data.totalAmount,
    renewedBy: data.renewedBy,
    renewedAt: data.renewedAt || new Date(),
    oldPlan: data.oldPlan,
    newPlan: data.newPlan,
    paymentMethod: data.paymentMethod || 'MANUAL',
    notes: data.notes
  });
  
  if (session) {
    return await record.save({ session });
  }
  return await record.save();
};

// Helper method to get history for a school
subscriptionHistorySchema.statics.getHistoryBySchool = async function(schoolId, limit = 20) {
  return await this.find({ schoolId })
    .sort({ renewedAt: -1 })
    .limit(limit)
    .lean();
};

// Helper method to get recent renewals across all schools
subscriptionHistorySchema.statics.getRecentRenewals = async function(days = 30, limit = 50) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return await this.find({ renewedAt: { $gte: since } })
    .sort({ renewedAt: -1 })
    .limit(limit)
    .lean();
};

// Helper method to get total revenue from renewals
subscriptionHistorySchema.statics.getTotalRevenueBySchool = async function(schoolId) {
  const result = await this.aggregate([
    { $match: { schoolId: schoolId } },
    {
      $group: {
        _id: null,
        totalRevenue: { $sum: '$totalAmount' },
        totalMonths: { $sum: '$durationMonths' },
        renewalCount: { $sum: 1 }
      }
    }
  ]);
  return result[0] || { totalRevenue: 0, totalMonths: 0, renewalCount: 0 };
};

const SubscriptionHistory = mongoose.model('SubscriptionHistory', subscriptionHistorySchema);

module.exports = SubscriptionHistory;
