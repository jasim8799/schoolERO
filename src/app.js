const express = require('express');
const cors = require('cors');
const { config } = require('./config/env');
const { checkSubscriptionStatus } = require('./middlewares/subscription.middleware');
const { checkMaintenanceMode } = require('./middlewares/maintenance.middleware');
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
app.use('/api/schools', schoolRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/auth', authRoutes);

// Apply maintenance mode check to all API routes (except auth for SUPER_ADMIN login)
app.use('/api', checkMaintenanceMode);

// Apply subscription check to all other API routes (except auth and school management)
app.use('/api', checkSubscriptionStatus());

// Continue with other routes
app.use('/api/users', userRoutes);
app.use('/api/classes', classRoutes);
app.use('/api/sections', sectionRoutes);
app.use('/api/subjects', subjectRoutes);
app.use('/api/teachers', teacherRoutes);
app.use('/api/parents', parentRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/exams', examRoutes);
app.use('/api/fees', feeStructureRoutes);
app.use('/api/fees', studentFeeRoutes);
app.use('/api/fees', feePaymentRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/salary', salaryRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/version', versionRoutes);

module.exports = app;
