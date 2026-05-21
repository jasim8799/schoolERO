const Attendance = require('../../models/Attendance');

async function getAttendanceTrend(days = 30) {
  const start = new Date(Date.now() - days * 86400000);

  return Attendance.aggregate([
    { $match: { date: { $gte: start } } },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$date' } },
        present: {
          $sum: {
            $cond: [{ $in: ['$status', ['PRESENT', 'present']] }, 1, 0]
          }
        },
        total: { $sum: 1 }
      }
    },
    {
      $project: {
        date: '$_id',
        pct: {
          $cond: [{ $eq: ['$total', 0] }, 0, { $multiply: [{ $divide: ['$present', '$total'] }, 100] }]
        }
      }
    },
    { $sort: { date: 1 } }
  ]);
}

module.exports = { getAttendanceTrend };
