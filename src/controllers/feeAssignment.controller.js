const mongoose = require('mongoose');
const { generateMonthlyFees } = require('../services/automation.service');

/**
 * POST /api/fee-assignments/generate-monthly
 * Body: { month }  — e.g. '2025-04'
 */
exports.generateMonthly = async (req, res) => {
  try {
    const { month } = req.body;
    const count = await generateMonthlyFees(req.schoolId, month);
    res.json({
      success: true,
      message: `Generated ${count} fee assignment(s)`,
      count
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * GET /api/fee-assignments/student/:id
 * Query: status, sessionId
 */
exports.getStudentAssignments = async (req, res) => {
  try {
    const StudentFeeAssignment = mongoose.model('StudentFeeAssignment');
    const { status, sessionId } = req.query;

    const filter = { studentId: req.params.id, schoolId: req.schoolId };
    if (status) filter.status = status;
    if (sessionId) filter.sessionId = sessionId;

    const assignments = await StudentFeeAssignment.find(filter)
      .populate('feeStructureId', 'name feeType amount')
      .sort({ dueDate: 1 })
      .lean();

    res.json({ success: true, data: assignments });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * PATCH /api/fee-assignments/:id/waive
 * Body: { reason }
 */
exports.waiveAssignment = async (req, res) => {
  try {
    const StudentFeeAssignment = mongoose.model('StudentFeeAssignment');
    const assignment = await StudentFeeAssignment.findOneAndUpdate(
      { _id: req.params.id, schoolId: req.schoolId },
      { status: 'WAIVED', assignedBy: req.user._id },
      { new: true }
    );
    if (!assignment) {
      return res.status(404).json({ success: false, message: 'Assignment not found' });
    }
    res.json({ success: true, data: assignment });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};
