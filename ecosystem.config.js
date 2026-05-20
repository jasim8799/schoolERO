module.exports = {
  apps: [
    {
      name: 'schoolero-api',
      script: './src/app.js',
      instances: 'max',       // Use all CPU cores
      exec_mode: 'cluster',
      max_memory_restart: '1G',
      env_production: {
        NODE_ENV: 'production',
      },
      error_file: './logs/error.log',
      out_file: './logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
    {
      name: 'schoolero-workers',
      script: './src/workers/standalone.js', // Worker-only process
      instances: 2,
      exec_mode: 'fork',      // Workers should NOT cluster (BullMQ handles concurrency)
      max_memory_restart: '512M',
    },
  ],
};
