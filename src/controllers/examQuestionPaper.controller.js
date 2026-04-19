const ExamQuestionPaper = require('../models/ExamQuestionPaper');
const ExamSubject = require('../models/ExamSubject');

const saveQuestionPaper = async (req, res) => {
  try {
    const { examId, subjectId, questions, instructions } = req.body;
    const { schoolId, sessionId, _id: userId } = req.user;

    if (!examId || !subjectId) {
      return res
        .status(400)
        .json({ success: false, message: 'examId and subjectId are required' });
    }
    if (!Array.isArray(questions) || questions.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: 'At least one question is required' });
    }

    const examSubject = await ExamSubject.findOne({
      examId,
      subjectId,
      teacherId: userId,
      schoolId,
      sessionId,
    });
    if (!examSubject) {
      return res.status(403).json({
        success: false,
        message: 'You are not assigned to this subject for this exam',
      });
    }

    for (const q of questions) {
      if (!q.text || q.marks === undefined || !q.questionNumber) {
        return res.status(400).json({
          success: false,
          message:
            'Each question must have questionNumber, text and marks',
        });
      }
    }

    const totalMarks = questions.reduce(
      (sum, q) => sum + (Number(q.marks) || 0),
      0
    );

    const paper = await ExamQuestionPaper.findOneAndUpdate(
      { examId, subjectId, teacherId: userId, schoolId, sessionId },
      {
        examId,
        subjectId,
        teacherId: userId,
        schoolId,
        sessionId,
        questions,
        instructions: instructions || '',
        totalMarks,
        status: 'Draft',
      },
      { upsert: true, new: true }
    );

    res.json({ success: true, message: 'Question paper saved', data: paper });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'Question paper already exists for this subject',
      });
    }
    res.status(500).json({ success: false, message: err.message });
  }
};

const submitQuestionPaper = async (req, res) => {
  try {
    const { examId, subjectId } = req.params;
    const { schoolId, sessionId, _id: userId } = req.user;

    const paper = await ExamQuestionPaper.findOne({
      examId,
      subjectId,
      teacherId: userId,
      schoolId,
      sessionId,
    });
    if (!paper) {
      return res.status(404).json({
        success: false,
        message: 'Question paper not found. Save first.',
      });
    }
    if (paper.questions.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot submit empty question paper',
      });
    }

    paper.status = 'Submitted';
    paper.submittedAt = new Date();
    await paper.save();

    res.json({
      success: true,
      message: 'Question paper submitted successfully',
      data: paper,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getMyQuestionPaper = async (req, res) => {
  try {
    const { examId, subjectId } = req.params;
    const { schoolId, sessionId, _id: userId } = req.user;

    const paper = await ExamQuestionPaper.findOne({
      examId,
      subjectId,
      teacherId: userId,
      schoolId,
      sessionId,
    })
      .populate('subjectId', 'name')
      .populate('examId', 'name');

    res.json({ success: true, data: paper || null });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getQuestionPapersByExam = async (req, res) => {
  try {
    const { examId } = req.params;
    const { schoolId, sessionId } = req.user;

    const papers = await ExamQuestionPaper.find({ examId, schoolId, sessionId })
      .populate('subjectId', 'name')
      .populate('teacherId', 'name email')
      .sort({ createdAt: 1 });

    const totalSubjects = await ExamSubject.countDocuments({
      examId,
      schoolId,
      sessionId,
    });

    res.json({
      success: true,
      data: papers,
      meta: {
        totalSubjects,
        submitted: papers.filter((p) => p.status === 'Submitted').length,
        draft: papers.filter((p) => p.status === 'Draft').length,
        pending: Math.max(totalSubjects - papers.length, 0),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getQuestionPaperDetail = async (req, res) => {
  try {
    const { paperId } = req.params;
    const { schoolId, sessionId } = req.user;

    const paper = await ExamQuestionPaper.findOne({
      _id: paperId,
      schoolId,
      sessionId,
    })
      .populate('subjectId', 'name')
      .populate('teacherId', 'name email')
      .populate('examId', 'name');

    if (!paper) {
      return res
        .status(404)
        .json({ success: false, message: 'Question paper not found' });
    }

    res.json({ success: true, data: paper });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  saveQuestionPaper,
  submitQuestionPaper,
  getMyQuestionPaper,
  getQuestionPapersByExam,
  getQuestionPaperDetail,
};
