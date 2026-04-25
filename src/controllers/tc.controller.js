const TC = require('../models/TC.js');
const Student = require('../models/Student.js');
const AcademicHistory = require('../models/AcademicHistory.js');
const Parent = require('../models/Parent.js');
const School = require('../models/School.js');
const PDFDocument = require('pdfkit');

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
      schoolId,
      sessionId: student.sessionId,
      issuedBy: req.user._id || req.user.userId
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

    _audit('TC_ISSUED', 'TC', student._id,
      `TC issued for student ${student.name}`, {}, req);
    res.status(201).json({ success: true, data: tc });
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

    res.json({ success: true, data: tc });
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
