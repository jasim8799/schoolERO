const School = require('../models/School');

async function getSchoolAggregateTotals() {
  const [agg] = await School.aggregate([
    { $match: { isDeleted: false } },
    {
      $group: {
        _id: null,
        totalStudents: { $sum: '$analytics.studentsCount' },
        totalTeachers: { $sum: '$analytics.teachersCount' },
        totalOnlineUsers: { $sum: '$analytics.onlineUsers' },
        avgAttendance: { $avg: '$analytics.todayAttendancePct' },
        totalCollection: { $sum: '$analytics.todayFeeCollection' }
      }
    }
  ]);

  return agg || {
    totalStudents: 0,
    totalTeachers: 0,
    totalOnlineUsers: 0,
    avgAttendance: 0,
    totalCollection: 0
  };
}

module.exports = { getSchoolAggregateTotals };
