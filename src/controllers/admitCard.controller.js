const AdmitCard = require('../models/AdmitCard.js');
const ExamPayment = require('../models/ExamPayment.js');
const ExamForm = require('../models/ExamForm.js');

const generateAdmitCard = async (req, res) => {
  try {
    const { studentId, examId, rollNumber, examCenter } = req.body;
    const { schoolId, sessionId, _id: userId } = req.user;

    // Find the exam form for this exam
    const examForm = await ExamForm.findOne({ examId, schoolId, sessionId });
    if (!examForm) {
      return res.status(404).json({ message: 'Exam form not found for this exam.' });
    }

    // Check if payment exists
    const payment = await ExamPayment.findOne({
      studentId,
      examFormId: examForm._id,
      status: 'Paid',
      schoolId,
      sessionId
    });
    if (!payment) {
      return res.status(403).json({ message: 'Exam fee not paid.' });
    }

    const admitCard = await AdmitCard.create({
      studentId,
      examId,
      rollNumber,
      examCenter,
      sessionId,
      schoolId,
      createdBy: userId,
    });
    res.status(201).json(admitCard);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: 'Admit card already exists for this student, exam, session, and school.' });
    }
    res.status(500).json({ message: err.message });
  }
};

const getMyAdmitCard = async (req, res) => {
  try {
    const { schoolId, sessionId, _id: userId, role } = req.user;
    const { examId } = req.query;

    let studentIds = [];

    if (role === 'STUDENT') {
      // Fetch Student document to get studentId
      const Student = require('../models/Student.js');
      const student = await Student.findOne({ userId, schoolId, sessionId });
      if (!student) {
        return res.status(404).json({ message: 'Student profile not found.' });
      }
      studentIds = [student._id];
    } else if (role === 'PARENT') {
      // Fetch Parent profile to get children studentIds
      const Parent = require('../models/Parent.js');
      const parent = await Parent.findOne({ userId, schoolId });
      if (!parent || !parent.children || parent.children.length === 0) {
        return res.status(404).json({ message: 'Parent profile not found or no children associated.' });
      }
      studentIds = parent.children;
    } else {
      return res.status(403).json({ message: 'Access denied. Only students and parents can access this endpoint.' });
    }

    let admitCard;
    if (examId) {
      // If examId is provided, find specific admit card for the student(s)
      admitCard = await AdmitCard.findOne({ studentId: { $in: studentIds }, examId, schoolId, sessionId })
        .populate('studentId', 'name rollNumber')
        .populate('examId', 'name');
    } else {
      // If no examId, fetch the latest admit card for the student(s)
      admitCard = await AdmitCard.findOne({ studentId: { $in: studentIds }, schoolId, sessionId })
        .populate('studentId', 'name rollNumber')
        .populate('examId', 'name')
        .sort({ createdAt: -1 }); // Get the most recent one
    }

    if (!admitCard) {
      return res.status(404).json({ message: 'Admit card not found.' });
    }
    res.json(admitCard);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getAdmitCardPDF = async (req, res) => {
  try {
    const { id } = req.params;
    const admitCard = await AdmitCard.findById(id)
      .populate('studentId', 'name rollNumber')
      .populate('examId', 'name')
      .populate('schoolId', 'name address phone email');

    if (!admitCard) {
      return res.status(404).json({ message: 'Admit card not found.' });
    }

    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ size: 'A4', margin: 50 });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=admit-card-${admitCard.studentId.rollNumber}.pdf`);

    doc.pipe(res);

    // School Header
    const school = admitCard.schoolId;
    doc.fontSize(20).font('Helvetica-Bold').text(school.name, { align: 'center' });
    doc.fontSize(12).font('Helvetica').text(`${school.address}`, { align: 'center' });
    doc.text(`${school.phone} | ${school.email}`, { align: 'center' });
    doc.moveDown(2);

    // Title
    doc.fontSize(24).font('Helvetica-Bold').text('ADMIT CARD', { align: 'center' });
    doc.moveDown(2);

    // Admit Card Details
    doc.fontSize(14).font('Helvetica-Bold').text('Student Details:', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(12).font('Helvetica');
    doc.text(`Name: ${admitCard.studentId.name}`);
    doc.text(`Roll Number: ${admitCard.rollNumber}`);
    doc.text(`Exam: ${admitCard.examId.name}`);
    doc.text(`Exam Center: ${admitCard.examCenter}`);
    doc.text(`Generated At: ${admitCard.createdAt.toDateString()}`);

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

module.exports = { generateAdmitCard, getMyAdmitCard, getAdmitCardPDF };
