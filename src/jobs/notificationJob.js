const NotificationLog = require('../models/NotificationLog');

async function runNotificationDispatch(limit = 100) {
  const pending = await NotificationLog.find({ status: 'PENDING' }).limit(limit);
  let sent = 0;

  for (const item of pending) {
    item.status = 'SENT';
    item.sentAt = new Date();
    await item.save();
    sent += 1;
  }

  return { processed: pending.length, sent };
}

module.exports = { runNotificationDispatch };
