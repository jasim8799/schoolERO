// Central model registration file

require('./School');
require('./User');
require('./Student');
require('./Parent');
require('./Teacher');
require('./Subject');
require('./Class');
require('./Section');
require('./AcademicSession');
require('./StudentDailyAttendance');
require('./StudentSubjectAttendance');
require('./TeacherAttendance');
require('./StaffAttendance');
require('./Exam');
require('./ExamForm');
require('./ExamPayment');
require('./AdmitCard');
require('./Result');
require('./FeeStructure');
require('./StudentFee');
require('./FeePayment');
require('./OnlinePayment');
require('./Expense');
require('./SalaryProfile');
require('./SalaryCalculation');
require('./SalaryPayment');
require('./Vehicle');
require('./Route');
require('./StudentTransport');
require('./Hostel');
require('./Room');
require('./StudentHostel');
require('./HostelLeave');
require('./Homework');
require('./TC');
require('./SystemAnnouncement');
require('./AuditLog');
require('./Backup'); // 🔴 THIS IS CRITICAL

// ── New orchestration models ──────────────────────────────────────────────────
require('./WorkflowInstance');
require('./EventLog');
require('./AutomationRule');
require('./StudentFeeAssignment');
require('./NotificationQueue');
require('./Bill');
require('./Payment');
require('./LedgerEntry');
require('./TeacherAssignment');

// Enterprise reporting models
require('./Report');
require('./ReportJob');
require('./ReportSchedule');
require('./ExportHistory');
require('./AIInsight');
require('./QueryLog');
require('./ComplianceAudit');
require('./InfrastructureMetric');
require('./SecurityLog');
require('./LoginSession');
require('./SchoolHealthSnapshot');
require('./SchoolAnalyticsDaily');
require('./NotificationLog');
require('./BackupRecord');
require('./SubscriptionInvoice');
require('./BillingHistory');
require('./FraudAlert');
require('./UsageSnapshot');
require('./RevenueSnapshot');
require('./RenewalReminder');
require('./TransactionLog');
require('./FraudSignal');
require('./RevenueGrowthHistory');
require('./UserActivityLog');
require('./UserThreatProfile');
