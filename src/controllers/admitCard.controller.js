const AdmitCard = require('../models/AdmitCard.js');
const ExamPayment = require('../models/ExamPayment.js');
const ExamForm = require('../models/ExamForm.js');
const ExamSubject = require('../models/ExamSubject.js');
const Admission = require('../models/Admission.js');
const Student = require('../models/Student.js');

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

// ── Helper: enrich admit cards with photo + parent + subjects ─────────────
const _enrichCards = async (cards, schoolId) => {
  const isArray = Array.isArray(cards);
  const list = isArray ? cards : [cards];
  if (!list.length) return isArray ? [] : null;

  const enriched = await Promise.all(list.map(async (card) => {
    const obj = card.toObject ? card.toObject() : { ...card };
    const studentId = obj.studentId?._id || obj.studentId;
    const examId = obj.examId?._id || obj.examId;

    // ── 1. Fetch photo from Admission ────────────────────────────────────
    try {
      const admission = await Admission.findOne({ studentId, schoolId })
        .select('+documents.photo.dataUrl documents.photo.fileName');
      if (admission?.documents?.photo?.dataUrl) {
        // Strip data URL prefix if present (we want raw base64)
        const raw = admission.documents.photo.dataUrl;
        const base64 = raw.includes(',') ? raw.split(',')[1] : raw;
        if (obj.studentId && typeof obj.studentId === 'object') {
          obj.studentId.photoBase64 = base64;
        } else {
          obj.photoBase64 = base64;
        }
      }
    } catch (_) {}

    // ── 2. Fetch parent name as guardian name ────────────────────────────
    try {
      const Parent = require('../models/Parent.js');
      const student = obj.studentId && typeof obj.studentId === 'object'
        ? obj.studentId
        : await Student.findById(studentId).select('parentId').lean();

      if (student?.parentId) {
        const parent = await Parent.findById(student.parentId)
          .populate('userId', 'name').lean();
        if (parent?.userId?.name) {
          if (obj.studentId && typeof obj.studentId === 'object') {
            obj.studentId.guardianName = parent.userId.name;
            // Use as fatherName for display
            if (!obj.studentId.fatherName) {
              obj.studentId.fatherName = parent.userId.name;
            }
          }
        }
      }
    } catch (_) {}

    // ── 3. Fetch subjects from ExamSubject collection ─────────────────────
    try {
      const subjects = await ExamSubject.find({ examId, schoolId })
        .populate('subjectId', 'name code')
        .lean();

      const subjectList = subjects.map((s) => ({
        subjectId: s.subjectId,
        subjectName: s.subjectId?.name || '',
        subjectCode: s.subjectId?.code || '',
        examDate: s.examDate,
        maxMarks: s.maxMarks,
        passMarks: s.passMarks,
      }));

      // Inject into examId object
      if (obj.examId && typeof obj.examId === 'object') {
        obj.examId.subjects = subjectList;
      } else {
        obj.subjects = subjectList;
      }
    } catch (_) {}

    // Ensure _id is always a plain string (never ObjectId or nested object)
    if (obj._id) {
      obj._id = obj._id.toString();
    }
    if (obj.studentId && typeof obj.studentId === 'object' && obj.studentId._id) {
      obj.studentId._id = obj.studentId._id.toString();
    }
    if (obj.examId && typeof obj.examId === 'object' && obj.examId._id) {
      obj.examId._id = obj.examId._id.toString();
    }
    if (obj.schoolId && typeof obj.schoolId === 'object' && obj.schoolId._id) {
      obj.schoolId._id = obj.schoolId._id.toString();
    }
    // Ensure isPublished is always present (defaults to false if missing)
    obj.isPublished = obj.isPublished === true;
    return obj;
  }));

  return isArray ? enriched : enriched[0];
};

// ── Generate single admit card ────────────────────────────────────────────
const generateAdmitCard = async (req, res) => {
  try {
    const {
      studentId, examId, examCenter,
      centerNumber, schoolNumber, admitCardId, shift,
      skipPaymentCheck
    } = req.body;
    const { schoolId, sessionId, _id: userId } = req.user;

    // Auto-fetch roll number from Student model
    const student = await Student.findOne({ _id: studentId, schoolId }).lean();
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }
    const rollNumber = student.rollNumber; // Use class roll number

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
      'Admit card generated', { examId }, req);

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

