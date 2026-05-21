async function generateAuditReport() {
  return { summary: { message: 'Audit trail report' }, data: [], trendSeries: [] };
}

module.exports = { generateAuditReport };
