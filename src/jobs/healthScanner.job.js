const { updateAllSchoolsHealth } = require('../services/healthScoring.service');

async function runHealthScanner() {
  const results = await updateAllSchoolsHealth();
  return { processed: results.length };
}

module.exports = { runHealthScanner };
