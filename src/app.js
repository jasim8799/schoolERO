const express = require('express');
const cors = require('cors');
const { config } = require('./config/env');
const { authenticate } = require('./middlewares/auth.middleware.js');
const { attachSchoolId } = require('./middlewares/school.middleware.js');
const { checkSubscriptionStatus } = require('./middlewares/subscription.middleware');
const { checkModuleAccess } = require('./middlewares/moduleAccess.middleware');
const { checkMaintenanceMode } = require('./middlewares/maintenance.middleware');
const { attachActiveSession } = require('./middlewares/session.middleware.js');
const errorHandler = require('./middlewares/error.middleware');
const { authRateLimit, paymentRateLimit, generalRateLimit } = require('./middlewares/rateLimit.middleware.fixed.js');
const adminRoutes = require('./routes/admin.routes');
const schoolRoutes = require('./routes/school.routes');
const sessionRoutes = require('./routes/session.routes');
const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/user.routes');
const classRoutes = require('./routes/class.routes');
const sectionRoutes = require('./routes/section.routes');
const subjectRoutes = require('./routes/subject.routes');
const teacherRoutes = require('./routes/teacher.routes');
const parentRoutes = require('./routes/parent.routes');
const studentRoutes = require('./routes/student.routes');
const attendanceRoutes = require('./routes/attendance.routes');
const examRoutes = require('./routes/exam.routes');
const examSubjectRoutes = require('./routes/examSubject.routes');
const examQuestionPaperRoutes = require('./routes/examQuestionPaper.routes');
const examFormRoutes = require('./routes/examForm.routes');
const examPaymentRoutes = require('./routes/examPayment.routes');
const seatingArrangementRoutes = require('./routes/seatingArrangement.routes');
const admitCardRoutes = require('./routes/admitCard.routes');
const resultRoutes = require('./routes/result.routes');
const promotionRoutes = require('./routes/promotion.routes');
const academicHistoryRoutes = require('./routes/academicHistory.routes');
const feeStructureRoutes = require('./routes/feeStructure.routes');
const studentFeeRoutes = require('./routes/studentFee.routes');
const feePaymentRoutes = require('./routes/feePayment.routes');
const expenseRoutes = require('./routes/expense.routes');
const salaryRoutes = require('./routes/salary.routes');
const reportsRoutes = require('./routes/reports.routes');
const dashboardRoutes = require('./routes/dashboard.routes');
const analyticsRoutes = require('./routes/analytics.routes');
const activityRoutes = require('./routes/activity.routes');
const securityRoutes = require('./routes/security.routes');
const jobsRoutes = require('./routes/jobs.routes');
const systemRoutes = require('./routes/system.routes');
const auditRoutes = require('./routes/audit.routes');
const homeworkRoutes = require('./routes/homework.routes');
const versionRoutes = require('./routes/version.routes');
const tcRoutes = require('./routes/tc.routes');
const hostelRoutes = require('./routes/hostel.routes');
const hostelLeaveRoutes = require('./routes/hostelLeave.routes');
const roomRoutes = require('./routes/room.routes');
const studentHostelRoutes = require('./routes/studentHostel.routes');
const transportRoutes = require('./routes/transport.routes');
const studentTransportRoutes = require('./routes/studentTransport.routes');
const transportFeeRoutes = require('./routes/transportFee.routes');
const hostelFeeRoutes = require('./routes/hostelFee.routes');
const backupRoutes = require('./routes/backup.routes');
const restoreRoutes = require('./routes/restore.routes');
const { startReportWorker } = require('./reports/workers/reportWorker');
const { startExportWorker } = require('./reports/workers/exportWorker');
const { registerReportSchedulers } = require('./reports/schedulers/reportScheduler');
const { initReportSocket } = require('./reports/sockets/reportSocket');
const { firewallMiddleware }       = require('./firewall/firewall.monitor');
const { registerActivityCronJobs } = require('./cron/activity.cron');
const { auditEnrichMiddleware } = require('./middlewares/auditEnrich.middleware');
const { registerAuditCronJobs } = require('./cron/audit.cron');
const { registerDashboardCronJobs } = require('./cron/dashboard.cron');

