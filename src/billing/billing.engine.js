const BillingHistory = require('../models/BillingHistory');
const School = require('../models/School');
const crypto = require('crypto');

// Plan pricing in INR paise (1 INR = 100 paise)
const PLAN_PRICING = {
  BASIC:      { monthly: 900000,  yearly: 9720000  },  // INR 9,000/month
  STANDARD:   { monthly: 1800000, yearly: 19440000 },  // INR 18,000/month
  PREMIUM:    { monthly: 3200000, yearly: 34560000 },  // INR 32,000/month
  ENTERPRISE: { monthly: 5800000, yearly: 62640000 },  // INR 58,000/month
};

const GST_RATE = 0.18; // 18% GST

function generateInvoiceNumber() {
  const year  = new Date().getFullYear();
  const month = String(new Date().getMonth() + 1).padStart(2, '0');
  const rand  = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `INV-${year}${month}-${rand}`;
}

/**
 * Create a billing record when a subscription is renewed / plan changed.
 */
async function createBillingRecord({
  schoolId,
  plan,
  durationMonths,
  createdBy,
  paymentMethod = 'MANUAL',
  billingType = 'RENEWAL',
  previousPlan,
}) {
  const school = await School.findById(schoolId).lean();
  if (!school) throw new Error('School not found');

  const baseAmount = PLAN_PRICING[plan]?.monthly || PLAN_PRICING.BASIC.monthly;
  const amount     = baseAmount * durationMonths;
  const tax        = Math.round(amount * GST_RATE);
  const netAmount  = amount + tax;

  const now              = new Date();
  const billingPeriodEnd = new Date(school.subscription?.endDate || now);

  const billing = await BillingHistory.create({
    schoolId,
    invoiceNumber: generateInvoiceNumber(),
    billingType,
    plan,
    previousPlan,
    amount,
    tax,
    netAmount,
    currency: 'INR',
    status: 'PAID',
    paymentMethod,
    durationMonths,
    billingPeriodStart: now,
    billingPeriodEnd,
    dueDate: now,
    paidAt:  now,
    createdBy,
  });

  return billing;
}

/**
 * Schedule a retry for a failed payment (exponential back-off: 6h, 24h, 72h).
 */
async function retryFailedPayment(billingId) {
  const billing = await BillingHistory.findById(billingId);
  if (!billing || billing.status !== 'FAILED') {
    throw new Error('Billing record not found or not in FAILED state');
  }
  if (billing.retryCount >= 3) {
    throw new Error('Maximum retry attempts (3) exceeded');
  }

  const nextRetryHours = [6, 24, 72][billing.retryCount];
  const nextRetryAt    = new Date(Date.now() + nextRetryHours * 3600000);

  await BillingHistory.findByIdAndUpdate(billingId, {
    retryCount:  billing.retryCount + 1,
    nextRetryAt,
    status: 'PENDING',
  });

  console.log(`[BillingEngine] Retry scheduled for billing ${billingId} at ${nextRetryAt}`);
  return { billingId, retryCount: billing.retryCount + 1, nextRetryAt };
}

/**
 * Calculate billing health score (0.0 to 1.0).
 */
function calculateBillingHealth(school, daysLeft, failedPaymentCount = 0) {
  let health = 1.0;
  if      (daysLeft < 0)  health -= 0.6;
  else if (daysLeft < 7)  health -= 0.35;
  else if (daysLeft < 14) health -= 0.2;
  else if (daysLeft < 30) health -= 0.1;
  if (school.status !== 'active') health -= 0.3;
  if      (failedPaymentCount > 2) health -= 0.25;
  else if (failedPaymentCount > 0) health -= 0.1;
  return Math.max(0, Math.min(1, parseFloat(health.toFixed(2))));
}

module.exports = { createBillingRecord, retryFailedPayment, calculateBillingHealth, PLAN_PRICING };
