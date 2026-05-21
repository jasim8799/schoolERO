async function generateSecurityReport() {
  return {
    summary: { message: 'Security event report' },
    data: [],
    trendSeries: [],
  };
}

module.exports = { generateSecurityReport };
