const mongoose = require('mongoose');
const { runAutomations } = require('../services/automation.service');

/**
 * GET /api/automations
 */
exports.getAutomations = async (req, res) => {
  try {
    const schoolId = req.user?.schoolId;
    if (!schoolId) {
      return res.status(400).json({ success: false, message: 'No school context' });
    }

    const AutomationRule = mongoose.model('AutomationRule');
    const rules = await AutomationRule.find({ schoolId }).sort({ createdAt: -1 }).lean();
    res.json({ success: true, data: rules });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * POST /api/automations
 * Body: { name, trigger, condition, action }
 */
exports.createAutomation = async (req, res) => {
  try {
    const schoolId = req.user?.schoolId;
    if (!schoolId) {
      return res.status(400).json({ success: false, message: 'No school context' });
    }

    const AutomationRule = mongoose.model('AutomationRule');
    const { name, trigger, condition, action } = req.body;

    if (!name || !trigger || !action?.type || !action?.target) {
      return res.status(400).json({
        success: false,
        message: 'name, trigger, action.type and action.target are required'
      });
    }

    const rule = await AutomationRule.create({
      schoolId,
      name,
      trigger,
      condition,
      action
    });
    res.status(201).json({ success: true, data: rule });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

/**
 * PATCH /api/automations/:id
 */
exports.updateAutomation = async (req, res) => {
  try {
    const schoolId = req.user?.schoolId;
    if (!schoolId) {
      return res.status(400).json({ success: false, message: 'No school context' });
    }

    const AutomationRule = mongoose.model('AutomationRule');
    const { id } = req.params;
    const allowed = ['name', 'isActive', 'condition', 'action'];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }

    const rule = await AutomationRule.findOneAndUpdate(
      { _id: id, schoolId },
      updates,
      { new: true }
    );
    if (!rule) return res.status(404).json({ success: false, message: 'Rule not found' });
    res.json({ success: true, data: rule });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

/**
 * DELETE /api/automations/:id
 */
exports.deleteAutomation = async (req, res) => {
  try {
    const schoolId = req.user?.schoolId;
    if (!schoolId) {
      return res.status(400).json({ success: false, message: 'No school context' });
    }

    const AutomationRule = mongoose.model('AutomationRule');
    const { id } = req.params;
    const rule = await AutomationRule.findOneAndDelete({ _id: id, schoolId });
    if (!rule) return res.status(404).json({ success: false, message: 'Rule not found' });
    res.json({ success: true, message: 'Automation rule deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * POST /api/automations/run
 * Body: { trigger }  — manually trigger all active rules for a given trigger type
 */
exports.runAutomations = async (req, res) => {
  try {
    const schoolId = req.user?.schoolId;
    if (!schoolId) {
      return res.status(400).json({ success: false, message: 'No school context' });
    }

    const { trigger } = req.body;
    if (!trigger) return res.status(400).json({ success: false, message: 'trigger is required' });

    const result = await runAutomations(schoolId, trigger);
    res.json({
      success: true,
      message: result.rulesRun > 0
          ? `${result.rulesRun} rule(s) executed for "${trigger}"`
          : `No active rules found for trigger "${trigger}"`,
      rulesRun: result.rulesRun,
      notificationsCreated: result.notificationsCreated,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
