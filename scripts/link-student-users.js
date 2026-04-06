/**
 * Migration: link-student-users.js
 *
 * Links every existing Student record that has no userId to a User account.
 * - If a STUDENT User already exists with the same mobile → reuses it.
 * - Otherwise creates a new User (role: STUDENT, default password: 123456).
 *
 * Usage:
 *   node backend/scripts/link-student-users.js
 *
 * Safe to run multiple times (skips students that already have userId).
 */

require('dotenv').config();

const mongoose = require('mongoose');
const path = require('path');

const Student = require(path.join(__dirname, '../src/models/Student.js'));
const User = require(path.join(__dirname, '../src/models/User.js'));
const { hashPassword } = require(path.join(__dirname, '../src/utils/password.js'));

async function run() {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error('❌  MONGODB_URI not set in environment.');
    process.exit(1);
  }

  await mongoose.connect(mongoUri);
  console.log('✅  MongoDB connected');

  const unlinked = await Student.find({ userId: { $in: [null, undefined] } });
  console.log(`📋  Students without userId: ${unlinked.length}`);

  if (unlinked.length === 0) {
    console.log('✅  All students already linked. Nothing to do.');
    await mongoose.disconnect();
    process.exit(0);
  }

  let created = 0;
  let reused = 0;
  let failed = 0;

  for (const student of unlinked) {
    try {
      let user = null;

      // Try to find existing STUDENT user by mobile
      if (student.mobile) {
        user = await User.findOne({ mobile: student.mobile, role: 'STUDENT' });
      }

      // Create new user if none found
      if (!user) {
        const hashedPwd = await hashPassword('123456');
        const userPayload = {
          name: student.name,
          role: 'STUDENT',
          schoolId: student.schoolId,
          password: hashedPwd
        };
        if (student.mobile) userPayload.mobile = student.mobile;
        user = await User.create(userPayload);
        created++;
      } else {
        reused++;
      }

      student.userId = user._id;
      await student.save();

      console.log(`  ✔  ${student.name} (${student._id}) → user ${user._id} [${user.mobile || 'no mobile'}]`);
    } catch (err) {
      failed++;
      console.error(`  ✘  ${student.name} (${student._id}): ${err.message}`);
    }
  }

  console.log('\n── Summary ─────────────────────────────────');
  console.log(`  Users created : ${created}`);
  console.log(`  Users reused  : ${reused}`);
  console.log(`  Failed        : ${failed}`);
  console.log(`  Total         : ${unlinked.length}`);

  await mongoose.disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('❌  Unexpected error:', err.message);
  process.exit(1);
});
