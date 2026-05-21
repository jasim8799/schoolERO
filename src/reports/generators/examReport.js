const Result = require('../../models/Result');
const Exam = require('../../models/Exam');

async function generateExamReport(filters = {}) {
  const { schoolId, examId } = filters;
  const examMatch = {};
  if (schoolId) examMatch.schoolId = schoolId;
  if (examId) examMatch.examId = examId;

  const [exams, grades] = await Promise.all([
    Exam.find(schoolId ? { schoolId } : {}).select('name date').lean(),
    Result.aggregate([
      { $match: examMatch },
      { $group: { _id: '$grade', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
  ]);

  return {
    summary: {
      examCount: exams.length,
      gradedResults: grades.reduce((sum, g) => sum + g.count, 0),
    },
    data: grades.map((g) => ({ grade: g._id || 'N/A', count: g.count })),
    trendSeries: grades.map((g) => g.count),
  };
}

module.exports = { generateExamReport };
