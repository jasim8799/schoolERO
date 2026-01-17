const mongoose = require('mongoose');
const { config } = require('./env');

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(config.mongoUri, { dbName: 'school_erp_test' });
    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`❌ MongoDB Connection Error: ${error.message}`);
    process.exit(1);
  }
};

module.exports = { connectDB };
