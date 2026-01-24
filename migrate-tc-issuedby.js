// One-time migration script to update old TC records with missing issuedBy field
// Run this script once in production to fix legacy data
// Usage: node migrate-tc-issuedby.js

const mongoose = require('mongoose');
require('dotenv').config();

const TC = require('./src/models/TC');
const User = require('./src/models/User');

async function migrateTCIssuedBy() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/schoolerp', {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log('Connected to MongoDB');

    // Find all TC records where issuedBy is missing or null
    const oldTCs = await TC.find({
      $or: [
        { issuedBy: { $exists: false } },
        { issuedBy: null }
      ]
    }).populate('schoolId');

    console.log(`Found ${oldTCs.length} TC records that need migration`);

    if (oldTCs.length === 0) {
      console.log('No migration needed - all TC records have issuedBy field');
      return;
    }

    let updatedCount = 0;

    // Process each TC record
    for (const tc of oldTCs) {
      try {
        // Find a Principal user for this school
        const principal = await User.findOne({
          schoolId: tc.schoolId,
          role: 'PRINCIPAL',
          status: 'ACTIVE'
        });

        if (principal) {
          // Update the TC record with the Principal's ID
          await TC.findByIdAndUpdate(tc._id, {
            issuedBy: principal._id
          });
          updatedCount++;
          console.log(`Updated TC ${tc.tcNumber} with issuedBy: ${principal.name}`);
        } else {
          console.log(`No Principal found for school ${tc.schoolId} - skipping TC ${tc.tcNumber}`);
        }
      } catch (error) {
        console.error(`Error updating TC ${tc.tcNumber}:`, error.message);
      }
    }

    console.log(`Migration completed. Updated ${updatedCount} out of ${oldTCs.length} TC records`);

  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
}

// Run the migration
migrateTCIssuedBy();
