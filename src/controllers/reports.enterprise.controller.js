const cron = require('node-cron');
const os = require('os');

const Report = require('../models/Report');
const ReportJob = require('../models/ReportJob');
const ReportSchedule = require('../models/ReportSchedule');
const ExportHistory = require('../models/ExportHistory');
const AIInsight = require('../models/AIInsight');
const QueryLog = require('../models/QueryLog');
const InfrastructureMetric = require('../models/InfrastructureMetric');
const Payment = require('../models/Payment');
const AuditLog = require('../models/AuditLog');

const { createReport } = require('../reports/engine/reportEngine');
const { generateAIInsights } = require('../reports/ai/insightsEngine');
const { reportQueue } = require('../reports/queues/reportQueue');
const { exportQueue } = require('../reports/queues/exportQueue');
const { reportCache } = require('../reports/cache/reportCache');

const getReports = async (req, res) => {
  try {
    const {
      status,
      category,
      department,
      search,
      page = 1,
      limit = 50,
      sortBy = 'createdAt',
      sortOrder = '-1',
    } = req.query;

    const tenantId = req.user.schoolId?.toString();
    const schoolId = req.user.schoolId;

    const cacheKey = `list:${tenantId}:${status || 'ALL'}:${category || 'ALL'}:${department || 'ALL'}:${page}:${limit}:${search || ''}`;
    const cached = await reportCache.get(cacheKey);
    if (cached) {
      return res.json({ success: true, ...cached, cached: true });
    }

    const query = { tenantId };
    if (status && status !== 'ALL') query.status = status;
    if (category && category !== 'ALL') query.category = category;
    if (department) query.department = department;
    if (search) {
      query.$or = [
        { reportName: { $regex: search, $options: 'i' } },
        { category: { $regex: search, $options: 'i' } },
        { generatedBy: { $regex: search, $options: 'i' } },
      ];
    }

    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const sort = { [sortBy]: parseInt(sortOrder, 10) };

    const [reports, total, insights, metrics, queueStats] = await Promise.all([
      Report.find(query).sort(sort).skip(skip).limit(parseInt(limit, 10)).lean(),
      Report.countDocuments(query),
      AIInsight.find({ tenantId, resolved: false }).sort({ severity: 1, createdAt: -1 }).limit(8).lean(),
      getMetricsCore(tenantId, schoolId),
      getQueueStats(),
    ]);

    const formattedReports = reports.map(formatReport);
    const aiCards = insights.map((i) => ({
      title: i.title,
      recommendation: i.recommendation,
      severity: i.severity,
      confidence: i.confidence,
      color: i.color || severityToColor(i.severity),
    }));

    const timeline = reports.slice(0, 6).map((r) => ({
      title: r.reportName,
      time: relativeTime(r.createdAt),
      color: statusColor(r.status),
      type: r.status,
    }));

    const result = {
      reports: formattedReports,
      totalCount: total,
      page: parseInt(page, 10),
      totalPages: Math.ceil(total / parseInt(limit, 10)),
      metrics,
      aiCards,
      timeline,
      exportMonitor: await getExportMonitorCore(),
      generationCenter: buildGenerationCenter(reports),
      analyticsData: await getAnalyticsDataCore(tenantId, schoolId),
      queueStats,
    };

    await reportCache.set(cacheKey, result, 30);

    return res.json({ success: true, ...result });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const getReportById = async (req, res) => {
  try {
    const report = await Report.findOne({
      reportId: req.params.id,
      tenantId: req.user.schoolId?.toString(),
    }).lean();

    if (!report) {
      return res.status(404).json({ success: false, message: 'Report not found' });
    }

    const [job, exports, insights, queryLogs] = await Promise.all([
      ReportJob.findOne({ reportId: report.reportId }).lean(),
      ExportHistory.find({ reportId: report.reportId }).sort({ exportedAt: -1 }).limit(10).lean(),
      AIInsight.find({ reportId: report.reportId }).lean(),
      QueryLog.find({ reportId: report.reportId }).sort({ timestamp: -1 }).limit(20).lean(),
    ]);

    return res.json({
      success: true,
      data: {
        ...formatReport(report),
        job,
        exportHistory: exports.map((e) => ({
          type: e.exportType,
          status: e.deliveryStatus,
          time: relativeTime(e.exportedAt),
          destination: e.destination,
          deliveredAt: e.deliveredAt,
        })),
        aiInsights: insights,
        queryLogs: queryLogs.map((q) => ({
          query: q.query,
          runtime: `${q.runtimeMs}ms`,
          cacheHit: q.cacheHit,
          rows: q.rowsReturned,
          optimized: q.optimizationApplied,
        })),
        compliance: report.compliance,
        diagnostics: {
          workerMemory: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
          cpuLoad: `${(os.loadavg()[0] * 10).toFixed(0)}%`,
          querySpeed: `${report.queryInfo?.avgRuntimeMs || 0}ms avg`,
          uptime: `${Math.round(process.uptime() / 3600)}h`,
        },
        infrastructure: {
          status: 'ONLINE',
          engineVersion: '2.0.0',
          queueDepth: await reportQueue.getWaitingCount().catch(() => 0),
          pipeline: 'Stable',
        },
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const generateReport = async (req, res) => {
  try {
    const {
      category,
      reportName,
      exportType = 'PDF',
      department,
      mode = 'Manual',
      filters = {},
      priority,
    } = req.body;

    if (!category) {
      return res.status(400).json({ success: false, message: 'category is required' });
    }

    const report = await createReport({
      category,
      reportName,
      exportType,
      schoolId: req.user.schoolId,
      tenantId: req.user.schoolId?.toString(),
      department: department || categoryToDept(category),
      mode,
      filters: { ...filters, schoolId: req.user.schoolId },
      generatedBy: req.user.email || req.user.name || 'system@erp',
      generatedById: req.user._id,
      priority: priority || 3,
    });

    await AuditLog.create({
      action: 'AUTOMATION_TRIGGERED',
      userId: req.user._id,
      role: req.user.role,
      entityType: 'WORKFLOW',
      description: `Report ${report.reportId} queued: ${category}`,
      ipAddress: req.ip,
      schoolId: req.user.schoolId,
    }).catch(() => {});

    global.io?.of('/reports').emit('report:queued', {
      reportId: report.reportId,
      category,
      status: 'QUEUED',
    });

    return res.json({
      success: true,
      data: {
        reportId: report.reportId,
        status: 'QUEUED',
        message: `${category} report queued for generation`,
        estimatedTime: '1-5 minutes',
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const scheduleReport = async (req, res) => {
  try {
    const { category, exportType, cronExpression, timezone, recipients, filters } = req.body;

    if (!cronExpression || !cron.validate(cronExpression)) {
      return res.status(400).json({ success: false, message: 'Invalid cron expression' });
    }

    const schedule = await ReportSchedule.create({
      scheduleId: `SCH-${Date.now().toString(36).toUpperCase()}`,
      tenantId: req.user.schoolId?.toString(),
      schoolId: req.user.schoolId,
      reportCategory: category,
      exportType: exportType || 'PDF',
      cronExpression,
      timezone: timezone || 'Asia/Kolkata',
      nextRun: nextCronRun(cronExpression),
      enabled: true,
      recipients: recipients || [],
      filters: filters || {},
      createdBy: req.user._id,
    });

    return res.json({ success: true, data: schedule });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const getMetrics = async (req, res) => {
  try {
    const tenantId = req.user.schoolId?.toString();
    const schoolId = req.user.schoolId;
    const data = await getMetricsCore(tenantId, schoolId);
    return res.json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const getAnalytics = async (req, res) => {
  try {
    const tenantId = req.user.schoolId?.toString();
    const data = await getAnalyticsDataCore(tenantId, req.user.schoolId);
    return res.json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const getInsights = async (req, res) => {
  try {
    const tenantId = req.user.schoolId?.toString();

    const recent = await AIInsight.findOne({
      tenantId,
      createdAt: { $gte: new Date(Date.now() - 3600000) },
    }).lean();

    if (!recent) {
      await generateAIInsights(tenantId, req.user.schoolId);
    }

    const insights = await AIInsight.find({ tenantId, resolved: false })
      .sort({ severity: 1, createdAt: -1 })
      .limit(8)
      .lean();

    return res.json({ success: true, data: insights });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const getInfrastructure = async (req, res) => {
  try {
    const [history, queueCounts] = await Promise.all([
      InfrastructureMetric.find().sort({ timestamp: -1 }).limit(24).lean(),
      getQueueStats(),
    ]);

    return res.json({
      success: true,
      data: {
        current: {
          queueDepth: queueCounts.waiting,
          activeWorkers: queueCounts.active,
          failedJobs: queueCounts.failed,
          memoryUsagePct: Math.round((process.memoryUsage().heapUsed / process.memoryUsage().heapTotal) * 100),
          cpuLoad: (os.loadavg()[0] * 10).toFixed(1),
          uptime: `${Math.round(process.uptime() / 3600)}h`,
          nodeVersion: process.version,
          platform: os.platform(),
        },
        history,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const getExportMonitor = async (req, res) => {
  try {
    const data = await getExportMonitorCore();
    return res.json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const getQueryLogs = async (req, res) => {
  try {
    const tenantId = req.user.schoolId?.toString();
    const logs = await QueryLog.find({ tenantId }).sort({ timestamp: -1 }).limit(50).lean();

    const avgRuntime = logs.length ? logs.reduce((sum, item) => sum + item.runtimeMs, 0) / logs.length : 0;
    const cacheHitRate = logs.length ? logs.filter((item) => item.cacheHit).length / logs.length : 0;

    return res.json({
      success: true,
      data: {
        logs: logs.map((l) => ({
          query: l.query,
          runtime: `${l.runtimeMs}ms`,
          cacheHit: l.cacheHit,
          rows: l.rowsReturned,
          time: relativeTime(l.timestamp),
        })),
        summary: {
          totalQueries: logs.length,
          avgRuntimeMs: Math.round(avgRuntime),
          cacheHitRate: `${(cacheHitRate * 100).toFixed(1)}%`,
          slowQueries: logs.filter((l) => l.runtimeMs > 500).length,
        },
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const retryReport = async (req, res) => {
  try {
    const { reportId } = req.body;
    const report = await Report.findOne({ reportId }).lean();

    if (!report) {
      return res.status(404).json({ success: false, message: 'Report not found' });
    }

    if (report.status !== 'FAILED') {
      return res.status(400).json({ success: false, message: 'Only FAILED reports can be retried' });
    }

    await Report.findOneAndUpdate({ reportId }, { $set: { status: 'QUEUED', progress: 0 } });

    await reportQueue.add(
      'generate_report',
      {
        reportId,
        jobId: `job_${reportId}_retry_${Date.now()}`,
        category: report.category,
        exportType: report.exportType,
        schoolId: report.schoolId?.toString(),
        tenantId: report.tenantId,
        filters: report.filters || {},
      },
      { priority: 1 }
    );

    return res.json({ success: true, message: `Report ${reportId} requeued` });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const archiveReport = async (req, res) => {
  try {
    const { reportId } = req.body;
    await Report.findOneAndUpdate({ reportId }, { $set: { status: 'ARCHIVED' } });
    return res.json({ success: true, message: `Report ${reportId} archived` });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const exportReport = async (req, res) => {
  try {
    const { reportId, exportType = 'PDF', destination = 'DOWNLOAD' } = req.body;
    const report = await Report.findOne({ reportId }).lean();

    if (!report) {
      return res.status(404).json({ success: false, message: 'Report not found' });
    }

    await ExportHistory.create({
      reportId,
      tenantId: report.tenantId,
      exportedBy: req.user._id,
      exportType,
      destination,
      fileUrl: report.fileUrl,
      sizeBytes: report.sizeBytes,
      deliveryStatus: destination === 'DOWNLOAD' ? 'DELIVERED' : 'PENDING',
      deliveredAt: destination === 'DOWNLOAD' ? new Date() : undefined,
    });

    if (destination !== 'DOWNLOAD') {
      await exportQueue.add('deliver_export', { reportId, destination, exportType }, { priority: 2 });
    }

    return res.json({
      success: true,
      data: { reportId, fileUrl: report.fileUrl, exportType, destination },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

async function getMetricsCore(tenantId, schoolId) {
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [reportsGenerated, exportJobs, aiInsights, failedReports, activeSchedules, realtimeDashboards, avgQueryMs] =
    await Promise.all([
      Report.countDocuments({ tenantId }),
      ExportHistory.countDocuments({ tenantId }),
      AIInsight.countDocuments({ tenantId }),
      Report.countDocuments({ tenantId, status: 'FAILED' }),
      ReportSchedule.countDocuments({ tenantId, enabled: true }),
      Report.countDocuments({ tenantId, status: 'LIVE' }),
      QueryLog.aggregate([{ $match: { tenantId } }, { $group: { _id: null, avg: { $avg: '$runtimeMs' } } }]),
      schoolId ? Payment.countDocuments({ schoolId, createdAt: { $gte: dayAgo } }) : Promise.resolve(0),
    ]);

  const avgMs = avgQueryMs[0]?.avg || 142;

  const totalSize = await Report.aggregate([
    { $match: { tenantId, status: 'READY' } },
    { $group: { _id: null, total: { $sum: '$sizeBytes' } } },
  ]);

  const dataTB = ((totalSize[0]?.total || 0) / 1024 / 1024 / 1024 / 1024).toFixed(2);

  return {
    reportsGenerated,
    exportJobs,
    aiInsights,
    dataProcessed: `${dataTB} TB`,
    complianceScore: '96.3%',
    failedReports,
    activeSchedules,
    realtimeDashboards,
    querySpeed: `${Math.round(avgMs)}ms`,
    storageAnalytics: '71%',
    predictionAccuracy: '92.7%',
    systemHealth: '98.4%',
  };
}

async function getAnalyticsDataCore(tenantId, schoolId) {
  if (!schoolId) return mockAnalytics();

  const sixMonthsAgo = new Date(Date.now() - 180 * 86400000);

  const [revenueByMonth, reportsByDay] = await Promise.all([
    Payment.aggregate([
      { $match: { schoolId, createdAt: { $gte: sixMonthsAgo } } },
      { $group: { _id: { month: { $month: '$createdAt' } }, total: { $sum: '$amount' } } },
      { $sort: { '_id.month': 1 } },
    ]),
    Report.aggregate([
      { $match: { tenantId, createdAt: { $gte: new Date(Date.now() - 10 * 86400000) } } },
      { $group: { _id: { day: { $dayOfMonth: '$createdAt' } }, count: { $sum: 1 } } },
      { $sort: { '_id.day': 1 } },
    ]),
  ]);

  return {
    revenueTrend: revenueByMonth.map((m) => m.total),
    userGrowth: reportsByDay.map((d) => d.count),
    aiConfidence: [74, 76, 78, 80, 82, 84, 86, 89, 91, 93],
    reportTimeline: reportsByDay.map((d) => ({ day: d._id.day, count: d.count })),
  };
}

async function getExportMonitorCore() {
  const [pdfPending, xlsxPending, csvPending, jsonPending, failedExports] = await Promise.all([
    ExportHistory.countDocuments({ exportType: 'PDF', deliveryStatus: 'PENDING' }),
    ExportHistory.countDocuments({ exportType: 'XLSX', deliveryStatus: 'PENDING' }),
    ExportHistory.countDocuments({ exportType: 'CSV', deliveryStatus: 'PENDING' }),
    ExportHistory.countDocuments({ exportType: 'JSON', deliveryStatus: 'PENDING' }),
    ExportHistory.countDocuments({ deliveryStatus: 'FAILED' }),
  ]);

  return [
    { type: 'PDF', speed: '42 MB/s', queue: `Queue: ${pdfPending}`, status: 'ACTIVE', progress: 0.78 },
    { type: 'Excel', speed: '31 MB/s', queue: `Queue: ${xlsxPending}`, status: 'RUNNING', progress: 0.63 },
    { type: 'CSV', speed: '53 MB/s', queue: `Queue: ${csvPending}`, status: 'ACTIVE', progress: 0.84 },
    { type: 'JSON', speed: '25 MB/s', queue: `Queue: ${jsonPending}`, status: 'RUNNING', progress: 0.55 },
    { type: 'Failed', speed: `${failedExports} jobs`, queue: 'Needs retry', status: 'FAILED', progress: 0.15 },
    { type: 'Delivery', speed: '98.1%', queue: 'webhooks', status: 'SUCCESS', progress: 0.98 },
  ];
}

async function getQueueStats() {
  try {
    const [waiting, active, failed, completed] = await Promise.all([
      reportQueue.getWaitingCount(),
      reportQueue.getActiveCount(),
      reportQueue.getFailedCount(),
      reportQueue.getCompletedCount(),
    ]);
    return { waiting, active, failed, completed };
  } catch (_) {
    return { waiting: 0, active: 0, failed: 0, completed: 0 };
  }
}

function buildGenerationCenter(reports) {
  const categories = [
    'Revenue Analytics',
    'Subscription Analytics',
    'Security Reports',
    'Attendance Reports',
    'Student Performance Reports',
    'Audit Reports',
    'Infrastructure Reports',
    'Compliance Reports',
    'User Activity Reports',
    'AI Intelligence Reports',
  ];

  return categories.map((cat) => {
    const latest = reports.find((r) => r.category === cat);
    return {
      category: cat,
      status: latest?.status || 'READY',
      formats: categoryFormats(cat),
      lastGenerated: latest ? relativeTime(latest.createdAt) : 'Never',
      size: latest ? formatBytes(latest.sizeBytes) : '0 B',
      aiScore: latest?.aiScore || 0.9,
      available: true,
    };
  });
}

function formatReport(r) {
  return {
    _id: r._id?.toString(),
    icon: categoryIcon(r.category),
    reportName: r.reportName,
    reportId: `#${r.reportId}`,
    category: r.category || 'General',
    department: r.department || categoryToDept(r.category),
    status: r.status || 'READY',
    generatedBy: r.generatedBy || 'system@erp',
    mode: r.mode || 'Manual',
    exportType: r.exportType || 'PDF',
    size: formatBytes(r.sizeBytes),
    compression: `${Math.round((r.compressionRatio || 0.62) * 100)}%`,
    created: r.createdAt ? formatTime(r.createdAt) : 'N/A',
    duration: r.durationMs ? `${Math.round(r.durationMs / 1000)}s` : 'pending',
    aiScore: r.aiScore || 0.9,
    gdpr: r.compliance?.gdpr || false,
    iso: r.compliance?.iso27001 || false,
    soc2: r.compliance?.soc2 || false,
    fileUrl: r.fileUrl,
  };
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value.toFixed(1)} ${units[idx]}`;
}

function relativeTime(date) {
  if (!date) return 'N/A';
  const mins = Math.floor((Date.now() - new Date(date).getTime()) / 60000);
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return `${Math.floor(mins / 1440)}d ago`;
}

function formatTime(date) {
  const d = new Date(date);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')} UTC`;
}

function nextCronRun(cronExpression) {
  try {
    const parser = require('cron-parser');
    return parser.parseExpression(cronExpression).next().toDate();
  } catch (_) {
    return new Date(Date.now() + 86400000);
  }
}

function statusColor(status) {
  const map = { READY: 'saGreen', RUNNING: 'saCyan', FAILED: 'saRed', QUEUED: 'saBlue', LIVE: 'saCyan' };
  return map[status] || 'saOrange';
}

function severityToColor(severity) {
  return { CRITICAL: 'saRed', HIGH: 'saOrange', MEDIUM: 'saCyan', LOW: 'saGreen' }[severity] || 'saTeal';
}

function categoryToDept(category) {
  const map = {
    'Revenue Analytics': 'Finance',
    'Subscription Analytics': 'Billing',
    'Attendance Reports': 'Student Affairs',
    'Security Reports': 'SOC',
    'Audit Reports': 'Governance',
    'Compliance Reports': 'Legal',
    'Infrastructure Reports': 'DevOps',
    'AI Intelligence Reports': 'Data Science',
    'User Activity Reports': 'Operations',
  };
  return map[category] || 'Platform';
}

function categoryIcon(category) {
  const map = {
    'Revenue Analytics': 'monetization_on',
    'Subscription Analytics': 'subscriptions',
    'Attendance Reports': 'how_to_reg',
    'Security Reports': 'security',
    'Audit Reports': 'gavel',
    'Compliance Reports': 'fact_check',
    'AI Intelligence Reports': 'psychology',
    'Infrastructure Reports': 'cloud_queue',
    'User Activity Reports': 'people_alt',
  };
  return map[category] || 'description';
}

function categoryFormats(category) {
  const map = {
    'Revenue Analytics': 'PDF | XLSX | CSV',
    'AI Intelligence Reports': 'PDF | JSON',
    'Security Reports': 'PDF | JSON',
    'Infrastructure Reports': 'XLSX | JSON',
  };
  return map[category] || 'PDF | XLSX | CSV';
}

function mockAnalytics() {
  return {
    revenueTrend: [24, 28, 33, 38, 42, 48, 56, 61, 66, 72],
    userGrowth: [10, 12, 14, 18, 21, 25, 29, 34, 38, 44],
    aiConfidence: [74, 76, 78, 80, 82, 84, 86, 89, 91, 93],
    reportTimeline: [],
  };
}

module.exports = {
  getReports,
  getReportById,
  generateReport,
  scheduleReport,
  getMetrics,
  getAnalytics,
  getInsights,
  getInfrastructure,
  getExportMonitor,
  getQueryLogs,
  retryReport,
  archiveReport,
  exportReport,
};
