const express = require('express');
const cors = require('cors');
const { config } = require('./config/env');
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

// Security middleware
const { authenticate } = require('./middlewares/auth.middleware.fixed');
const { enforceSchoolIsolation, sanitizeResponse, securityHeaders, productionErrorHandler } = require('./middlewares/security.middleware.final');
const { authRateLimit, paymentRateLimit, backupRateLimit, generalRateLimit } = require('./middlewares/rateLimit.middleware.fixed');

const app = express();

// Security headers (applied to all routes)
app.use(securityHeaders);

// CORS configuration
app.use(cors({
  origin: config.cors.origin,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// Body parsing with size limits
app.use(express.json({ limit: '10mb' })); // Limit payload size
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting for sensitive routes
app.use('/api/auth', authRateLimit);
app.use('/api/fees/pay', paymentRateLimit);
app.use('/api/backup', backupRateLimit);
app.use('/api/restore', backupRateLimit);

// General rate limiting for all API routes
app.use('/api', generalRateLimit);

// Response sanitization (remove sensitive data)
app.use(sanitizeResponse);

// Health check route (no auth required)
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'School ERP Backend is running' });
});

// API Routes (all protected by authentication and school isolation)
app.use('/api/schools', authenticate, enforceSchoolIsolation, schoolRoutes);
app.use('/api/sessions', authenticate, enforceSchoolIsolation, sessionRoutes);
app.use('/api/auth', authRoutes); // Auth routes don't need auth middleware
app.use('/api/users', authenticate, enforceSchoolIsolation, userRoutes);
app.use('/api/classes', authenticate, enforceSchoolIsolation, classRoutes);
app.use('/api/sections', authenticate, enforceSchoolIsolation, sectionRoutes);
app.use('/api/subjects', authenticate, enforceSchoolIsolation, subjectRoutes);
app.use('/api/teachers', authenticate, enforceSchoolIsolation, teacherRoutes);
app.use('/api/parents', authenticate, enforceSchoolIsolation, parentRoutes);
app.use('/api/attendance', authenticate, enforceSchoolIsolation, attendanceRoutes);
app.use('/api/students', authenticate, enforceSchoolIsolation, studentRoutes);
app.use('/api/exams', authenticate, enforceSchoolIsolation, examRoutes);
app.use('/api/fees', authenticate, enforceSchoolIsolation, feeStructureRoutes);
app.use('/api/fees', authenticate, enforceSchoolIsolation, studentFeeRoutes);
app.use('/api/fees', authenticate, enforceSchoolIsolation, feePaymentRoutes);
app.use('/api/expenses', authenticate, enforceSchoolIsolation, expenseRoutes);
app.use('/api/salary', authenticate, enforceSchoolIsolation, salaryRoutes);
app.use('/api/reports', authenticate, enforceSchoolIsolation, reportsRoutes);
app.use('/api/dashboard', authenticate, enforceSchoolIsolation, dashboardRoutes);

// Production error handler (must be last)
if (config.nodeEnv === 'production') {
  app.use(productionErrorHandler);
}

module.exports = app;
