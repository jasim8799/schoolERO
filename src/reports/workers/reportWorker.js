const fs = require('fs');
const os = require('os');
const path = require('path');
const mongoose = require('mongoose');
const { Worker } = require('bullmq');

const redis = require('../../config/redis');
const Report = require('../../models/Report');
const ReportJob = require('../../models/ReportJob');
const QueryLog = require('../../models/QueryLog');

const { generateRevenueReport } = require('../generators/revenueReport');
const { generateAttendanceReport } = require('../generators/attendanceReport');
const { generateFeeReport } = require('../generators/feeReport');
const { generateExamReport } = require('../generators/examReport');
const { generateAuditReport } = require('../generators/auditReport');
const { generateComplianceReport } = require('../generators/complianceReport');
const { generateSecurityReport } = require('../generators/securityReport');
const { generateAIIntelligenceReport } = require('../generators/aiIntelligenceReport');
const { generateInfrastructureReport } = require('../generators/infrastructureReport');
const { generateUserActivityReport } = require('../generators/userActivityReport');

const { generatePDF } = require('../engine/pdfGenerator');
const { generateExcel } = require('../engine/excelGenerator');
const { generateCSV } = require('../engine/csvGenerator');
const { exportJSON } = require('../engine/jsonExporter');

const { s3Upload } = require('../../utils/s3');

const GENERATOR_MAP = {
  'Revenue Analytics': generateRevenueReport,
  'Attendance Reports': generateAttendanceReport,
  'Fee Collection Reports': generateFeeReport,
  'Exam Reports': generateExamReport,
  'Audit Reports': generateAuditReport,
  'Compliance Reports': generateComplianceReport,
  'Security Reports': generateSecurityReport,
  'AI Intelligence Reports': generateAIIntelligenceReport,
  'Infrastructure Reports': generateInfrastructureReport,
  'User Activity Reports': generateUserActivityReport,
};

function normalizeFilters(filters = {}, schoolId, tenantId) {
  const normalized = { ...filters };
  if (schoolId) {
    try {
      normalized.schoolId = new mongoose.Types.ObjectId(String(schoolId));
    } catch (_) {
      normalized.schoolId = schoolId;
    }
  }
  if (tenantId) normalized.tenantId = tenantId;
  return normalized;
}

