import app from './src/app.js';
import { connectDB } from './src/config/db.js';
import { config } from './src/config/env.js';
import { logger } from './src/utils/logger.js';
import { seedRoles } from './src/utils/seedRoles.js';

// Connect to Database
connectDB();

// Seed Roles
seedRoles();

// Start Server
const PORT = config.port;
app.listen(PORT, () => {
  logger.success(`🚀 Server running on port ${PORT}`);
  logger.info(`Environment: ${config.nodeEnv}`);
});
