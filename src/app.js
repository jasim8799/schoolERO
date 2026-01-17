const express = require('express');
const cors = require('cors');
const { config } = require('./config/env');
const { authenticate } = require('./middlewares/auth.middleware.js');
const { attachSchoolId } = require('./middlewares/school.middleware.js');
const { checkSubscriptionStatus } = require('./middlewares/subscription.middleware');
const { checkModuleAccess } = require('./middlewares/moduleAccess.middleware');
const { checkMaintenanceMode } = require('./middlewares/maintenance.middleware');
const { attachActiveSession } = require('./middlewares/session.middleware.js');
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
const feeStructureRoutes = require('./routes/feeStructure.routes');
const studentFeeRoutes = require('./routes/studentFee.routes');
const feePaymentRoutes = require('./routes/feePayment.routes');
const expenseRoutes = require('./routes/expense.routes');
const salaryRoutes = require('./routes/salary.routes');
const reportsRoutes = require('./routes/reports.routes');
const dashboardRoutes = require('./routes/dashboard.routes');
const systemRoutes = require('./routes/system.routes');
const auditRoutes = require('./routes/audit.routes');
const versionRoutes = require('./routes/version.routes');

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
app.use('/api/auth', authRoutes);

// Admin routes (SUPER_ADMIN only, no tenant middlewares)
app.use('/api/admin', adminRoutes);
app.use('/api/system', systemRoutes);

// Apply maintenance mode check to all API routes (except auth for SUPER_ADMIN login)
app.use('/api', checkMaintenanceMode);

// Audit routes (require authentication and role checking)
app.use('/api/audit', auditRoutes);

// Apply authentication, school attachment, subscription and module access checks to tenant routes
app.use('/api/schools', authenticate, attachSchoolId, checkSubscriptionStatus(), checkModuleAccess('schools'), schoolRoutes);
app.use('/api/users', authenticate, attachSchoolId, checkSubscriptionStatus(), checkModuleAccess('users'), userRoutes);
app.use('/api/classes', authenticate, attachSchoolId, attachActiveSession, checkSubscriptionStatus(), checkModuleAccess('classes'), classRoutes);
app.use('/api/sections', authenticate, attachSchoolId, attachActiveSession, checkSubscriptionStatus(), checkModuleAccess('sections'), sectionRoutes);
app.use('/api/subjects', authenticate, attachSchoolId, attachActiveSession, checkSubscriptionStatus(), checkModuleAccess('subjects'), subjectRoutes);
app.use('/api/teachers', authenticate, attachSchoolId, attachActiveSession, checkSubscriptionStatus(), checkModuleAccess('teachers'), teacherRoutes);
app.use('/api/parents', authenticate, attachSchoolId, checkSubscriptionStatus(), checkModuleAccess('parents'), parentRoutes);
app.use('/api/attendance', authenticate, attachSchoolId, attachActiveSession, checkSubscriptionStatus(), checkModuleAccess('attendance'), attendanceRoutes);
app.use('/api/students', authenticate, attachSchoolId, attachActiveSession, checkSubscriptionStatus(), checkModuleAccess('students'), studentRoutes);
app.use('/api/exams', authenticate, attachSchoolId, attachActiveSession, checkSubscriptionStatus(), checkModuleAccess('exams'), examRoutes);
app.use('/api/fees', authenticate, attachSchoolId, checkSubscriptionStatus(), checkModuleAccess('fees'), feeStructureRoutes);
app.use('/api/fees', authenticate, attachSchoolId, checkSubscriptionStatus(), checkModuleAccess('fees'), studentFeeRoutes);
app.use('/api/fees', authenticate, attachSchoolId, checkSubscriptionStatus(), checkModuleAccess('fees'), feePaymentRoutes);
app.use('/api/expenses', authenticate, attachSchoolId, checkSubscriptionStatus(), checkModuleAccess('expenses'), expenseRoutes);
app.use('/api/salary', authenticate, attachSchoolId, checkSubscriptionStatus(), checkModuleAccess('salary'), salaryRoutes);
app.use('/api/reports', authenticate, attachSchoolId, checkSubscriptionStatus(), checkModuleAccess('reports'), reportsRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/version', versionRoutes);

module.exports = app;