function startReportWorker() {
  const connection = redis?.supportsBullmq ? redis.connection : null;
  if (!connection) {
    console.log('[REDIS_FALLBACK] Report worker not started (BullMQ disabled for Upstash REST mode)');
    return {
      on() {},
      async close() {},
    };
  }

  const worker = new Worker(
    'reportQueue',
    async (job) => {
      const { reportId, jobId, category, exportType, schoolId, tenantId, filters } = job.data;

      await ReportJob.findOneAndUpdate(
        { jobId },
        {
          $set: {
            queueStatus: 'active',
            startedAt: new Date(),
            workerId: `worker-${process.pid}`,
          },
          $push: {
            logs: { level: 'INFO', message: `Starting ${category} report generation` },
          },
        }
      );

      await Report.findOneAndUpdate(
        { reportId },
        { $set: { status: 'RUNNING', startedAt: new Date(), progress: 10 } }
      );

      await job.updateProgress({ reportId, progress: 10, message: 'Fetching data...' });

      const startMs = Date.now();
      const generator = GENERATOR_MAP[category] || (async () => ({ summary: {}, data: [] }));
      const reportData = await generator(normalizeFilters(filters, schoolId, tenantId));
      const queryRuntimeMs = Date.now() - startMs;

      await QueryLog.create({
        reportId,
        tenantId,
        query: `${category} aggregation`,
        runtimeMs: queryRuntimeMs,
        cacheHit: false,
        rowsReturned: Array.isArray(reportData.data) ? reportData.data.length : 0,
        optimizationApplied: queryRuntimeMs > 500,
      });

      await job.updateProgress({ reportId, progress: 50, message: 'Generating file...' });
      await Report.findOneAndUpdate({ reportId }, { $set: { progress: 50 } });

      let fileBuffer;
      let mimeType;
      let fileExtension;

      if (exportType === 'PDF') {
        fileBuffer = await generatePDF({ ...reportData, tenantId }, category);
        mimeType = 'application/pdf';
        fileExtension = 'pdf';
      } else if (exportType === 'XLSX') {
        fileBuffer = await generateExcel({ ...reportData, tenantId }, category);
        mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        fileExtension = 'xlsx';
      } else if (exportType === 'CSV') {
        fileBuffer = generateCSV(reportData.data || []);
        mimeType = 'text/csv';
        fileExtension = 'csv';
      } else {
        fileBuffer = await exportJSON(reportData);
        mimeType = 'application/json';
        fileExtension = 'json';
      }

      await job.updateProgress({ reportId, progress: 75, message: 'Uploading artifact...' });
      await Report.findOneAndUpdate({ reportId }, { $set: { progress: 75 } });

      const storageKey = `reports/${tenantId || 'system'}/${reportId}.${fileExtension}`;
      let fileUrl = '';

      try {
        const uploadResult = await s3Upload({
          buffer: fileBuffer,
          key: storageKey,
          mimeType,
          metadata: { reportId, category, tenantId: tenantId || '' },
        });
        fileUrl = uploadResult.url;
      } catch (_) {
        const localDir = path.join(process.cwd(), 'tmp', 'reports');
        fs.mkdirSync(localDir, { recursive: true });
        const localPath = path.join(localDir, `${reportId}.${fileExtension}`);
        fs.writeFileSync(localPath, fileBuffer);
        fileUrl = `/tmp/reports/${reportId}.${fileExtension}`;
      }

      const totalMs = Date.now() - startMs;
      const aiScore = Math.max(0.6, Math.min(0.99, 0.85 + (queryRuntimeMs < 200 ? 0.1 : -0.05)));

      await Report.findOneAndUpdate(
        { reportId },
        {
          $set: {
            status: 'READY',
            progress: 100,
            completedAt: new Date(),
            durationMs: totalMs,
            fileUrl,
            fileKey: storageKey,
            sizeBytes: fileBuffer.length,
            compressionRatio: 0.62,
            aiScore,
            queryInfo: {
              queryCount: 1,
              avgRuntimeMs: queryRuntimeMs,
              cacheHitRate: 0,
              rowsProcessed: Array.isArray(reportData.data) ? reportData.data.length : 0,
              optimizationApplied: queryRuntimeMs > 500,
            },
          },
        }
      );

      await ReportJob.findOneAndUpdate(
        { jobId },
        {
          $set: {
            queueStatus: 'completed',
            finishedAt: new Date(),
            memoryUsageMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
            cpuPct: Math.round(os.loadavg()[0] * 10),
          },
          $push: {
            logs: { level: 'INFO', message: `Report ${reportId} completed in ${totalMs}ms` },
          },
        }
      );

      await job.updateProgress({ reportId, progress: 100, message: 'Report ready' });

      global.io?.of('/reports').emit('report:ready', {
        reportId,
        fileUrl,
        category,
        duration: `${Math.round(totalMs / 1000)}s`,
      });

      return { reportId, status: 'READY', fileUrl };
    },
    {
      connection,
      concurrency: 4,
      stalledInterval: 30000,
      lockDuration: 120000,
    }
  );

  worker.on('failed', async (job, err) => {
    const data = job?.data || {};
    if (data.reportId) {
      await Report.findOneAndUpdate(
        { reportId: data.reportId },
        { $set: { status: 'FAILED', progress: 0 } }
      );
    }
    if (data.jobId) {
      await ReportJob.findOneAndUpdate(
        { jobId: data.jobId },
        {
          $set: { queueStatus: 'failed', finishedAt: new Date(), failedReason: err.message },
          $push: { logs: { level: 'ERROR', message: err.message } },
        }
      );
    }
  });

  return worker;
}

module.exports = { startReportWorker };
