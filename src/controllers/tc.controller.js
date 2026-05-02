const mongoose = require('mongoose');
const TC = require('../models/TC.js');
const Student = require('../models/Student.js');
const AcademicHistory = require('../models/AcademicHistory.js');
const Parent = require('../models/Parent.js');
const School = require('../models/School.js');
const PDFDocument = require('pdfkit');

const handleError = (res, err, context = 'TC Request') => {
  if (err.name === 'CastError') {
    return res.status(400).json({
      success: false,
      message: `Invalid ID format: ${err.path}`,
    });
  }
  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors || {})
      .map((entry) => entry.message)
      .join(', ');
    return res.status(422).json({
      success: false,
      message: `Validation failed: ${messages}`,
    });
  }
  if (err.code === 11000) {
    return res.status(409).json({
      success: false,
      message: 'TC already issued for this student',
    });
  }
  console.error(`${context} error:`, err.message);
  return res.status(500).json({
    success: false,
    message: 'Internal server error. Please try again later.',
    error: err.message,
  });
};

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

const _safeDate = (value) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime())
    ? date.toLocaleDateString('en-IN')
    : '....................';
};

const issueTC = async (req, res) => {
  try {
    const { studentId, reason, issueDate } = req.body;
    const { role, schoolId } = req.user;

    if (!studentId) {
      return res.status(400).json({ success: false, message: 'studentId is required' });
    }
    if (!mongoose.Types.ObjectId.isValid(studentId)) {
      return res.status(400).json({ success: false, message: 'Invalid studentId format' });
    }
    if (!reason || !reason.trim()) {
      return res.status(400).json({ success: false, message: 'Reason is required' });
    }
    if (!issueDate) {
      return res.status(400).json({ success: false, message: 'issueDate is required' });
    }

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
    return res.status(201).json({ success: true, data: tc });
  } catch (err) {
    return handleError(res, err, 'Issue TC');
  }
};

const getStudentTC = async (req, res) => {
  try {
    const { studentId } = req.params;
    const { schoolId, role } = req.user;

    if (!mongoose.Types.ObjectId.isValid(studentId)) {
      return res.status(400).json({ success: false, message: 'Invalid studentId format' });
    }

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

    const tc = await TC.findOne({ studentId, schoolId })
      .populate({
        path: 'studentId',
        populate: [
          { path: 'userId', select: 'name dateOfBirth address' },
          { path: 'classId', select: 'name' },
          { path: 'sectionId', select: 'name' },
        ],
      })
      .populate('lastClassId', 'name');
    if (!tc) {
      return res.status(404).json({ message: 'TC not found' });
    }

    return res.json({ success: true, data: tc });
  } catch (err) {
    return handleError(res, err, 'Get TC');
  }
};

const getStudentsWithTC = async (req, res) => {
  try {
    const { schoolId } = req.user;

    const tcs = await TC.find({ schoolId })
      .populate({
        path: 'studentId',
        populate: [
          { path: 'userId', select: 'name' },
          { path: 'classId', select: 'name' },
          { path: 'sectionId', select: 'name' },
        ],
        select: 'name rollNumber classId sectionId userId status',
      })
      .select('studentId tcNumber issueDate reason')
      .sort({ createdAt: -1 });

    const students = tcs
      .filter((tc) => tc.studentId != null)
      .map((tc) => {
        const student = tc.studentId;
        return {
          _id: student._id,
          name: student.name,
          rollNumber: student.rollNumber,
          classId: student.classId,
          sectionId: student.sectionId,
          userId: student.userId,
          status: student.status,
          tcNumber: tc.tcNumber,
        };
      });

    return res.json({ success: true, data: students });
  } catch (err) {
    return handleError(res, err, 'Get students with TC');
  }
};

