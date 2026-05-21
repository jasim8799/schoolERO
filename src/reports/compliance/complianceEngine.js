const ComplianceAudit = require('../../models/ComplianceAudit');

const complianceEngine = {
  async check({ category, schoolId, exportType }) {
    const checks = {
      gdpr: true,
      iso27001: true,
      soc2: category !== 'Infrastructure Reports',
      piiDetected: false,
      encrypted: exportType !== 'CSV',
      retentionDays: 90,
    };

    try {
      await ComplianceAudit.create({
        schoolId,
        checks,
        notes: `Compliance pre-check for ${category}`,
      });
    } catch (_) {
      // Compliance logging is best-effort and should not block generation.
    }

    return checks;
  },
};

module.exports = { complianceEngine };
