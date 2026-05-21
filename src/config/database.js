const mongoose = require('mongoose');

async function createIndexes() {
  await mongoose.model('School').collection.createIndexes([
    { key: { isDeleted: 1, status: 1, 'subscription.endDate': 1 } },
    { key: { plan: 1, healthScore: -1 } },
    { key: { riskLevel: 1 } },
    { key: { 'analytics.lastAnalyticsSync': -1 } }
  ]);

  await mongoose.model('User').collection.createIndexes([
    { key: { schoolId: 1, role: 1, status: 1 } },
    { key: { schoolId: 1, lastLogin: -1 } }
  ]);

  await mongoose.model('AuditLog').collection.createIndexes([
    { key: { schoolId: 1, createdAt: -1 } },
    { key: { userId: 1, createdAt: -1 } },
    { key: { action: 1, createdAt: -1 } },
    { key: { entityType: 1, entityId: 1 } }
  ]);

  await mongoose.model('SecurityLog').collection.createIndexes([
    { key: { schoolId: 1, eventType: 1, createdAt: -1 } },
    { key: { ipAddress: 1, createdAt: -1 } },
    { key: { severity: 1, resolved: 1 } }
  ]);

  await mongoose.model('StudentDailyAttendance').collection.createIndexes([
    { key: { schoolId: 1, date: 1 } },
    { key: { studentId: 1, date: 1 } }
  ]);

  await mongoose.model('FeePayment').collection.createIndexes([
    { key: { schoolId: 1, paymentDate: -1 } },
    { key: { studentId: 1, paymentDate: -1 } }
  ]);

  console.log('[Database] Enterprise indexes created');
}

module.exports = { createIndexes };
