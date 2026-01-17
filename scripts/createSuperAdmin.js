require('dotenv').config();

const mongoose = require('mongoose');
const path = require('path');

// ✅ CORRECT PATHS (based on your project)
const User = require(path.join(__dirname, '../src/models/User.js'));
const { USER_ROLES } = require(path.join(__dirname, '../src/config/constants.js'));
const { hashPassword } = require(path.join(__dirname, '../src/utils/password.js'));

async function createSuperAdmin() {
  try {
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
      throw new Error('MONGODB_URI not found in environment variables');
    }

    await mongoose.connect(mongoUri);
    console.log('✅ MongoDB connected');

    const email = 'superadmin@schoolerp.com';

    const existing = await User.findOne({ email });
    if (existing) {
      console.log('⚠️ Super Admin already exists');
      process.exit(0);
    }

    const hashedPassword = await hashPassword('Admin@123');

    await User.create({
      name: 'Super Admin',
      email,
      password: hashedPassword,
      role: USER_ROLES.SUPER_ADMIN,
      status: 'active'
    });

    console.log('🎉 SUPER ADMIN CREATED SUCCESSFULLY');
    console.log('📧 Email: superadmin@schoolerp.com');
    console.log('🔑 Password: Admin@123');

    process.exit(0);
  } catch (error) {
    console.error('❌ FAILED TO CREATE SUPER_ADMIN:', error.message);
    process.exit(1);
  }
}

createSuperAdmin();