// ── Bulk generate for entire class ────────────────────────────────────────
const bulkGenerateAdmitCards = async (req, res) => {
  try {
    const { examId, skipPaymentCheck } = req.body;
    const { schoolId, sessionId, _id: userId } = req.user;

    // Get exam to find classId
    const Exam = require('../models/Exam.js');
    const exam = await Exam.findOne({ _id: examId, schoolId }).lean();
    if (!exam) {
      return res.status(404).json({ success: false, message: 'Exam not found.' });
    }

    // Get all active students in the class
    const students = await Student.find({
      classId: exam.classId,
      schoolId,
      status: 'ACTIVE',
    }).lean();

    if (!students.length) {
      return res.status(404).json({
        success: false,
        message: 'No active students found in this class.'
      });
    }

    let generated = 0;
    let skipped = 0;
    const errors = [];

    for (const student of students) {
      try {
        // Check payment if required
        if (!skipPaymentCheck) {
          const examForm = await ExamForm.findOne({ examId, schoolId, sessionId });
          if (examForm) {
            const payment = await ExamPayment.findOne({
              studentId: student._id,
              examFormId: examForm._id,
              status: 'Paid',
              schoolId,
              sessionId
            });
            if (!payment) {
              skipped++;
              continue;
            }
          }
        }

        await AdmitCard.create({
          studentId: student._id,
          examId,
          rollNumber: student.rollNumber,
          examCenter: exam.centerName || '',
          centerNumber: '',
          schoolNumber: '',
          admitCardId: `AC${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 100)}`,
          shift: 'Morning',
          sessionId,
          schoolId,
          createdBy: userId,
        });
        generated++;
      } catch (e) {
        if (e.code === 11000) {
          skipped++; // Already exists
        } else {
          errors.push({ studentId: student._id, name: student.name, error: e.message });
        }
      }
    }

    _audit('ADMIT_CARDS_BULK_GENERATED', 'ADMIT_CARD', examId,
      `Bulk admit cards generated: ${generated}`, { examId, generated, skipped }, req);

    res.status(201).json({
      success: true,
      data: { generated, skipped, errors, total: students.length }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Get all cards for exam (Principal/Operator) ───────────────────────────
const getAdmitCardsByExam = async (req, res) => {
  try {
    const { examId } = req.params;
    const { schoolId } = req.user;
    const filter = { examId, schoolId, ...sessionFilter(req) };

    const cards = await AdmitCard.find(filter)
      .populate({
        path: 'studentId',
        select: 'name rollNumber dateOfBirth classId parentId',
        strictPopulate: false,
        populate: { path: 'classId', select: 'name' }
      })
      .populate({
        path: 'examId',
        select: 'name startDate endDate classId',
        strictPopulate: false,
        populate: { path: 'classId', select: 'name' }
      })
      .populate('schoolId', 'name address phone logoBase64')
      .sort({ createdAt: -1 });

    const enriched = await _enrichCards(cards, schoolId);
    res.json({ success: true, data: enriched });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Get student's own admit card (Student/Parent) ─────────────────────────
const getMyAdmitCardByExamId = async (req, res) => {
  try {
    const { examId } = req.params;
    const { schoolId, _id: userId, role } = req.user;

    const Exam = require('../models/Exam.js');
    const exam = await Exam.findOne({ _id: examId, schoolId, ...sessionFilter(req) });
    if (!exam) {
      return res.status(404).json({ success: false, message: 'Exam not found' });
    }

    // Resolve student IDs first so we can check individual card release
    let studentIds = [];
    if (role === 'STUDENT') {
      const student = await Student.findOne({ userId, schoolId });
      if (!student) {
        return res.status(404).json({
          success: false,
          message: 'Student profile not found.'
        });
      }
      studentIds = [student._id];
    } else if (role === 'PARENT') {
      const Parent = require('../models/Parent.js');
      const parent = await Parent.findOne({ userId, schoolId });
      if (!parent?.children?.length) {
        return res.status(404).json({
          success: false,
          message: 'No children associated.'
        });
      }
      studentIds = parent.children;
    } else {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    // Allow access if either exam bulk-released OR individual card released
    const examReleased = exam.isAdmitCardPublished === true;
    if (!examReleased) {
      const individualCard = await AdmitCard.findOne({
        studentId: { $in: studentIds },
        examId,
        schoolId,
        isPublished: true,
        ...sessionFilter(req),
      }).lean();

      if (!individualCard) {
        return res.status(403).json({
          success: false,
          message: 'Admit cards have not been released yet. Please check back later.'
        });
      }
    }

    const filter = { studentId: { $in: studentIds }, examId, schoolId, ...sessionFilter(req) };
    const card = await AdmitCard.findOne(filter)
      .populate({
        path: 'studentId',
        select: 'name rollNumber dateOfBirth parentId',
        strictPopulate: false,
      })
      .populate({
        path: 'examId',
        select: 'name startDate endDate classId',
        strictPopulate: false,
        populate: { path: 'classId', select: 'name' }
      })
      .populate('schoolId', 'name address phone logoBase64');

    const enriched = card ? await _enrichCards(card, schoolId) : null;
    res.json({ success: true, data: enriched });
  } catch (err) {
    console.error('getMyAdmitCardByExamId error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Publish individual admit card ─────────────────────────────────────────
const publishAdmitCard = async (req, res) => {
  try {
    const { id } = req.params;
    const { schoolId } = req.user;

    // Debug log -- visible in Render/server logs
    console.log(`[publishAdmitCard] id=${id} schoolId=${schoolId} user=${req.user?._id} role=${req.user?.role}`);

    // Validate id looks like a MongoDB ObjectId
    if (!id || id.length !== 24) {
      console.warn(`[publishAdmitCard] Invalid card ID: "${id}"`);
      return res.status(400).json({
        success: false,
        message: `Invalid admit card ID: "${id}". Expected a 24-character MongoDB ObjectId.`
      });
    }

    const card = await AdmitCard.findOneAndUpdate(
      { _id: id, schoolId },
      { $set: { isPublished: true, publishedAt: new Date() } },
      { new: true, runValidators: false }
    );

    console.log(`[publishAdmitCard] result: ${card ? 'found+updated' : 'NOT FOUND'}`);

    if (!card) {
      // Try without schoolId filter to see if it exists at all
      const exists = await AdmitCard.findById(id).lean();
      const reason = exists
        ? `Card exists but belongs to a different school (card.schoolId=${exists.schoolId}, req.schoolId=${schoolId})`
        : `No admit card with _id=${id} exists in the database`;
      console.warn(`[publishAdmitCard] 404 reason: ${reason}`);
      return res.status(404).json({
        success: false,
        message: `Admit card not found. ${reason}`
      });
    }

    _audit('ADMIT_CARD_PUBLISHED', 'ADMIT_CARD', card._id,
      'Individual admit card published', { cardId: id }, req);

    res.json({
      success: true,
      data: {
        _id: card._id.toString(),
        isPublished: card.isPublished,
        publishedAt: card.publishedAt,
      },
    });
  } catch (err) {
    console.error('[publishAdmitCard] error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

const getMyAdmitCard = async (req, res) => {
  try {
    const { schoolId, _id: userId, role } = req.user;
    const { examId } = req.query;
    let studentIds = [];
    if (role === 'STUDENT') {
      const student = await Student.findOne({ userId, schoolId });
      if (!student) return res.status(404).json({ message: 'Student profile not found.' });
      studentIds = [student._id];
    } else if (role === 'PARENT') {
      const Parent = require('../models/Parent.js');
      const parent = await Parent.findOne({ userId, schoolId });
      if (!parent?.children?.length) return res.status(404).json({ message: 'Parent profile not found or no children associated.' });
      studentIds = parent.children;
    } else {
      return res.status(403).json({ message: 'Access denied.' });
    }
    const filter = { studentId: { $in: studentIds }, schoolId, ...sessionFilter(req) };
    if (examId) filter.examId = examId;
    const card = await AdmitCard.findOne(filter)
      .populate({ path: 'studentId', select: 'name rollNumber dateOfBirth parentId', strictPopulate: false })
      .populate({ path: 'examId', select: 'name startDate endDate classId', strictPopulate: false, populate: { path: 'classId', select: 'name' } })
      .populate('schoolId', 'name address phone logoBase64')
      .sort({ createdAt: -1 });
    if (!card) return res.status(404).json({ message: 'Admit card not found.' });
    const enriched = await _enrichCards(card, schoolId);
    res.json(enriched);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getAdmitCardPDF = async (req, res) => {
  try {
    const { id } = req.params;
    const { schoolId } = req.user;
    const admitCard = await AdmitCard.findOne({ _id: id, schoolId, ...sessionFilter(req) })
      .populate({ path: 'studentId', select: 'name rollNumber dateOfBirth parentId', strictPopulate: false })
      .populate({ path: 'examId', select: 'name startDate endDate classId', strictPopulate: false, populate: { path: 'classId', select: 'name' } })
      .populate('schoolId', 'name address phone email logoBase64');
    if (!admitCard) return res.status(404).json({ message: 'Admit card not found.' });
    // Simple text PDF (Flutter handles the nice PDF generation)
    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=admit-card-${admitCard.rollNumber}.pdf`);
    doc.pipe(res);
    doc.fontSize(20).font('Helvetica-Bold').text('ADMIT CARD', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).font('Helvetica').text(`Name: ${admitCard.studentId?.name || ''}`);
    doc.text(`Roll Number: ${admitCard.rollNumber}`);
    doc.text(`Exam: ${admitCard.examId?.name || ''}`);
    doc.end();
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = {
  generateAdmitCard,
  bulkGenerateAdmitCards,
  getMyAdmitCard,
  getAdmitCardPDF,
  getAdmitCardsByExam,
  getMyAdmitCardByExamId,
  publishAdmitCard,
};