// Backup/restore platform imports (optional until module is fully provisioned)
let backupPlatform = {
  startBackupWorker: null,
  startRestoreWorker: null,
  initBackupSocket: null,
  registerBackupSchedulers: null,
};
try {
  backupPlatform = {
    startBackupWorker: require('./backup/workers/backupWorker').startBackupWorker,
    startRestoreWorker: require('./backup/workers/restoreWorker').startRestoreWorker,
    initBackupSocket: require('./backup/sockets/backupSocket').initBackupSocket,
    registerBackupSchedulers: require('./backup/schedulers/backupScheduler').registerBackupSchedulers,
  };
} catch (_) {
  // Keep server boot resilient if backup module files are unavailable.
}
const inventoryRoutes = require('./routes/inventory.routes');
const workflowRoutes = require('./routes/workflow.routes');
const eventRoutes = require('./routes/event.routes');
const automationRoutes = require('./routes/automation.routes');
const lifecycleRoutes = require('./routes/lifecycle.routes');
const feeAssignmentRoutes = require('./routes/feeAssignment.routes');
const notificationRoutes = require('./routes/notification.routes');
const billRoutes = require('./routes/bill.routes');
const feeCollectionRoutes = require('./routes/feeCollection.routes');
const videoRoutes     = require('./routes/video.routes');
const admissionRoutes = require('./routes/admission.routes');
const teacherAssignmentRoutes = require('./routes/teacherAssignment.routes');
const questionRoutes = require('./routes/question.routes');
const ptmRoutes = require('./routes/ptm.routes');
const noticeRoutes = require('./routes/notice.routes');
const leaveRoutes = require('./routes/leave.routes');
const subscriptionRoutes = require('./routes/subscription.routes');
const revenueRoutes = require('./revenue/revenue.routes');
const debugRoutes = require('./routes/debug.routes');

const app = express();
let io;
const path = require('path');

// Middlewares
app.use(cors({
  origin: config.cors.origin,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

// Serve uploaded files (bill attachments, etc.)
app.use('/uploads', express.static(path.join(__dirname, '../uploads'), {
  maxAge: '1d',         // cache for 1 day
  fallthrough: false,   // return 404 for missing files instead of HTML error page
}));

// Health check route
//test
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'School ERP Backend is running' });
});

// API Routes
// Apply firewall middleware to all API routes
app.use('/api', firewallMiddleware());
app.use('/api', auditEnrichMiddleware());

app.use('/api/sessions', sessionRoutes);
app.use('/api/auth', authRateLimit, authRoutes);
app.use('/api/debug', debugRoutes);

