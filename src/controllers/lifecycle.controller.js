const {
  advanceSessionLifecycle,
  getStudentLifecycleStatus,
  validatePromotionEligibility,
  validateTCEligibility
} = require('../services/lifecycle.service');

/**
 * PATCH /api/lifecycle/session/:id
 * Advance the session to the next lifecycle stage.
 */
exports.advanceSession = async (req, res) => {
  try {
    const session = await advanceSessionLifecycle(req.params.id, req.user._id);
    res.json({ success: true, data: session });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

/**
 * GET /api/lifecycle/student/:id
 */
exports.getStudentLifecycle = async (req, res) => {
  try {
    const data = await getStudentLifecycleStatus(req.params.id);
    res.json({ success: true, data });
  } catch (err) {
    res.status(404).json({ success: false, message: err.message });
  }
};

/**
 * GET /api/lifecycle/promotion-check/:id
 * Query: ?sessionId=<id>
 */
exports.promotionCheck = async (req, res) => {
  try {
    const { sessionId } = req.query;
    if (!sessionId) {
      return res.status(400).json({ success: false, message: 'sessionId query param required' });
    }
    const result = await validatePromotionEligibility(req.params.id, sessionId);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

/**
 * GET /api/lifecycle/tc-check/:id
 */
exports.tcCheck = async (req, res) => {
  try {
    const result = await validateTCEligibility(req.params.id);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};
