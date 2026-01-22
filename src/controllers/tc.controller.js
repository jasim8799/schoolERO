const TC = require('../models/TC.js');
const Student = require('../models/Student.js');
const AcademicHistory = require('../models/AcademicHistory.js');
const Parent = require('../models/Parent.js');
const School = require('../models/School.js');
const PDFDocument = require('pdfkit');

const issueTC = async (req, res) => {
  try {
    const { studentId, reason, issueDate } = req.body;
    const { role, schoolId } = req.user;

    if (role !== 'PRINCIPAL' && role !== 'OPERATOR') {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const student = await Student.findOne({ _id: studentId, schoolId });
    if (!student) {
      return res.status(404).json({ message: 'Student not found' });
    }

    if (student.status !== 'ACTIVE') {
      return res.status(400).json({ message: 'Student is not active' });
    }

    // Generate unique tcNumber school-wise
    const count = await TC.countDocuments({ schoolId });
    const tcNumber = `TC-${schoolId}-${count + 1}`;

    const tc = await TC.create({
      studentId,
      lastClassId: student.classId,
      reason,
      issueDate,
      tcNumber,
      schoolId
    });

    await Student.findByIdAndUpdate(studentId, { status: 'LEFT' });

    await AcademicHistory.create({
      studentId,
      sessionId: student.sessionId,
      classId: student.classId,
      sectionId: student.sectionId,
      rollNumber: student.rollNumber,
      status: 'Left',
      schoolId
    });

    res.status(201).json(tc);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getStudentTC = async (req, res) => {
  try {
    const { studentId } = req.params;
    const { schoolId, role, studentId: loggedStudentId } = req.user;

    if (role === 'STUDENT') {
      const student = await Student.findOne({ userId: req.user._id, schoolId });
      if (!student || student._id.toString() !== studentId) {
        return res.status(403).json({ message: 'Access denied' });
      }
    } else if (role === 'PARENT') {
      const parent = await Parent.findOne({ userId: req.user._id, schoolId });
      if (!parent || !parent.children.some(id => id.toString() === studentId)) {
        return res.status(403).json({ message: 'Access denied' });
      }
    }
    // For PRINCIPAL/OPERATOR, no restriction

    const tc = await TC.findOne({ studentId, schoolId });
    if (!tc) {
      return res.status(404).json({ message: 'TC not found' });
    }

    res.json(tc);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const downloadTCPDF = async (req, res) => {
  try {
    const { studentId } = req.params;
    const { schoolId, role } = req.user;

    if (role === 'STUDENT') {
      const student = await Student.findOne({ userId: req.user._id, schoolId });
      if (!student || student._id.toString() !== studentId) {
        return res.status(403).json({ message: 'Access denied' });
      }
    } else if (role === 'PARENT') {
      const parent = await Parent.findOne({ userId: req.user._id, schoolId });
      if (!parent || !parent.children.some(id => id.toString() === studentId)) {
        return res.status(403).json({ message: 'Access denied' });
      }
    }
    // For PRINCIPAL/OPERATOR, no restriction

    const tc = await TC.findOne({ studentId, schoolId });
    if (!tc) {
      return res.status(404).json({ message: 'TC not found' });
    }

    const student = await Student.findById(studentId).populate('classId sectionId');
    const school = await School.findById(schoolId);

    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=TC-${student.name}.pdf`);
    doc.pipe(res);

    doc.fontSize(20).text(school.name, { align: 'center' });
    doc.moveDown();
    doc.fontSize(24).text('TRANSFER CERTIFICATE', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text(`TC Number: ${tc.tcNumber}`);
    doc.text(`Issue Date: ${new Date(tc.issueDate).toDateString()}`);
    doc.text(`Student Name: ${student.name}`);
    doc.text(`Roll Number: ${student.rollNumber}`);
    doc.text(`Class: ${student.classId.name}`);
    doc.text(`Section: ${student.sectionId.name}`);
    doc.text(`Reason for leaving: ${tc.reason}`);
    doc.moveDown();
    doc.text('Signature: ____________________', { align: 'right' });

    doc.end();
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = { issueTC, getStudentTC, downloadTCPDF };
