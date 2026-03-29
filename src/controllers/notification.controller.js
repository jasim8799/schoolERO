const mongoose = require('mongoose');

/**
 * GET /api/notifications/queue
 * Query: status, type, limit, page
 */
exports.getQueue = async (req, res) => {
  try {
    const NotificationQueue = mongoose.model('NotificationQueue');
    const { status, type, limit = 50, page = 1 } = req.query;

    const filter = { schoolId: req.schoolId };
    if (status) filter.status = status;
    if (type) filter.type = type;

    const skip = (Number(page) - 1) * Number(limit);
    const [notifications, total] = await Promise.all([
      NotificationQueue.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .populate('recipientId', 'name email')
        .lean(),
      NotificationQueue.countDocuments(filter)
    ]);

    res.json({
      success: true,
      data: notifications,
      pagination: { total, page: Number(page), limit: Number(limit) }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * POST /api/notifications/send
 * Processes PENDING notifications (up to batchSize).
 * In production, hook this into FCM / SMS / email gateway.
 * Body: { batchSize }
 */
exports.processSend = async (req, res) => {
  try {
    const NotificationQueue = mongoose.model('NotificationQueue');
    const batchSize = Number(req.body.batchSize) || 100;

    const pending = await NotificationQueue.find({
      schoolId: req.schoolId,
      status: 'PENDING',
      retryCount: { $lt: 3 }
    })
      .limit(batchSize)
      .lean();

    const results = { sent: 0, failed: 0 };

    for (const notif of pending) {
      try {
        // TODO: integrate FCM / SMS / email gateway here
        // For now, mark as SENT directly
        await NotificationQueue.findByIdAndUpdate(notif._id, {
          status: 'SENT',
          sentAt: new Date()
        });
        results.sent++;
      } catch (sendErr) {
        await NotificationQueue.findByIdAndUpdate(notif._id, {
          $inc: { retryCount: 1 },
          errorMessage: sendErr.message,
          ...(notif.retryCount + 1 >= 3 ? { status: 'FAILED' } : {})
        });
        results.failed++;
      }
    }

    res.json({ success: true, data: results });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * POST /api/notifications/manual
 * Send a manual notification to a specific user.
 * Body: { recipientId, recipientRole, type, title, body, relatedEntityId, relatedEntityType }
 */
exports.sendManual = async (req, res) => {
  try {
    const NotificationQueue = mongoose.model('NotificationQueue');
    const { recipientId, recipientRole, type, title, body, relatedEntityId, relatedEntityType } = req.body;

    const notif = await NotificationQueue.create({
      schoolId: req.schoolId,
      recipientId,
      recipientRole,
      type: type || 'GENERAL',
      title,
      body,
      relatedEntityId,
      relatedEntityType
    });
    res.status(201).json({ success: true, data: notif });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};
