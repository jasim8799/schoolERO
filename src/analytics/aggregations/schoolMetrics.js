const School = require('../../models/School');

async function getSchoolMetricsSummary() {
  const rows = await School.aggregate([
    { $match: { isDeleted: false } },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        avgHealth: { $avg: '$healthScore' }
      }
    }
  ]);
  return rows;
}

module.exports = { getSchoolMetricsSummary };
