const ExamForm = require('../models/ExamForm.js');

// Utility function to close expired exam forms
const closeExpiredExamForms = async (schoolId, sessionId) => {
  try {
    const now = new Date();
    await ExamForm.updateMany(
      { schoolId, sessionId, status: 'ACTIVE', endDate: { $lt: now } },
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
    const query = { schoolId, sessionId, status: 'ACTIVE' };
    if (classId) {
      query.classId = classId;
    }

    const examForms = await ExamForm.find(query).sort({ endDate: 1 });
    res.json(examForms);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = { createExamForm, getActiveExamForms };
