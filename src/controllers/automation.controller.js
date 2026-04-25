const mongoose = require('mongoose');
const { runAutomations } = require('../services/automation.service');

function normalizeSchoolId(schoolId) {
  if (!schoolId) return null;
  if (schoolId instanceof mongoose.Types.ObjectId) return schoolId;
  try {
    return new mongoose.Types.ObjectId(schoolId);
  } catch (_) {
    return schoolId;
  }
}

/**
 * GET /api/automations
 */
exports.getAutomations = async (req, res) => {
  try {
    const schoolId = req.user?.schoolId;
    if (!schoolId) {
      return res.status(400).json({ success: false, message: 'No school context' });
    }
    const schoolObjId = normalizeSchoolId(schoolId);

    const AutomationRule = mongoose.model('AutomationRule');
    const rules = await AutomationRule.find({ schoolId: schoolObjId }).sort({ createdAt: -1 }).lean();
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
    const schoolObjId = normalizeSchoolId(schoolId);

    const AutomationRule = mongoose.model('AutomationRule');
    const { name, trigger, condition, action } = req.body;

    if (!name || !trigger || !action?.type || !action?.target) {
      return res.status(400).json({
        success: false,
        message: 'name, trigger, action.type and action.target are required'
      });
    }

    const rule = await AutomationRule.create({
      schoolId: schoolObjId,
      name,
      trigger,
      condition,
      action,
      expiryHours: req.body.expiryHours ?? 24,
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
    const schoolObjId = normalizeSchoolId(schoolId);

    const AutomationRule = mongoose.model('AutomationRule');
    const { id } = req.params;
    const allowed = ['name', 'isActive', 'condition', 'action', 'expiryHours'];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }

    const rule = await AutomationRule.findOneAndUpdate(
      { _id: id, schoolId: schoolObjId },
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
    const schoolObjId = normalizeSchoolId(schoolId);

    const AutomationRule = mongoose.model('AutomationRule');
    const { id } = req.params;
    const rule = await AutomationRule.findOneAndDelete({ _id: id, schoolId: schoolObjId });
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
    const schoolObjId = normalizeSchoolId(schoolId);

    const { trigger } = req.body;
    if (!trigger) return res.status(400).json({ success: false, message: 'trigger is required' });

    const result = await runAutomations(schoolObjId, trigger);
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

/**
 * GET /api/automations/active-notifications
 * Returns recently dispatched active automation rules that haven't expired.
 * Used by dashboard ticker and related screens.
 */
exports.getActiveNotifications = async (req, res) => {
  try {
    const schoolId = req.user?.schoolId;
    if (!schoolId) {
      return res.status(400).json({ success: false, message: 'No school context' });
    }
    const schoolObjId = normalizeSchoolId(schoolId);
    const AutomationRule = mongoose.model('AutomationRule');
    const now = new Date();

    // Get rules that were dispatched and haven't expired yet
    const rules = await AutomationRule.find({
      schoolId: schoolObjId,
      isActive: true,
      lastDispatchedAt: { $ne: null },
    }).lean();

    // Filter: only include rules where (now - lastDispatchedAt) < expiryHours
    const active = rules.filter(r => {
      if (!r.lastDispatchedAt) return false;
      if (r.expiryHours === 0) return true; // never expires
      const ageMs = now - new Date(r.lastDispatchedAt);
      const ageHours = ageMs / (1000 * 60 * 60);
      return ageHours < (r.expiryHours || 24);
    });

    res.json({ success: true, data: active });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * GET /api/automations/my-notifications
 * Returns active automation notifications for the current user's school and role.
 */
exports.getMyNotifications = async (req, res) => {
  try {
    const schoolId = req.user?.schoolId;
    if (!schoolId) {
      return res.status(400).json({ success: false, message: 'No school context' });
    }

    const schoolObjId = normalizeSchoolId(schoolId);
    const userRole = req.user?.role?.toUpperCase();
    const AutomationRule = mongoose.model('AutomationRule');
    const now = new Date();

    const rules = await AutomationRule.find({
      schoolId: schoolObjId,
      isActive: true,
      lastDispatchedAt: { $ne: null },
    }).lean();

    const active = rules.filter((rule) => {
      if (!rule.lastDispatchedAt) return false;
      if (rule.expiryHours === 0) return true;
      const ageMs = now - new Date(rule.lastDispatchedAt);
      const ageHours = ageMs / (1000 * 60 * 60);
      return ageHours < (rule.expiryHours || 24);
    });

    const filtered = active.filter((rule) => {
      const target = rule.action?.target?.toUpperCase();
      if (!target) return false;
      return target === 'ALL' || target === userRole;
    });

    res.json({ success: true, data: filtered });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
