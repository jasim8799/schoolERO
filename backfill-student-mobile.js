const mongoose = require('mongoose');
const Student = require('./src/models/Student.js');
const Parent = require('./src/models/Parent.js');
const { config } = require('./src/config/env.js');

async function backfillStudentMobile() {
  try {
    // Connect to MongoDB
    await mongoose.connect(config.mongoUri);
    console.log('Connected to MongoDB');

    // Find all students without mobile
    const studentsWithoutMobile = await Student.find({
      mobile: { $in: [null, undefined, ''] }
    }).populate({
      path: 'parentId',
      populate: {
        path: 'userId',
        select: 'mobile'
      }
    });

    console.log(`Found ${studentsWithoutMobile.length} students without mobile`);

    let updatedCount = 0;
    for (const student of studentsWithoutMobile) {
      if (student.parentId?.userId?.mobile) {
        student.mobile = student.parentId.userId.mobile;
        await student.save();
        updatedCount++;
        console.log(`Updated student ${student.name} (${student._id}) with mobile ${student.mobile}`);
      }
    }

    console.log(`Migration completed. Updated ${updatedCount} students.`);

  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
}

// Run migration
backfillStudentMobile();
