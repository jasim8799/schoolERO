const AdmitCard = require('../models/AdmitCard.js');
const ExamPayment = require('../models/ExamPayment.js');
const ExamForm = require('../models/ExamForm.js');

const _ip = (req) =>
  req.headers['x-forwarded-for']?.split(',')[0]?.trim()
  || req.socket?.remoteAddress || req.ip || '0.0.0.0';

const _audit = async (action, entityType, entityId, desc, details, req) => {
  try {
    const { auditLog } = require('../utils/auditLog');
    await auditLog({
      action, entityType, entityId,
      userId: req.user?._id,
      schoolId: req.user?.schoolId,
      description: desc,
      details,
      ipAddress: _ip(req),
      role: req.user?.role || 'SYSTEM',
    });
  } catch (_) {}
};

const sessionFilter = (req) => {
  const sid = req.user?.sessionId;
  if (!sid) return {};
  return {
    $or: [
      { sessionId: sid },
      { sessionId: null },
      { sessionId: { $exists: false } },
    ],
  };
};

const generateAdmitCard = async (req, res) => {
  try {
    const {
      studentId, examId, rollNumber, examCenter,
      centerNumber, schoolNumber, admitCardId, shift,
      skipPaymentCheck
    } = req.body;
    const { schoolId, sessionId, _id: userId } = req.user;

    if (!skipPaymentCheck) {
      const examForm = await ExamForm.findOne({ examId, schoolId, sessionId });
      if (examForm) {
        const payment = await ExamPayment.findOne({
          studentId,
          examFormId: examForm._id,
          status: 'Paid',
          schoolId,
          sessionId
        });
        if (!payment) {
          return res.status(403).json({
            success: false,
            message: 'Exam fee not paid for this student. Use "Skip Payment Check" to generate anyway.'
          });
        }
      }
    }

    const admitCard = await AdmitCard.create({
      studentId,
      examId,
      rollNumber,
      examCenter: examCenter || '',
      centerNumber: centerNumber || '',
      schoolNumber: schoolNumber || '',
      admitCardId: admitCardId || `AC${Date.now().toString().slice(-8)}`,
      shift: shift || 'Morning',
      sessionId,
      schoolId,
      createdBy: userId,
    });

    _audit('ADMIT_CARD_GENERATED', 'ADMIT_CARD', admitCard._id,
      `Admit card generated`, { examId }, req);

    res.status(201).json({ success: true, data: admitCard });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'Admit card already exists for this student and exam.'
      });
    }
    res.status(500).json({ success: false, message: err.message });
  }
};

