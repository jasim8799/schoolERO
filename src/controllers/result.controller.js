import Result from '../models/Result.js';

export const createOrUpdateResult = async (req, res) => {
  try {
    const { studentId, examId, marks } = req.body;
    const { schoolId, sessionId, _id: userId } = req.user;

    // Check if result exists and is published
    const existingResult = await Result.findOne({ studentId, examId, schoolId, sessionId });
    if (existingResult && existingResult.status === 'Published') {
      return res.status(403).json({ message: 'Result is already published and cannot be updated.' });
    }

    // Calculate total, percentage, grade
    const totalMarks = marks.reduce((sum, m) => sum + (m.marks || 0), 0);
    const numSubjects = marks.length;
    const percentage = numSubjects > 0 ? (totalMarks / (numSubjects * 100)) * 100 : 0;
    let grade = 'F';
    if (percentage >= 90) grade = 'A';
    else if (percentage >= 80) grade = 'B';
    else if (percentage >= 70) grade = 'C';
    else if (percentage >= 60) grade = 'D';

    // Create or update
    const result = await Result.findOneAndUpdate(
      { studentId, examId, schoolId, sessionId },
      {
        marks,
        totalMarks,
        percentage,
        grade,
        status: 'Draft',
        createdBy: userId
      },
      { upsert: true, new: true }
    );
    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const publishResult = async (req, res) => {
  try {
    const { studentId, examId } = req.body;
    const { schoolId, sessionId } = req.user;

    const result = await Result.findOneAndUpdate(
      { studentId, examId, schoolId, sessionId },
      { status: 'Published' },
      { new: true }
    );
    if (!result) {
      return res.status(404).json({ message: 'Result not found.' });
    }
    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const getMyResult = async (req, res) => {
  try {
    const { studentId, schoolId, sessionId } = req.user;
    const { examId } = req.query;

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

export const getResultPDF = async (req, res) => {
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
    doc.moveDown(1);

    // Marks Table
    doc.fontSize(14).font('Helvetica-Bold').text('Subject-wise Marks:', { underline: true });
    doc.moveDown(0.5);

    const tableTop = doc.y;
    const itemHeight = 20;
    const subjectWidth = 200;
    const marksWidth = 100;

    // Table Header
    doc.fontSize(12).font('Helvetica-Bold');
    doc.text('Subject', 50, tableTop, { width: subjectWidth });
    doc.text('Marks', 50 + subjectWidth, tableTop, { width: marksWidth });
    doc.moveDown(0.5);

    // Table Rows
    doc.font('Helvetica');
    result.marks.forEach((mark, index) => {
      const y = tableTop + itemHeight * (index + 1);
      doc.text(mark.subjectId.name, 50, y, { width: subjectWidth });
      doc.text(mark.marks.toString(), 50 + subjectWidth, y, { width: marksWidth });
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
