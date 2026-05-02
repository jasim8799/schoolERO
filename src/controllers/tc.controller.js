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

    // -- Role checks -------------------------------------------------
    if (role === 'STUDENT') {
      const student = await Student.findOne({ userId: req.user._id, schoolId });
      if (!student || student._id.toString() !== studentId) {
        return res.status(403).json({ message: 'Access denied' });
      }
    } else if (role === 'PARENT') {
      const parent = await Parent.findOne({ userId: req.user._id, schoolId });
      if (!parent || !parent.children.some((id) => id.toString() === studentId)) {
        return res.status(403).json({ message: 'Access denied' });
      }
    }

    // -- Fetch records -----------------------------------------------
    const tc = await TC.findOne({ studentId, schoolId });
    if (!tc) return res.status(404).json({ message: 'TC not found' });

    const student = await Student.findById(studentId)
      .populate('classId', 'name')
      .populate('sectionId', 'name')
      .populate('userId', 'name dateOfBirth address');

    const school = await School.findById(schoolId);

    // -- Extract values ----------------------------------------------
    const studentName = student?.userId?.name || student?.name || 'N/A';
    const className = student?.classId?.name || 'N/A';
    const sectionName = student?.sectionId?.name || '';
    const schoolName = school?.name || 'School';
    const schoolAddr = school?.address || '';
    const schoolCode = school?.code || '';

    const fmt = (d) => (d
      ? new Date(d).toLocaleDateString('en-IN', {
        day: '2-digit', month: '2-digit', year: 'numeric',
      })
      : '..........................');

    const admissionDate = fmt(student?.createdAt);
    const leaveDate = fmt(tc.issueDate);
    const dob = fmt(student?.userId?.dateOfBirth);

    // -- PDF Setup ---------------------------------------------------
    const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: true });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition',
      `attachment; filename=TC_${studentName.replace(/\s+/g, '_')}.pdf`);
    doc.pipe(res);

    const PW = doc.page.width;
    const PH = doc.page.height;
    const ML = 45;
    const MR = 45;
    const TW = PW - ML - MR;

    // -- Double page border ------------------------------------------
    doc.rect(18, 18, PW - 36, PH - 36)
      .lineWidth(3).strokeColor('#1a6b1a').stroke();
    doc.rect(23, 23, PW - 46, PH - 46)
      .lineWidth(1).strokeColor('#1a6b1a').stroke();

    // -- School Name -------------------------------------------------
    let y = 34;
    doc.font('Helvetica-Bold').fontSize(22)
      .fillColor('#1a6b1a')
      .text(schoolName.toUpperCase(), ML, y, {
        width: TW, align: 'center',
      });
    y += 28;

    // -- Affiliation -------------------------------------------------
    doc.font('Helvetica-Bold').fontSize(10)
      .fillColor('#111111')
      .text('(Affiliated to CBSE, New Delhi, No.230149)', ML, y, {
        width: TW, align: 'center',
      });
    y += 14;

    // -- Address -----------------------------------------------------
    const displayAddr = schoolAddr
      || 'SCHOOL ADDRESS, DISTRICT, STATE';
    doc.font('Helvetica-Bold').fontSize(10)
      .text(displayAddr.toUpperCase(), ML, y, {
        width: TW, align: 'center',
      });
    y += 14;

    // -- School Code -------------------------------------------------
    if (schoolCode) {
      doc.font('Helvetica-Bold').fontSize(10)
        .text(`School Code-${schoolCode}`, ML, y, {
          width: TW, align: 'center',
        });
      y += 14;
    }
    y += 4;

    // -- Sl. No. and Date row ----------------------------------------
    // Left: Sl.No with TC number in red
    doc.font('Helvetica').fontSize(11).fillColor('#111111')
      .text('Sl. No.', ML, y, { continued: false });
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#cc0000')
      .text(tc.tcNumber, ML + 38, y - 12, { continued: false });
    doc.font('Helvetica').fontSize(11).fillColor('#111111')
      .text('....................', ML + 38, y);

    // Right: Date
    doc.font('Helvetica').fontSize(11).fillColor('#111111')
      .text('Date............................', PW - MR - 160, y);
    y += 22;

    // -- Circular Seal (centered) ------------------------------------
    const cx = PW / 2;
    const cy = y + 38;
    // Outer ring
    doc.circle(cx, cy, 38).lineWidth(2.5)
      .strokeColor('#1a6b1a').stroke();
    // Inner ring
    doc.circle(cx, cy, 32).lineWidth(1)
      .strokeColor('#1a6b1a').stroke();
    // School initials inside
    const initials = schoolName.split(' ')
      .filter((w) => w.length > 2)
      .map((w) => w[0]).join('').slice(0, 4);
    doc.font('Helvetica-Bold').fontSize(14)
      .fillColor('#1a6b1a')
      .text(initials || 'SC', cx - 16, cy - 10, {
        width: 32, align: 'center',
      });
    doc.font('Helvetica').fontSize(6).fillColor('#1a6b1a')
      .text('ESTD.', cx - 14, cy + 6, { width: 28, align: 'center' });
    y += 84;

    // -- Title Box ---------------------------------------------------
    const boxW = 370;
    const boxX = (PW - boxW) / 2;
    const boxH = 28;
    doc.rect(boxX, y, boxW, boxH)
      .lineWidth(1.5).strokeColor('#111111').stroke();
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#111111')
      .text('TRANSFER/SCHOOL LEAVING CERTIFICATE',
        boxX + 6, y + 8, {
          width: boxW - 12, align: 'center',
          lineBreak: false,
        });
    y += boxH + 16;

    // -- Body helpers ------------------------------------------------
    const LH = 22;
    const BS = 11;
    const IND = 60;

    // Normal bold body line
    const bline = (text, indent) => {
      const x = ML + (indent || 0);
      const w = TW - (indent || 0);
      doc.font('Helvetica-Bold').fontSize(BS)
        .fillColor('#111111')
        .text(text, x, y, { width: w, lineBreak: false });
      y += LH;
    };

    // dots helper
    const d = (n) => '.'.repeat(n);

    // -- Certificate body --------------------------------------------

    // Line 1: Student name
    doc.font('Helvetica-Bold').fontSize(BS).fillColor('#111111')
      .text('This is to certify that Shri/Miss ', ML, y, {
        continued: true, lineBreak: false,
      });
    doc.text(`${studentName}${d(30)}`, { lineBreak: false });
    y += LH;

    // Line 2
    bline(`Son/Daughter of Shri/Late${d(52)} of`);

    // Line 3
    bline(`Village/Town${d(32)}of District${d(22)}State${d(12)}`);

    // Line 4: Admission and leave dates
    doc.font('Helvetica-Bold').fontSize(BS).fillColor('#111111')
      .text('was admitted to the School on ', ML, y, {
        continued: true, lineBreak: false,
      });
    doc.text(`${admissionDate}`, { continued: true, lineBreak: false });
    doc.text(' and left on ', { continued: true, lineBreak: false });
    doc.text(`${leaveDate}`, { lineBreak: false });
    y += LH;

    // Line 5: Class
    doc.font('Helvetica-Bold').fontSize(BS).fillColor('#111111')
      .text('He/She was reading in class ', ML, y, {
        continued: true, lineBreak: false,
      });
    doc.text(
      `${className}${sectionName ? ` (${sectionName})` : ''}`,
      { continued: true, lineBreak: false },
    );
    doc.text(' (in words) and passed to class/detained in',
      { lineBreak: false });
    y += LH;

    // Line 6
    bline(`Class${d(42)} (in words).`);

    y += 6;

    // Exam paragraph - multi-line justified bold
    const examText =
      'He/She passed/failed in the All India Senior Secondary School '
      + 'Examination/All India Secondary school Examination held in'
      + `${d(20)}20${d(6)} under the Central board of Secondary `
      + 'Education, New Delhi.';
    doc.font('Helvetica-Bold').fontSize(BS).fillColor('#111111')
      .text(examText, ML, y, {
        width: TW,
        align: 'justify',
        lineBreak: true,
      });
    y += doc.heightOfString(examText, {
      width: TW, align: 'justify',
    }) + 8;

    // Indented lines
    bline('All the dues are cleared.', IND);

    doc.font('Helvetica-Bold').fontSize(BS).fillColor('#111111')
      .text(
        `His/Her date of birth according to our Admission Register is ${dob}${d(10)}`,
        ML + IND, y, { width: TW - IND, lineBreak: false },
      );
    y += LH;

    bline(`(in words) ${d(58)}`);

    bline(
      'His/her character and conduct were satisfactory/not satisfactory.',
      IND,
    );

    y += 6;

    // -- Reasons -----------------------------------------------------
    doc.font('Helvetica-Bold').fontSize(BS).fillColor('#111111')
      .text('Reasons for leaving School: -', ML, y, {
        underline: true, lineBreak: false,
      });
    y += LH;

    const reasons = [
      '1. Unavoidable change of residence.',
      '2. Ill Health.',
      '3. Completion of School Course.',
      '4. Minor reasons.',
      '5. Guardian option.',
    ];
    for (const r of reasons) {
      doc.font('Helvetica-Bold').fontSize(BS).fillColor('#111111')
        .text(r, ML, y, { lineBreak: false });
      y += LH - 3;
    }

    y += 4;

    // -- Date / Place (left) -----------------------------------------
    doc.font('Helvetica-Bold').fontSize(BS).fillColor('#111111')
      .text(`Date:${d(27)}`, ML, y, { lineBreak: false });
    y += LH;
    doc.font('Helvetica-Bold').fontSize(BS)
      .text(`Place:${d(26)}`, ML, y, { lineBreak: false });

    // -- Principal (right, aligned with Date line) -------------------
    const sigY = y - LH;
    const sigX = PW - MR - 170;
    doc.font('Helvetica-Bold').fontSize(BS).fillColor('#111111')
      .text('Principal', sigX, sigY, { width: 170, align: 'center' });
    doc.font('Helvetica-Bold').fontSize(BS)
      .text(schoolName, sigX, sigY + LH, { width: 170, align: 'center' });
    const city = schoolAddr.split(',')[0]?.trim() || '';
    if (city) {
      doc.font('Helvetica-Bold').fontSize(BS)
        .text(city, sigX, sigY + LH * 2, { width: 170, align: 'center' });
    }

    doc.end();
  } catch (err) {
    console.error('TC PDF error:', err);
    if (!res.headersSent) {
      res.status(500).json({ message: err.message });
    }
  }
};

module.exports = { issueTC, getStudentTC, downloadTCPDF, getStudentsWithTC };
