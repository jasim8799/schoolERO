const logLevels = {
  info: '\x1b[36m[INFO]\x1b[0m',
  error: '\x1b[31m[ERROR]\x1b[0m',
  success: '\x1b[32m[SUCCESS]\x1b[0m',
  warn: '\x1b[33m[WARN]\x1b[0m'
};

const logger = {
  info: (message, ...args) => {
    console.log(`${logLevels.info} ${message}`, ...args);
  },
  error: (message, ...args) => {
    console.error(`${logLevels.error} ${message}`, ...args);
  },
  success: (message, ...args) => {
    console.log(`${logLevels.success} ${message}`, ...args);
  },
  warn: (message, ...args) => {
    console.warn(`${logLevels.warn} ${message}`, ...args);
  }
};

module.exports = { logger };
