const crypto = require('crypto');
const TransactionLog = require('../models/TransactionLog');

function generateTransactionId() {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `TXN-${ts}-${rand}`;
}

async function createTransactionLog({
  schoolId,
  schoolName,
  schoolCode,
  amount,
  type,
  status,
  gateway,
  plan,
  fraudScore = 0,
  gatewayOrderId,
  gatewayPaymentId,
}) {
  const riskLevel = fraudScore > 0.7 ? 'HIGH' : fraudScore > 0.4 ? 'MEDIUM' : 'LOW';

  const amountPaise = Number.isFinite(Number(amount)) ? Math.round(Number(amount) * 100) : 0;
  const transaction = await TransactionLog.create({
    transactionId: generateTransactionId(),
    schoolId,
    schoolName,
    schoolCode,
    amount: amountPaise,
    type: type || 'PAYMENT',
    status: status || 'PENDING',
    gateway: gateway || 'Razorpay',
    plan,
    fraudScore,
    riskLevel,
    gatewayOrderId,
    gatewayPaymentId,
    isReconciled: status === 'PAID',
    reconciledAt: status === 'PAID' ? new Date() : null,
  });

  global.broadcastTransaction?.({
    school: schoolName,
    amount: `INR ${Number(amount || 0).toLocaleString()}`,
    gateway: gateway || 'Razorpay',
    transactionId: transaction.transactionId,
    status,
    risk: riskLevel,
    timestamp: 'just now',
  });

  return transaction;
}

module.exports = { createTransactionLog, generateTransactionId };
