async function exportJSON(reportData) {
  return Buffer.from(JSON.stringify(reportData, null, 2));
}

module.exports = { exportJSON };