const downloadTCPDF = async (req, res) => {
  try {
    const { studentId } = req.params;
    const { schoolId, role } = req.user;

    if (!mongoose.Types.ObjectId.isValid(studentId)) {
      return res.status(400).json({ success: false, message: 'Invalid studentId format' });
    }

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

    const student = await Student.findById(studentId)
      .populate('classId', 'name')
      .populate('sectionId', 'name')
      .populate('userId', 'name dateOfBirth address');
    const school = await School.findById(schoolId);

    const studentName = student?.userId?.name || student?.name || 'N/A';
    const className = student?.classId?.name || 'N/A';
    const rollNumber = student?.rollNumber || 'N/A';
    const issueDate = tc.issueDate
      ? new Date(tc.issueDate).toLocaleDateString('en-GB')
      : new Date().toLocaleDateString('en-GB');
    const admissionDate = student?.createdAt
      ? new Date(student.createdAt).toLocaleDateString('en-GB')
      : 'N/A';
    const dob = student?.userId?.dateOfBirth
      ? new Date(student.userId.dateOfBirth).toLocaleDateString('en-GB')
      : 'N/A';

    const schoolName = school?.name || 'School';
    const schoolAddress = school?.address || '';
    const schoolCode = school?.code || '....................';

    const doc = new PDFDocument({
      size: 'A4',
      margin: 50,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=TC-${studentName.replace(/\s+/g, '_')}.pdf`,
    );

    doc.pipe(res);

    doc.rect(30, 30, doc.page.width - 60, doc.page.height - 60)
      .lineWidth(2)
      .stroke('#1a5c1a');

    doc.save();
    doc.rotate(-35, { origin: [doc.page.width / 2, doc.page.height / 2] });
    doc.fillColor('#dbe7db')
      .fontSize(42)
      .font('Helvetica-Bold')
      .text('TRANSFER CERTIFICATE', -10, doc.page.height / 2 - 20, {
        align: 'center',
        width: doc.page.width + 20,
      });
    doc.restore();

    doc.fillColor('#1a5c1a')
      .fontSize(22)
      .font('Helvetica-Bold')
      .text(schoolName.toUpperCase(), 50, 50, { align: 'center' });

    doc.fillColor('#1a1a1a')
      .fontSize(10)
      .font('Helvetica-Bold')
      .text('(Affiliated to CBSE, New Delhi)', 50, 78, { align: 'center' });

    doc.font('Helvetica-Bold')
      .fontSize(10)
      .text(schoolAddress || 'School Address', 50, 92, { align: 'center' });

    doc.font('Helvetica')
      .fontSize(9)
      .text(`School Code: ${schoolCode}`, 50, 106, { align: 'center' });

    doc.circle(doc.page.width / 2, 145, 28).lineWidth(1.5).stroke('#1a5c1a');
    doc.font('Helvetica-Bold')
      .fontSize(8)
      .fillColor('#1a5c1a')
      .text('SCHOOL', doc.page.width / 2 - 18, 138, { width: 36, align: 'center' })
      .text('SEAL', doc.page.width / 2 - 18, 148, { width: 36, align: 'center' });

    doc.font('Helvetica')
      .fontSize(11)
      .fillColor('#1a1a1a')
      .text(`Sl. No. ${tc.tcNumber}`, 55, 125)
      .text(`Date: ${issueDate}`, 0, 125, { align: 'right', width: doc.page.width - 100 });

    const boxTop = 182;
    doc.rect(100, boxTop, doc.page.width - 200, 26)
      .lineWidth(1.5)
      .stroke('#000');

    doc.fillColor('#000')
      .fontSize(14)
      .font('Helvetica-Bold')
      .text('TRANSFER/SCHOOL LEAVING CERTIFICATE', 105, boxTop + 6, {
        align: 'center',
        width: doc.page.width - 210,
      });

    let y = boxTop + 40;
    const lh = 24;
    const dots = (n = 30) => '.'.repeat(n);

    doc.font('Helvetica').fontSize(11).fillColor('#1a1a1a');

    doc.text(`This is to certify that Shri/Miss ${studentName.padEnd(40, '.')}`, 55, y); y += lh;
    doc.text(`Son/Daughter of ${dots(50)} of`, 55, y); y += lh;
    doc.text(`Village/Town ${dots(20)} of District ${dots(20)} State ${dots(10)}`, 55, y); y += lh;
    doc.text(`was admitted to the School on ${admissionDate.padEnd(20, '.')} and left on ${issueDate.padEnd(20, '.')}`, 55, y); y += lh;
    doc.text(`He/She was reading in class ${className.padEnd(30, '.')} (in words) and passed to class/detained in`, 55, y); y += lh;
    doc.text(`Class ${dots(40)} (in words).`, 55, y); y += lh;

    doc.font('Helvetica-Bold')
      .text('He/She passed/failed in the All India Senior Secondary School Examination/All India Secondary school Examination held in ............20.... under the Central board of Secondary Education, New Delhi.', 55, y, {
        width: doc.page.width - 110,
      });
    y += lh * 3;

    doc.font('Helvetica').text('           All the dues are cleared.', 55, y); y += lh;
    doc.text(`           His/Her date of birth according to our Admission Register is ${dob.padEnd(25, '.')}`, 55, y); y += lh;
    doc.text(`(in words) ${dots(60)}`, 55, y); y += lh;
    doc.text('           His/her character and conduct were satisfactory/not satisfactory.', 55, y); y += lh * 1.5;

    doc.font('Helvetica-Bold').text('Reasons for leaving School: -', 55, y); y += lh;
    doc.font('Helvetica').text('1. Unavoidable change of residence.', 55, y); y += lh - 4;
    doc.text('2. Ill Health.', 55, y); y += lh - 4;
    doc.text('3. Completion of School Course.', 55, y); y += lh - 4;
    doc.text('4. Minor reasons.', 55, y); y += lh - 4;
    doc.text('5. Guardian option.', 55, y); y += lh - 4;
    doc.text(`6. Recorded reason: ${tc.reason || 'N/A'}.`, 55, y); y += lh;

    doc.text(`Date: ${dots(25)}`, 55, y); y += lh;
    doc.text(`Place: ${dots(25)}`, 55, y);

    const signY = y - lh;
    doc.font('Helvetica-Bold').text('Principal', 0, signY, { align: 'right', width: doc.page.width - 60 });
    doc.font('Helvetica').text(schoolName, 0, signY + lh, { align: 'right', width: doc.page.width - 60 });
    doc.text(schoolAddress.split(',')[0] || '', 0, signY + (lh * 2), { align: 'right', width: doc.page.width - 60 });

    doc.font('Helvetica').fontSize(10)
      .text(`Student: ${studentName} | Roll No: ${rollNumber}`, 55, doc.page.height - 70);

    doc.end();
  } catch (err) {
    return handleError(res, err, 'Download TC PDF');
  }
};

module.exports = { issueTC, getStudentTC, downloadTCPDF, getStudentsWithTC };
