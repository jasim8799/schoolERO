const ExamQuestionPaper = require('../models/ExamQuestionPaper');
const ExamSubject = require('../models/ExamSubject');
const Exam = require('../models/Exam');

const saveQuestionPaper = async (req, res) => {
  try {
    const {
      examId,
      subjectId,
      questions,
      instructions,
      pdfBase64,
      pdfFileName,
      uploadType,
      maxTime,
      maxMarks,
    } = req.body;
    const { schoolId, sessionId, _id: userId } = req.user;

    if (!examId || !subjectId) {
      return res.status(400).json({ success: false, message: 'examId and subjectId are required' });
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

    // Get classId from exam.
    const exam = await Exam.findById(examId).select('classId');
    const classId = exam?.classId;

    // Validate based on upload type.
    if (uploadType === 'pdf') {
      if (!pdfBase64) {
        return res.status(400).json({ success: false, message: 'PDF data is required for pdf upload type' });
      }
    } else {
      // Manual mode validates questions.
      if (!Array.isArray(questions) || questions.length === 0) {
        return res.status(400).json({ success: false, message: 'At least one question is required' });
      }
      for (const q of questions) {
        if (!q.text || q.marks === undefined || !q.questionNumber) {
          return res.status(400).json({
            success: false,
            message: 'Each question must have questionNumber, text and marks',
          });
        }
      }
    }

    const totalMarks = (questions || []).reduce((sum, q) => sum + (Number(q.marks) || 0), 0);

    const updateData = {
      examId,
      subjectId,
      teacherId: userId,
      schoolId,
      sessionId,
      instructions: instructions || '',
      uploadType: uploadType || 'manual',
      maxTime: maxTime || '3 hours',
      maxMarks: maxMarks || totalMarks,
      status: 'Draft',
    };
    if (classId) updateData.classId = classId;

    if (uploadType === 'pdf') {
      updateData.pdfBase64 = pdfBase64;
      updateData.pdfFileName = pdfFileName || 'question_paper.pdf';
      updateData.questions = [];
      updateData.totalMarks = maxMarks || 0;
    } else {
      updateData.questions = questions;
      updateData.totalMarks = totalMarks;
      updateData.pdfBase64 = undefined;
    }

    const paper = await ExamQuestionPaper.findOneAndUpdate(
      { examId, subjectId, teacherId: userId, schoolId, sessionId },
      updateData,
      { upsert: true, new: true }
    );

    res.json({ success: true, message: 'Question paper saved', data: paper });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ success: false, message: 'Question paper already exists for this subject' });
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
      return res.status(404).json({ success: false, message: 'Question paper not found. Save first.' });
    }
    if (paper.uploadType === 'manual' && paper.questions.length === 0) {
      return res.status(400).json({ success: false, message: 'Cannot submit empty question paper' });
    }
    if (paper.uploadType === 'pdf' && !paper.pdfBase64) {
      return res.status(400).json({ success: false, message: 'Cannot submit: no PDF uploaded' });
    }

    paper.status = 'Submitted';
    paper.submittedAt = new Date();
    await paper.save();

    res.json({ success: true, message: 'Question paper submitted successfully', data: paper });
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
      .populate('examId', 'name')
      .populate('classId', 'name');

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
      .populate('classId', 'name')
      .sort({ createdAt: 1 });

    const totalSubjects = await ExamSubject.countDocuments({ examId, schoolId, sessionId });

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

    const paper = await ExamQuestionPaper.findOne({ _id: paperId, schoolId, sessionId })
      .populate('subjectId', 'name')
      .populate('teacherId', 'name email')
      .populate('examId', 'name')
      .populate('classId', 'name');

    if (!paper) {
      return res.status(404).json({ success: false, message: 'Question paper not found' });
    }

    res.json({ success: true, data: paper });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Principal can edit a submitted question paper.
const principalEditQuestionPaper = async (req, res) => {
  try {
    const { paperId } = req.params;
    const { schoolId, sessionId } = req.user;
    const { questions, instructions, maxTime, maxMarks, principalNotes } = req.body;

    const paper = await ExamQuestionPaper.findOne({ _id: paperId, schoolId, sessionId });
    if (!paper) {
      return res.status(404).json({ success: false, message: 'Question paper not found' });
    }

    if (questions !== undefined) {
      for (const q of questions) {
        if (!q.text || q.marks === undefined || !q.questionNumber) {
          return res.status(400).json({
            success: false,
            message: 'Each question must have questionNumber, text and marks',
          });
        }
      }
      paper.questions = questions;
      paper.totalMarks = questions.reduce((sum, q) => sum + (Number(q.marks) || 0), 0);
    }

    if (instructions !== undefined) paper.instructions = instructions;
    if (maxTime !== undefined) paper.maxTime = maxTime;
    if (maxMarks !== undefined) paper.maxMarks = maxMarks;
    if (principalNotes !== undefined) paper.principalNotes = principalNotes;
    paper.principalEditedAt = new Date();

    await paper.save();
    res.json({ success: true, message: 'Question paper updated by principal', data: paper });
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
  principalEditQuestionPaper,
};
