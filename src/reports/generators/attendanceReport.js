const StudentDailyAttendance = require('../../models/StudentDailyAttendance');
const Student = require('../../models/Student');

async function generateAttendanceReport(filters = {}) {
  const { schoolId, classId, startDate, endDate } = filters;
  const match = {};
  if (schoolId) match.schoolId = schoolId;
  if (classId) match.classId = classId;
  if (startDate || endDate) {
    match.date = {};
    if (startDate) match.date.$gte = new Date(startDate);
    if (endDate) match.date.$lte = new Date(endDate);
  }

  const [attendanceStats, studentCount, byClass] = await Promise.all([
    StudentDailyAttendance.aggregate([
      { $match: match },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    Student.countDocuments(schoolId ? { schoolId } : {}),
    StudentDailyAttendance.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$classId',
          present: { $sum: { $cond: [{ $eq: ['$status', 'PRESENT'] }, 1, 0] } },
          absent: { $sum: { $cond: [{ $eq: ['$status', 'ABSENT'] }, 1, 0] } },
          total: { $sum: 1 },
        },
      },
      { $lookup: { from: 'classes', localField: '_id', foreignField: '_id', as: 'class' } },
      {
        $addFields: {
          percentage: {
            $multiply: [{ $divide: ['$present', { $max: ['$total', 1] }] }, 100],
          },
        },
      },
    ]),
  ]);

  const present = attendanceStats.find((s) => s._id === 'PRESENT')?.count || 0;
  const absent = attendanceStats.find((s) => s._id === 'ABSENT')?.count || 0;
  const total = present + absent;

  return {
    summary: {
      totalStudents: studentCount,
      presentToday: present,
      absentToday: absent,
      attendancePercentage: total > 0 ? Number(((present / total) * 100).toFixed(1)) : 0,
    },
    data: byClass.map((c) => ({
      className: c.class?.[0]?.name || 'Unknown',
      present: c.present,
      absent: c.absent,
      percentage: Number((c.percentage || 0).toFixed(1)),
    })),
    trendSeries: byClass.map((c) => c.percentage || 0),
  };
}

module.exports = { generateAttendanceReport };
