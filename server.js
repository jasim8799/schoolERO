const app = require('./src/app');
const { connectDB } = require('./src/config/db');
const { config } = require('./src/config/env');
const { logger } = require('./src/utils/logger');
const { seedRoles } = require('./src/utils/seedRoles');

// Check for required environment variables
if (!process.env.BACKUP_ENCRYPTION_KEY) {
  console.error('❌ BACKUP_ENCRYPTION_KEY missing - backups will fail');
  process.exit(1);
}

// Connect to Database
connectDB();

// 🔴 THIS LINE IS REQUIRED (YOU ARE MISSING IT)
require('./src/models'); // 👈 registers ALL mongoose schemas
require('./src/config/database').createIndexes().catch((err) => {
  console.error('[Database] Index creation error:', err.message);
});

// Start cron-based automation scheduler (after DB and models are loaded)
require('./src/jobs/scheduler');

// Seed Roles
// seedRoles();

// Start Server
const PORT = config.port;
const server = app.listen(PORT, () => {
  logger.success(`🚀 Server running on port ${PORT}`);
  logger.info(`Environment: ${config.nodeEnv}`);
});

// Initialize backup Socket.IO namespace for real-time backup telemetry
try {
  app.initBackupSocket && app.initBackupSocket(server);
  logger.info('Socket.IO backup telemetry enabled');
} catch (err) {
  logger.error('Socket.IO backup telemetry failed to start:', err.message);
}
