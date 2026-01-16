const mongoose = require('mongoose');

// ✅ correct paths (because everything is inside src/)
const User = require('./src/models/User');
const { hashPassword } = require('./src/utils/password');

const MONGODB_URI = process.env.MONGODB_URI;

async function createSuperAdmin() {
  try {
    if (!MONGODB_URI) {
      throw new Error('MONGODB_URI not found in environment variables');
    }

    await mongoose.connect(MONGODB_URI);
    console.log('✅ MongoDB connected');

    const email = 'superadmin@schoolerp.com';

    const existing = await User.findOne({ email });
    if (existing) {
      console.log('⚠️ Super Admin already exists');
      process.exit(0);
    }

    const passwordHash = await hashPassword('Admin@123');

    const user = await User.create({
      name: 'Super Admin',
      email,
      password: passwordHash,
      role: 'SUPER_ADMIN',
      status: 'active',
      schoolId: null,
    });

    console.log('🎉 SUPER_ADMIN CREATED SUCCESSFULLY');
    console.log({
      id: user._id.toString(),
      email: user.email,
      role: user.role,
    });

    process.exit(0);
  } catch (error) {
    console.error('❌ FAILED TO CREATE SUPER_ADMIN:', error.message);
    process.exit(1);
  }
}

createSuperAdmin();
