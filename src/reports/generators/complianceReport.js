async function generateComplianceReport() {
  return { summary: { message: 'Compliance digest report' }, data: [], trendSeries: [] };
}

module.exports = { generateComplianceReport };
