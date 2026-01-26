const express = require('express');
const cors = require('cors');
const { config } = require('./config/env');
const { authenticate } = require('./middlewares/auth.middleware.js');
const { attachSchoolId } = require('./middlewares/school.middleware.js');
const { checkSubscriptionStatus } = require('./middlewares/subscription.middleware');
const { checkModuleAccess } = require('./middlewares/moduleAccess.middleware');
const { checkMaintenanceMode } = require('./middlewares/maintenance.middleware');
const { attachActiveSession } = require('./middlewares/session.middleware.js');
const { productionErrorHandler } = require('./middlewares/security.middleware.js');
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
const examFormRoutes = require('./routes/examForm.routes');
const examPaymentRoutes = require('./routes/examPayment.routes');
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
const backupRoutes = require('./routes/backup.routes');

const app = express();

// Middlewares
app.use(cors({
  origin: config.cors.origin,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check route
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'School ERP Backend is running' });
});

// API Routes
app.use('/api/sessions', sessionRoutes);
app.use('/api/auth', authRateLimit, authRoutes);

// Admin routes (SUPER_ADMIN only, no tenant middlewares)
app.use('/api/admin', adminRoutes);
app.use('/api/system', systemRoutes);
app.use('/api/version', versionRoutes);

// Global middleware for tenant routes: authenticate -> checkMaintenanceMode
app.use('/api', authenticate, checkMaintenanceMode);

// Backup routes (authenticated)
app.use('/api/backup', backupRoutes);

// Audit routes (require authentication and role checking)
app.use('/api/audit', auditRoutes);

// Apply authentication, school attachment, subscription and module access checks to tenant routes
app.use('/api/schools', attachSchoolId, checkSubscriptionStatus(), checkModuleAccess('schools'), schoolRoutes);
app.use('/api/users', attachSchoolId, checkSubscriptionStatus(), checkModuleAccess('users'), userRoutes);
app.use('/api/classes', attachSchoolId, attachActiveSession, checkSubscriptionStatus(), checkModuleAccess('classes'), classRoutes);
app.use('/api/sections', attachSchoolId, attachActiveSession, checkSubscriptionStatus(), checkModuleAccess('sections'), sectionRoutes);
app.use('/api/subjects', attachSchoolId, attachActiveSession, checkSubscriptionStatus(), checkModuleAccess('subjects'), subjectRoutes);
app.use('/api/teachers', attachSchoolId, attachActiveSession, checkSubscriptionStatus(), checkModuleAccess('teachers'), teacherRoutes);
app.use('/api/parents', attachSchoolId, checkSubscriptionStatus(), checkModuleAccess('parents'), parentRoutes);
app.use('/api/attendance', attachSchoolId, attachActiveSession, checkSubscriptionStatus(), checkModuleAccess('attendance'), attendanceRoutes);
app.use('/api/students', attachSchoolId, attachActiveSession, checkSubscriptionStatus(), checkModuleAccess('students'), studentRoutes);
app.use('/api/homework', attachSchoolId, attachActiveSession, checkSubscriptionStatus(), checkModuleAccess('homework'), homeworkRoutes);
app.use('/api/exams', attachSchoolId, attachActiveSession, checkSubscriptionStatus(), checkModuleAccess('exams'), examRoutes);
app.use('/api/exams', attachSchoolId, attachActiveSession, checkSubscriptionStatus(), checkModuleAccess('exams'), examSubjectRoutes);
app.use('/api/exam-forms', attachSchoolId, attachActiveSession, checkSubscriptionStatus(), checkModuleAccess('exams'), examFormRoutes);
app.use('/api/exam-payments', attachSchoolId, attachActiveSession, checkSubscriptionStatus(), checkModuleAccess('exams'), examPaymentRoutes);
app.use('/api/admit-cards', attachSchoolId, attachActiveSession, checkSubscriptionStatus(), checkModuleAccess('exams'), admitCardRoutes);
app.use('/api/results', attachSchoolId, attachActiveSession, checkSubscriptionStatus(), checkModuleAccess('exams'), resultRoutes);
app.use('/api/promotion', attachSchoolId, attachActiveSession, checkSubscriptionStatus(), checkModuleAccess('students'), promotionRoutes);
app.use('/api/academic-history', attachSchoolId, checkSubscriptionStatus(), checkModuleAccess('students'), academicHistoryRoutes);
app.use(
  '/api/fees',
  paymentRateLimit,
  attachSchoolId,
  checkSubscriptionStatus(true),
  checkModuleAccess('fees'),
  feePaymentRoutes
);

app.use(
  '/api/fees/structure',
  attachSchoolId,
  checkSubscriptionStatus(),
  checkModuleAccess('fees'),
  feeStructureRoutes
);

app.use(
  '/api/fees/student',
  attachSchoolId,
  checkSubscriptionStatus(),
  checkModuleAccess('fees'),
  studentFeeRoutes
);
app.use('/api/expenses', attachSchoolId, checkSubscriptionStatus(), checkModuleAccess('expenses'), expenseRoutes);
app.use('/api/salary', attachSchoolId, checkSubscriptionStatus(), checkModuleAccess('salary'), salaryRoutes);
app.use('/api/reports', attachSchoolId, attachActiveSession, checkSubscriptionStatus(), checkModuleAccess('reports'), reportsRoutes);
app.use('/api/tc', attachSchoolId, attachActiveSession, checkSubscriptionStatus(), checkModuleAccess('tc'), tcRoutes);
app.use('/api/hostels', attachSchoolId, checkSubscriptionStatus(), checkModuleAccess('hostel'), hostelRoutes);
app.use('/api/hostel-leaves', attachSchoolId, checkSubscriptionStatus(), checkModuleAccess('hostel'), hostelLeaveRoutes);
app.use('/api/rooms', attachSchoolId, checkSubscriptionStatus(), checkModuleAccess('hostel'), roomRoutes);
app.use('/api/student-hostel', attachSchoolId, checkSubscriptionStatus(), checkModuleAccess('hostel'), studentHostelRoutes);
app.use('/api/transport', attachSchoolId, checkSubscriptionStatus(), checkModuleAccess('transport'), transportRoutes);
app.use('/api/student-transport', attachSchoolId, checkSubscriptionStatus(), checkModuleAccess('transport'), studentTransportRoutes);
app.use(
  '/api/dashboard',
  generalRateLimit,
  attachSchoolId,
  checkSubscriptionStatus(true), // allow read-only dashboards during grace period
  dashboardRoutes
);

// Production error handler (must be last middleware)
app.use(productionErrorHandler);

module.exports = app;
