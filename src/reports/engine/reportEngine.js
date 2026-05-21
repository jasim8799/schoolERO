const Report = require('../../models/Report');
const ReportJob = require('../../models/ReportJob');
const { reportQueue } = require('../queues/reportQueue');
const { complianceEngine } = require('../compliance/complianceEngine');

function generateReportId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const random = Array.from({ length: 6 })
    .map(() => chars[Math.floor(Math.random() * chars.length)])
    .join('');
  return `REP-${random}`;
}

async function createReport({
  category,
  reportName,
  exportType = 'PDF',
  schoolId,
  tenantId,
  department,
  mode = 'Manual',
  filters = {},
  generatedBy,
  generatedById,
  scheduleId,
  priority = 3,
}) {
  const reportId = generateReportId();
  const expiresAt = new Date(Date.now() + 90 * 86400000);

  const compliance = await complianceEngine.check({ category, schoolId, exportType });

  const report = await Report.create({
    reportId,
    tenantId: tenantId || schoolId?.toString(),
    schoolId,
    reportName: reportName || `${category} - ${new Date().toLocaleDateString('en-IN')}`,
    category,
    department,
    mode,
    exportType,
    status: 'QUEUED',
    progress: 0,
    compliance,
    filters,
    generatedBy,
    generatedById,
    scheduleId,
    tags: [String(category || '').toLowerCase().replace(/\s+/g, '_')],
    expiresAt,
  });

  const jobId = `job_${reportId}_${Date.now()}`;

  await ReportJob.create({
    jobId,
    reportId,
    tenantId,
    queueStatus: 'waiting',
    logs: [{ level: 'INFO', message: `Report ${reportId} queued` }],
  });

  await reportQueue.add(
    'generate_report',
    {
      reportId,
      jobId,
      category,
      exportType,
      schoolId: schoolId?.toString(),
      tenantId,
      filters,
      generatedById: generatedById?.toString(),
    },
    {
      priority,
      attempts: 3,
      backoff: { type: 'exponential', delay: 3000 },
      jobId,
    }
  );

  return report;
}

module.exports = { createReport, generateReportId };
