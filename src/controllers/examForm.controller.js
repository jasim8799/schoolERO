const ExamForm = require('../models/ExamForm.js');

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

// Utility function to close expired exam forms
const closeExpiredExamForms = async (schoolId, sessionId) => {
  try {
    const now = new Date();
    const filter = { schoolId, status: 'ACTIVE', endDate: { $lt: now } };
    if (sessionId) filter.sessionId = sessionId;
    await ExamForm.updateMany(
      filter,
      { status: 'CLOSED' }
    );
  } catch (err) {
    console.error('Error closing expired exam forms:', err);
  }
};

const createExamForm = async (req, res) => {
  try {
    const { examId, classId, feeAmount, endDate, isPaymentRequired } = req.body;
    const { schoolId, sessionId, _id: userId } = req.user;

    // Check if an active exam form already exists for this exam
    const existingActiveForm = await ExamForm.findOne({
      examId,
      schoolId,
      sessionId,
      status: 'ACTIVE'
    });

    if (existingActiveForm) {
      return res.status(409).json({
        message: 'Active exam form already exists for this exam'
      });
    }

    const examForm = await ExamForm.create({
      examId,
      classId,
      feeAmount,
      endDate,
      isPaymentRequired,
      status: 'ACTIVE',
      sessionId,
      schoolId,
      createdBy: userId,
    });
    res.status(201).json(examForm);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: 'Exam form already exists for this exam, class, session, and school.' });
    }
    res.status(500).json({ message: err.message });
  }
};

const getActiveExamForms = async (req, res) => {
  try {
    const { classId } = req.query;
    const { schoolId, sessionId } = req.user;

    // Close expired exam forms before querying
    await closeExpiredExamForms(schoolId, sessionId);

    // Build query dynamically
    const query = { schoolId, status: 'ACTIVE', ...sessionFilter(req) };
    if (classId) {
      query.classId = classId;
    }

    const examForms = await ExamForm.find(query)
      .populate('examId', 'name startDate endDate')
      .populate('classId', 'name')
      .sort({ endDate: 1 });
    res.json({ success: true, data: examForms });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const createExamFormsBulk = async (req, res) => {
  try {
    const { examId, classFees, endDate, isPaymentRequired } = req.body;
    // classFees: [{ classId, feeAmount }]
    const { schoolId, sessionId, _id: userId } = req.user;

    if (!examId) {
      return res.status(400).json({ success: false, message: 'examId is required' });
    }
    if (!Array.isArray(classFees) || classFees.length === 0) {
      return res.status(400).json({ success: false, message: 'classFees array is required' });
    }
    if (!endDate) {
      return res.status(400).json({ success: false, message: 'endDate is required' });
    }

    const results = [];
    const errors = [];

    for (const cf of classFees) {
      const { classId, feeAmount } = cf;
      if (!classId || feeAmount == null) {
        errors.push({ classId, reason: 'Missing classId or feeAmount' });
        continue;
      }
      const fee = Number(feeAmount);
      if (isNaN(fee) || fee < 0) {
        errors.push({ classId, reason: 'Invalid feeAmount' });
        continue;
      }
      try {
        // Skip if active form already exists for this exam+class
        const existing = await ExamForm.findOne({
          examId, classId, schoolId, sessionId, status: 'ACTIVE'
        });
        if (existing) {
          errors.push({ classId, reason: 'Active form already exists for this class' });
          continue;
        }
        const form = await ExamForm.create({
          examId,
          classId,
          feeAmount: fee,
          endDate,
          isPaymentRequired: isPaymentRequired !== false,
          status: 'ACTIVE',
          sessionId,
          schoolId,
          createdBy: userId,
        });
        results.push(form);
      } catch (err) {
        if (err.code === 11000) {
          errors.push({ classId, reason: 'Form already exists for this class' });
        } else {
          errors.push({ classId, reason: err.message });
        }
      }
    }

    return res.status(201).json({
      success: true,
      message: `Created ${results.length} form(s).${errors.length > 0 ? ` ${errors.length} skipped.` : ''}`,
      data: results,
      errors,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { createExamForm, createExamFormsBulk, getActiveExamForms };
