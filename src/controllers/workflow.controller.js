const mongoose = require('mongoose');
const {
  createWorkflow,
  advanceWorkflow,
  cancelWorkflow,
  getWorkflowStatus,
  WORKFLOW_STEPS
} = require('../services/workflow.service');

/**
 * GET /api/workflow/:entityId/:type
 * Returns the latest workflow instance for an entity + type.
 */
exports.getWorkflow = async (req, res) => {
  try {
    const { entityId, type } = req.params;
    const schoolId = req.schoolId;

    const instance = await getWorkflowStatus(schoolId, entityId, type);
    if (!instance) {
      return res.status(404).json({ success: false, message: 'No workflow found' });
    }
    res.json({ success: true, data: instance });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * POST /api/workflow/start
 * Body: { type, entityId, entityType }
 */
exports.startWorkflow = async (req, res) => {
  try {
    const { type, entityId, entityType } = req.body;
    const schoolId = req.schoolId;

    if (!WORKFLOW_STEPS[type]) {
      return res.status(400).json({ success: false, message: `Unknown workflow type: ${type}` });
    }

    const instance = await createWorkflow(
      schoolId,
      type,
      entityId,
      entityType,
      req.user._id
    );
    res.status(201).json({ success: true, data: instance });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * POST /api/workflow/advance
 * Body: { workflowId, metadata }
 */
exports.advanceWorkflow = async (req, res) => {
  try {
    const { workflowId, metadata } = req.body;
    const instance = await advanceWorkflow(workflowId, req.user._id, metadata);
    res.json({ success: true, data: instance });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

/**
 * POST /api/workflow/:workflowId/cancel
 */
exports.cancelWorkflow = async (req, res) => {
  try {
    const { workflowId } = req.params;
    const instance = await cancelWorkflow(workflowId, req.user._id);
    res.json({ success: true, data: instance });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};
