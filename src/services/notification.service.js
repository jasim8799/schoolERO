const NotificationLog = require('../models/NotificationLog');

const notificationService = {
  async sendRenewalReminder(school, priority = 'STANDARD') {
    return NotificationLog.create({
      schoolId: school._id,
      channel: 'EMAIL',
      type: 'SUBSCRIPTION_RENEWAL',
      recipient: school.contact?.email || '',
      subject: `${priority === 'URGENT' ? 'Urgent: ' : ''}Subscription Renewal Reminder`,
      message: `School ${school.name} subscription is nearing expiry.`,
      status: 'SENT',
      meta: { priority }
    });
  },

  async sendSuspensionNotice(school) {
    return NotificationLog.create({
      schoolId: school._id,
      channel: 'EMAIL',
      type: 'SUBSCRIPTION_SUSPENDED',
      recipient: school.contact?.email || '',
      subject: 'Subscription Suspended',
      message: `School ${school.name} has been auto-suspended due to expired subscription.`,
      status: 'SENT'
    });
  }
};

module.exports = { notificationService };
