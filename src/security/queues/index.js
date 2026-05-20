const { Queue } = require('bullmq');
const redisConfig = require('../../config/redis');

function createNoopQueue(name) {
  return {
    name,
    async add(jobName, data) {
      return { id: `noop-${name}-${Date.now()}`, name: jobName, data };
    },
  };
}

function createQueue(name) {
  const connection = redisConfig?.connection;
  if (!connection) return createNoopQueue(name);
  return new Queue(name, {
    connection,
    defaultJobOptions: {
      attempts: 3,
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 1000 },
      backoff: { type: 'exponential', delay: 5000 },
    },
  });
}

const securityQueues = {
  firewallQueue: createQueue('security-firewall'),
  incidentQueue: createQueue('security-incident'),
  threatDetectionQueue: createQueue('security-threat-detection'),
  authSecurityQueue: createQueue('security-auth'),
  malwareQueue: createQueue('security-malware'),
};

module.exports = { securityQueues };
