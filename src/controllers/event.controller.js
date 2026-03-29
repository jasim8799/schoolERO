const mongoose = require('mongoose');

/**
 * GET /api/events
 * Query: event, entityType, entityId, limit, page
 */
exports.getEvents = async (req, res) => {
  try {
    const EventLog = mongoose.model('EventLog');
    const schoolId = req.schoolId;
    const { event, entityType, entityId, limit = 50, page = 1 } = req.query;

    const filter = { schoolId };
    if (event) filter.event = event;
    if (entityType) filter.entityType = entityType;
    if (entityId) filter.entityId = entityId;

    const skip = (Number(page) - 1) * Number(limit);
    const [logs, total] = await Promise.all([
      EventLog.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .populate('triggeredBy', 'name email')
        .lean(),
      EventLog.countDocuments(filter)
    ]);

    res.json({
      success: true,
      data: logs,
      pagination: { total, page: Number(page), limit: Number(limit) }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
