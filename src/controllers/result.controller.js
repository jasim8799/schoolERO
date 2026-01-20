const Result = require('../models/Result.js');
const ExamSubject = require('../models/ExamSubject.js');
const Exam = require('../models/Exam.js');
const Student = require('../models/Student.js');

const createOrUpdateResult = async (req, res) => {
  try {
    const { studentId, examId, marks } = req.body;
    const { schoolId, sessionId, _id: userId } = req.user;

    if (!Array.isArray(marks) || marks.length === 0) {
      return res.status(400).json({
        message: 'Marks array cannot be empty'
      });
    }

    // Check if exam is published
    const exam = await Exam.findOne({ _id: examId, schoolId, sessionId });
    if (!exam) {
      return res.status(404).json({ message: 'Exam not found' });
    }
    if (exam.status !== 'Published') {
      return res.status(403).json({ message: 'Results can only be entered after exam is published' });
    }

    // Check if result exists and is published
    const existingResult = await Result.findOne({ studentId, examId, schoolId, sessionId });
    if (existingResult && existingResult.status === 'Published') {
      return res.status(403).json({ message: 'Result is already published and cannot be updated.' });
    }

    if (existingResult && existingResult.marks?.length > 0) {
      return res.status(403).json({
        message: 'Marks already entered. Please contact administrator.'
      });
    }

    // Fetch all ExamSubject records once for performance optimization
    const examSubjects = await ExamSubject.find({
      examId,
      sessionId,
      schoolId
    });

    // Create subjectMap for efficient lookups
    const subjectMap = {};
    examSubjects.forEach(es => {
      subjectMap[es.subjectId.toString()] = es;
    });

    // Validate teacher assignments for each subject
    for (const mark of marks) {
      const examSubject = subjectMap[mark.subjectId.toString()];
      if (!examSubject) {
        return res.status(400).json({ message: `Subject ${mark.subjectId} is not assigned to any exam subject.` });
      }
      if (examSubject.teacherId.toString() !== userId.toString()) {
        return res.status(403).json({ message: 'You are not authorized to enter marks for this subject.' });
      }
    }

    // Calculate total, percentage, grade with maxMarks-based calculation
    let totalObtainedMarks = 0;
    let totalMaxMarks = 0;
    let allSubjectsPass = true;

    // Process each mark with ExamSubject data
    const processedMarks = [];
    for (const mark of marks) {
      const examSubject = subjectMap[mark.subjectId.toString()];

      if (!examSubject) {
        return res.status(400).json({ message: `ExamSubject not found for subject ${mark.subjectId}` });
      }

      // Validate marks cannot be negative
      if ((mark.marksObtained || 0) < 0) {
        return res.status(400).json({
          message: `Marks cannot be negative for subject ${mark.subjectId}`
        });
      }

      // Validate marksObtained does not exceed maxMarks
      if ((mark.marksObtained || 0) > examSubject.maxMarks) {
        return res.status(400).json({ message: `Marks obtained (${mark.marksObtained}) cannot exceed maximum marks (${examSubject.maxMarks}) for subject ${mark.subjectId}` });
      }

      const isPass = (mark.marksObtained || 0) >= examSubject.passMarks;
      if (!isPass) allSubjectsPass = false;

      totalObtainedMarks += mark.marksObtained || 0;
      totalMaxMarks += examSubject.maxMarks;

      processedMarks.push({
        subjectId: mark.subjectId,
        marksObtained: mark.marksObtained,
        isPass
      });
    }

    const percentage = totalMaxMarks > 0
      ? Number(((totalObtainedMarks / totalMaxMarks) * 100).toFixed(2))
      : 0;
    let grade = 'F';
    if (percentage >= 90) grade = 'A';
    else if (percentage >= 80) grade = 'B';
    else if (percentage >= 70) grade = 'C';
    else if (percentage >= 60) grade = 'D';

    const overallStatus = allSubjectsPass ? 'PASS' : 'FAIL';
    const promotionStatus = overallStatus === 'PASS' ? 'ELIGIBLE' : 'NOT_ELIGIBLE';

    // Create or update
    const result = await Result.findOneAndUpdate(
      { studentId, examId, schoolId, sessionId },
      {
        marks: processedMarks,
        totalMarks: totalObtainedMarks,
        percentage,
        grade,
        status: 'Draft',
        overallStatus,
        promotionStatus,
        createdBy: userId
      },
      { upsert: true, new: true }
    );
    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const publishResult = async (req, res) => {
  try {
    const { examId, studentId } = req.params;
    const { schoolId, sessionId } = req.user;

    const result = await Result.findOne({ studentId, examId, schoolId, sessionId });
    if (!result) {
      return res.status(404).json({ message: 'Result not found.' });
    }

    if (result.status === 'Published') {
      return res.status(403).json({ message: 'Result is already published.' });
    }

    result.status = 'Published';
    await result.save();

    // Calculate ranks for all results in this exam
    // TODO: Recalculate ranks for all published results in this exam
    await calculateExamRanks(examId, schoolId, sessionId);

    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getMyResult = async (req, res) => {
  try {
    const { studentId, schoolId, sessionId } = req.user;
    const { examId } = req.params;

    const result = await Result.findOne({ studentId, examId, schoolId, sessionId })
      .populate('studentId', 'name rollNumber')
      .populate('examId', 'name')
      .populate('marks.subjectId', 'name');
    if (!result) {
      return res.status(404).json({ message: 'Result not found.' });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getResultsByExam = async (req, res) => {
  try {
    const { examId } = req.params;
    const { schoolId, sessionId } = req.user;

    const results = await Result.find({ examId, schoolId, sessionId })
      .populate('studentId', 'name rollNumber')
      .populate('examId', 'name')
      .populate('marks.subjectId', 'name')
      .sort({ 'studentId.rollNumber': 1 });
    res.json(results);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getChildrenResults = async (req, res) => {
  try {
    const { _id: parentId, schoolId, sessionId } = req.user;
    const { examId } = req.query;

    // Find children of the parent
    const students = await Student.find({ parentId, schoolId, sessionId }).select('_id');

    const results = await Result.find({
      studentId: { $in: students.map(s => s._id) },
      examId,
      schoolId,
      sessionId
    })
      .populate('studentId', 'name rollNumber')
      .populate('examId', 'name')
      .populate('marks.subjectId', 'name');
    res.json(results);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getMyResults = async (req, res) => {
  try {
    const { studentId, schoolId, sessionId } = req.user;

    const results = await Result.find({ studentId, schoolId, sessionId })
      .populate('examId', 'name')
      .populate('marks.subjectId', 'name')
      .sort({ createdAt: -1 });
    res.json(results);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getResultPDF = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await Result.findById(id)
      .populate('studentId', 'name rollNumber')
      .populate('examId', 'name')
      .populate('marks.subjectId', 'name')
      .populate('schoolId', 'name address phone email');

    if (!result) {
      return res.status(404).json({ message: 'Result not found.' });
    }

    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ size: 'A4', margin: 50 });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=result-${result.studentId.rollNumber}.pdf`);

    doc.pipe(res);

    // School Header
    const school = result.schoolId;
    doc.fontSize(20).font('Helvetica-Bold').text(school.name, { align: 'center' });
    doc.fontSize(12).font('Helvetica').text(`${school.address}`, { align: 'center' });
    doc.text(`${school.phone} | ${school.email}`, { align: 'center' });
    doc.moveDown(2);

    // Title
    doc.fontSize(24).font('Helvetica-Bold').text('EXAM RESULT', { align: 'center' });
    doc.moveDown(2);

    // Result Details
    doc.fontSize(14).font('Helvetica-Bold').text('Student Details:', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(12).font('Helvetica');
    doc.text(`Name: ${result.studentId.name}`);
    doc.text(`Roll Number: ${result.studentId.rollNumber}`);
    doc.text(`Exam: ${result.examId.name}`);
    doc.text(`Total Marks: ${result.totalMarks}`);
    doc.text(`Percentage: ${result.percentage?.toFixed(2)}%`);
    doc.text(`Grade: ${result.grade}`);
    doc.text(`Overall Status: ${result.overallStatus}`);
    doc.text(`Rank: ${result.rank || 'N/A'}`);
    doc.text(`Promotion Eligibility: ${result.promotionStatus}`);
    doc.moveDown(1);

    // Marks Table
    doc.fontSize(14).font('Helvetica-Bold').text('Subject-wise Marks:', { underline: true });
    doc.moveDown(0.5);

    const tableTop = doc.y;
    const itemHeight = 20;
    const subjectWidth = 120;
    const marksWidth = 80;
    const passFailWidth = 80;

    // Table Header
    doc.fontSize(12).font('Helvetica-Bold');
    doc.text('Subject', 50, tableTop, { width: subjectWidth });
    doc.text('Marks', 50 + subjectWidth, tableTop, { width: marksWidth });
    doc.text('Pass/Fail', 50 + subjectWidth + marksWidth, tableTop, { width: passFailWidth });
    doc.moveDown(0.5);

    // Table Rows
    doc.font('Helvetica');
    result.marks.forEach((mark, index) => {
      const y = tableTop + itemHeight * (index + 1);
      doc.text(mark.subjectId.name, 50, y, { width: subjectWidth });
      doc.text(mark.marksObtained.toString(), 50 + subjectWidth, y, { width: marksWidth });
      doc.text(mark.isPass ? 'PASS' : 'FAIL', 50 + subjectWidth + marksWidth, y, { width: passFailWidth });
    });

    // Footer
    doc.moveDown(4);
    doc.fontSize(10).text(`Generated on ${new Date().toDateString()}`, { align: 'center' });
    doc.text('Principal Signature: ___________________________', { align: 'center' });
    doc.text('System Generated Document', { align: 'center' });

    doc.end();
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Helper function to calculate ranks for all results in an exam
const calculateExamRanks = async (examId, schoolId, sessionId) => {
  try {
    // Get all published results for this exam, sorted by percentage descending
    const results = await Result.find({
      examId,
      schoolId,
      sessionId,
      status: 'Published'
    }).sort({ percentage: -1 });

    let currentRank = 1;
    let previousPercentage = null;
    let rankCounter = 1;

    for (const result of results) {
      // If percentage is different from previous, update rank
      if (result.percentage !== previousPercentage) {
        currentRank = rankCounter;
        previousPercentage = result.percentage;
      }

      // Update rank for this result
      await Result.findByIdAndUpdate(result._id, { rank: currentRank });
      rankCounter++;
    }
  } catch (err) {
    console.error('Error calculating exam ranks:', err);
    // Don't throw error to avoid breaking the publish flow
  }
};

module.exports = {
  createOrUpdateResult,
  publishResult,
  getMyResult,
  getResultsByExam,
  getChildrenResults,
  getMyResults,
  getResultPDF
};