const getMyAdmitCard = async (req, res) => {
  try {
    const { schoolId, _id: userId, role } = req.user;
    const { examId } = req.query;

    let studentIds = [];

    if (role === 'STUDENT') {
      // Fetch Student document to get studentId
      const Student = require('../models/Student.js');
      const studentQuery = { userId, schoolId };
      const student = await Student.findOne(studentQuery);
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
    const filter = { studentId: { $in: studentIds }, schoolId, ...sessionFilter(req) };
    if (examId) {
      // If examId is provided, find specific admit card for the student(s)
      admitCard = await AdmitCard.findOne({ ...filter, examId })
        .populate({
          path: 'studentId',
          select: 'name rollNumber dateOfBirth photoBase64 fatherName motherName',
          populate: { path: 'userId', select: 'name' }
        })
        .populate({
          path: 'examId',
          select: 'name startDate endDate subjects classId',
          populate: [
            { path: 'subjects.subjectId', select: 'name code' },
            { path: 'classId', select: 'name' }
          ]
        })
        .populate('schoolId', 'name address phone logoBase64');
    } else {
      // If no examId, fetch the latest admit card for the student(s)
      admitCard = await AdmitCard.findOne(filter)
        .populate({
          path: 'studentId',
          select: 'name rollNumber dateOfBirth photoBase64 fatherName motherName',
          populate: { path: 'userId', select: 'name' }
        })
        .populate({
          path: 'examId',
          select: 'name startDate endDate subjects classId',
          populate: [
            { path: 'subjects.subjectId', select: 'name code' },
            { path: 'classId', select: 'name' }
          ]
        })
        .populate('schoolId', 'name address phone logoBase64')
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
    const { schoolId } = req.user;
    const admitCard = await AdmitCard.findOne({ _id: id, schoolId, ...sessionFilter(req) })
      .populate({
        path: 'studentId',
        select: 'name rollNumber dateOfBirth photoBase64 fatherName motherName',
      })
      .populate({
        path: 'examId',
        select: 'name startDate endDate subjects classId',
        populate: [
          { path: 'subjects.subjectId', select: 'name code' },
          { path: 'classId', select: 'name' }
        ]
      })
      .populate('schoolId', 'name address phone email logoBase64');

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

// GET /api/admit-cards/exam/:examId  (PRINCIPAL / OPERATOR)
const getAdmitCardsByExam = async (req, res) => {
  try {
    const { examId } = req.params;
    const { schoolId } = req.user;

    const filter = { examId, schoolId, ...sessionFilter(req) };

    const cards = await AdmitCard.find(filter)
      .populate({
        path: 'studentId',
        select: 'name rollNumber dateOfBirth photoBase64 fatherName motherName',
        populate: { path: 'userId', select: 'name' }
      })
      .populate({
        path: 'examId',
        select: 'name startDate endDate subjects classId',
        populate: [
          { path: 'subjects.subjectId', select: 'name code' },
          { path: 'classId', select: 'name' }
        ]
      })
      .populate('schoolId', 'name address phone logoBase64')
      .sort({ createdAt: -1 });

    res.json({ success: true, data: cards });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/admit-cards/student/me/:examId  (STUDENT / PARENT)
const getMyAdmitCardByExamId = async (req, res) => {
  try {
    const { examId } = req.params;
    const { schoolId, _id: userId, role } = req.user;

    const Exam = require('../models/Exam.js');
    const exam = await Exam.findOne({ _id: examId, schoolId, ...sessionFilter(req) });
    if (!exam) {
      return res.status(404).json({ success: false, message: 'Exam not found' });
    }
    if (!exam.isAdmitCardPublished) {
      return res.status(403).json({
        success: false,
        message: 'Admit cards have not been released yet. Please check back later.'
      });
    }

    let studentIds = [];

    if (role === 'STUDENT') {
      const Student = require('../models/Student.js');
      const studentQuery = { userId, schoolId };
      const student = await Student.findOne(studentQuery);
      if (!student) {
        return res.status(404).json({ success: false, message: 'Student profile not found.' });
      }
      studentIds = [student._id];
    } else if (role === 'PARENT') {
      const Parent = require('../models/Parent.js');
      const parent = await Parent.findOne({ userId, schoolId });
      if (!parent || !parent.children || parent.children.length === 0) {
        return res.status(404).json({ success: false, message: 'Parent profile not found or no children associated.' });
      }
      studentIds = parent.children;
    } else {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    const filter = { studentId: { $in: studentIds }, examId, schoolId, ...sessionFilter(req) };

    const card = await AdmitCard.findOne(filter)
      .populate({
        path: 'studentId',
        select: 'name rollNumber dateOfBirth photoBase64 fatherName motherName',
        populate: { path: 'userId', select: 'name' }
      })
      .populate({
        path: 'examId',
        select: 'name startDate endDate subjects classId',
        populate: [
          { path: 'subjects.subjectId', select: 'name code' },
          { path: 'classId', select: 'name' }
        ]
      })
      .populate('schoolId', 'name address phone logoBase64');

    res.json({ success: true, data: card || null });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { generateAdmitCard, getMyAdmitCard, getAdmitCardPDF, getAdmitCardsByExam, getMyAdmitCardByExamId };