// Admin routes (SUPER_ADMIN only, no tenant middlewares)
app.use('/api/admin', adminRoutes);
app.use('/api/revenue', revenueRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/system', systemRoutes);
app.use('/api/version', versionRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/activity', activityRoutes);
app.use('/api/security', securityRoutes);
app.use('/api/jobs', jobsRoutes);

// Global middleware for tenant routes: authenticate -> checkMaintenanceMode
app.use('/api', authenticate, checkMaintenanceMode);


// Backup & Restore routes (authenticated)
app.use('/api/backup', backupRoutes);
app.use('/api/restore', restoreRoutes);

// Inventory routes (authenticated, Principal only)
app.use('/api/inventory', attachSchoolId, inventoryRoutes);

// Audit routes (require authentication and role checking)
app.use('/api/audit', auditRoutes);

// Apply authentication, school attachment, subscription and module access checks to tenant routes
app.use('/api/schools', attachSchoolId, checkSubscriptionStatus(), checkModuleAccess('schools'), schoolRoutes);
app.use('/api/users', attachSchoolId, checkSubscriptionStatus(), checkModuleAccess('users'), userRoutes);
app.use('/api/classes', attachSchoolId, attachActiveSession, checkSubscriptionStatus(), checkModuleAccess('classes'), classRoutes);
app.use('/api/sections', attachSchoolId, attachActiveSession, checkSubscriptionStatus(), checkModuleAccess('sections'), sectionRoutes);
app.use('/api/subjects', attachSchoolId, attachActiveSession, checkSubscriptionStatus(), checkModuleAccess('subjects'), subjectRoutes);
app.use('/api/teachers', attachSchoolId, checkSubscriptionStatus(), checkModuleAccess('teachers'), teacherRoutes);
app.use('/api/teacher-assignments', attachSchoolId, attachActiveSession, checkSubscriptionStatus(), checkModuleAccess('teachers'), teacherAssignmentRoutes);
app.use('/api/parents', attachSchoolId, checkSubscriptionStatus(), checkModuleAccess('parents'), parentRoutes);
app.use('/api/attendance', attachSchoolId, attachActiveSession, checkSubscriptionStatus(), checkModuleAccess('attendance'), attendanceRoutes);
app.use('/api/students', attachSchoolId, attachActiveSession, checkSubscriptionStatus(), checkModuleAccess('students'), studentRoutes);
app.use('/api/homework', attachSchoolId, attachActiveSession, checkSubscriptionStatus(), checkModuleAccess('homework'), homeworkRoutes);
app.use('/api/exams', attachSchoolId, attachActiveSession, checkSubscriptionStatus(), checkModuleAccess('exams'), examRoutes);
app.use('/api/exams', attachSchoolId, attachActiveSession, checkSubscriptionStatus(), checkModuleAccess('exams'), examSubjectRoutes);
app.use('/api/exam-question-papers', attachSchoolId, attachActiveSession, checkSubscriptionStatus(), checkModuleAccess('exams'), examQuestionPaperRoutes);
app.use('/api/exam-forms', attachSchoolId, attachActiveSession, checkSubscriptionStatus(), checkModuleAccess('exams'), examFormRoutes);
app.use('/api/exam-payments', attachSchoolId, attachActiveSession, checkSubscriptionStatus(), checkModuleAccess('exams'), examPaymentRoutes);
app.use('/api/seating-arrangements', attachSchoolId, attachActiveSession, checkSubscriptionStatus(), checkModuleAccess('exams'), seatingArrangementRoutes);
app.use('/api/admit-cards', attachSchoolId, attachActiveSession, checkSubscriptionStatus(), checkModuleAccess('exams'), admitCardRoutes);
app.use('/api/results', attachSchoolId, attachActiveSession, checkSubscriptionStatus(), checkModuleAccess('exams'), resultRoutes);
app.use('/api/promotion', attachSchoolId, attachActiveSession, checkSubscriptionStatus(), checkModuleAccess('students'), promotionRoutes);
app.use('/api/academic-history', attachSchoolId, checkSubscriptionStatus(), checkModuleAccess('students'), academicHistoryRoutes);
app.use(
  '/api/fees',
  paymentRateLimit,
  attachSchoolId,
  attachActiveSession,
  checkSubscriptionStatus(true),
  checkModuleAccess('fees'),
  feePaymentRoutes
);

app.use(
  '/api/fees/structure',
  attachSchoolId,
  attachActiveSession,
  checkSubscriptionStatus(),
  checkModuleAccess('fees'),
  feeStructureRoutes
);

app.use(
  '/api/fees/student',
  attachSchoolId,
  attachActiveSession,
  checkSubscriptionStatus(),
  checkModuleAccess('fees'),
  studentFeeRoutes
);
app.use('/api/expenses', attachSchoolId, checkSubscriptionStatus(), checkModuleAccess('expenses'), expenseRoutes);
app.use('/api/salary', attachSchoolId, attachActiveSession, checkSubscriptionStatus(), checkModuleAccess('salary'), salaryRoutes);
app.use('/api/reports', attachSchoolId, attachActiveSession, checkSubscriptionStatus(), checkModuleAccess('reports'), reportsRoutes);
app.use('/api/tc', attachSchoolId, attachActiveSession, checkSubscriptionStatus(), checkModuleAccess('tc'), tcRoutes);
app.use('/api/hostels', attachSchoolId, checkSubscriptionStatus(), checkModuleAccess('hostel'), hostelRoutes);
app.use('/api/hostel-leaves', attachSchoolId, checkSubscriptionStatus(), checkModuleAccess('hostel'), hostelLeaveRoutes);
app.use('/api/rooms', attachSchoolId, checkSubscriptionStatus(), checkModuleAccess('hostel'), roomRoutes);
app.use('/api/student-hostel', attachSchoolId, checkSubscriptionStatus(), checkModuleAccess('hostel'), studentHostelRoutes);
app.use('/api/hostel-fees', attachSchoolId, attachActiveSession, checkSubscriptionStatus(), checkModuleAccess('hostel'), hostelFeeRoutes);
app.use('/api/transport', attachSchoolId, checkSubscriptionStatus(), checkModuleAccess('transport'), transportRoutes);
app.use('/api/student-transport', attachSchoolId, checkSubscriptionStatus(), checkModuleAccess('transport'), studentTransportRoutes);
app.use('/api/transport-fees', attachSchoolId, attachActiveSession, checkSubscriptionStatus(), checkModuleAccess('transport'), transportFeeRoutes);
app.use(
  '/api/dashboard',
  generalRateLimit,
  (req, res, next) => {
    // SUPER_ADMIN skips school attachment and subscription check
    if (req.user && req.user.role === 'SUPER_ADMIN') return next();
    return attachSchoolId(req, res, next);
  },
  (req, res, next) => {
    if (req.user && req.user.role === 'SUPER_ADMIN') return next();
    return attachActiveSession(req, res, next);
  },
  (req, res, next) => {
    if (req.user && req.user.role === 'SUPER_ADMIN') return next();
    return checkSubscriptionStatus(true)(req, res, next);
  },
  dashboardRoutes
);

// ── Orchestration & automation routes ────────────────────────────────────────
app.use('/api/workflow', attachSchoolId, workflowRoutes);
app.use('/api/events', attachSchoolId, eventRoutes);
app.use('/api/automations', attachSchoolId, automationRoutes);
app.use('/api/lifecycle', attachSchoolId, lifecycleRoutes);
app.use('/api/fee-assignments', attachSchoolId, attachActiveSession, feeAssignmentRoutes);
app.use('/api/notifications', attachSchoolId, notificationRoutes);
app.use('/api/bills', attachSchoolId, attachActiveSession, checkSubscriptionStatus(), checkModuleAccess('fees'), billRoutes);
app.use(
  '/api/fee-collection',
  paymentRateLimit,
  attachSchoolId,
  attachActiveSession,
  checkSubscriptionStatus(),
  checkModuleAccess('fees'),
  feeCollectionRoutes
);
app.use('/api/videos', attachSchoolId, checkSubscriptionStatus(), checkModuleAccess('videos'), videoRoutes);
app.use('/api/admissions', attachSchoolId, attachActiveSession, checkSubscriptionStatus(), checkModuleAccess('students'), admissionRoutes);
app.use('/api/questions', attachSchoolId, attachActiveSession, checkSubscriptionStatus(), questionRoutes);
app.use('/api/ptm', attachSchoolId, attachActiveSession, checkSubscriptionStatus(), ptmRoutes);
app.use('/api/notices', attachSchoolId, checkSubscriptionStatus(), noticeRoutes);
app.use('/api/leave', attachSchoolId, attachActiveSession, checkSubscriptionStatus(), leaveRoutes);


// --- Backup/Restore Platform Bootstrap ---
// Only run once per process (not in test)
if (process.env.NODE_ENV !== 'test') {
  // Start BullMQ workers
  backupPlatform.startBackupWorker && backupPlatform.startBackupWorker();
  backupPlatform.startRestoreWorker && backupPlatform.startRestoreWorker();

  // Enterprise report workers
  startReportWorker();
  startExportWorker();

  // Register backup schedulers
  backupPlatform.registerBackupSchedulers && backupPlatform.registerBackupSchedulers();

  // Register enterprise report schedulers
  registerReportSchedulers().catch(() => {});
}

// Socket.IO integration (if server is created here)
// To be initialized in server.js if needed

// Register SIEM/activity cron jobs (runs after io is available)
if (process.env.NODE_ENV !== 'test') {
  setImmediate(() => registerActivityCronJobs());
  setImmediate(() => registerAuditCronJobs());
  setImmediate(() => registerDashboardCronJobs());
}

// Catch-all: return JSON 404 for any unmatched route (must be before error handler)
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Cannot ${req.method} ${req.originalUrl}` });
});

// Global error handler (must be last middleware)
app.use(errorHandler);

module.exports = app;
module.exports.initBackupSocket = (server) => {
  const { Server } = require('socket.io');
  const { initDashboardSocket } = require('./websocket/dashboard.socket');
  const { initSchoolSocket } = require('./socket/school.socket');
  const { initAlertSocket, broadcastSecurityAlert } = require('./socket/alert.socket');
  const { initSubscriptionSocket } = require('./websocket/subscription.socket');
  const { initRevenueSocket } = require('./websocket/revenue.socket');
  const { initUsersSocket } = require('./websocket/users.socket');
  io = new Server(server, { cors: { origin: '*' } });
  global.io = io;
  global.broadcastSecurityAlert = broadcastSecurityAlert;
  backupPlatform.initBackupSocket && backupPlatform.initBackupSocket(io);
  initReportSocket(io);
  initDashboardSocket(io);
  initSchoolSocket(io);
  initAlertSocket(io);
  initSubscriptionSocket(io);
  initRevenueSocket(io);
  initUsersSocket(io);
  const { initActivitySocket } = require('./websocket/activity.socket');
  const { initAuditSocket } = require('./websocket/audit.socket');
  initActivitySocket(io);
  initAuditSocket(io);
  return io;
};
