require('dotenv').config();
const mongoose = require('mongoose');
const { processVideoIntegrity } = require('../src/services/videoIntegrity.service');

const schoolIdArg = process.argv.find((a) => a.startsWith('--schoolId='));
const sessionIdArg = process.argv.find((a) => a.startsWith('--sessionId='));
const schoolId = schoolIdArg ? schoolIdArg.split('=')[1] : null;
const sessionId = sessionIdArg ? sessionIdArg.split('=')[1] : null;

const run = async () => {
  await mongoose.connect(process.env.MONGODB_URI);

  console.log('VIDEO_CLASS_SUBJECT_REPAIR_START');
  console.log(`scope.schoolId=${schoolId || 'ALL'}`);
  console.log(`scope.sessionId=${sessionId || 'ALL'}`);

  const result = await processVideoIntegrity({
    schoolId,
    sessionId,
    applyFix: true,
    onMismatch: async (row) => {
      console.log('---');
      console.log(`Video title: ${row.videoTitle || '(untitled)'}`);
      console.log(`Video ID: ${row.videoId}`);
      console.log(`Subject name: ${row.subjectName || 'UNKNOWN'}`);
      console.log(`Old class ID: ${row.videoClassId}`);
      console.log(`New class ID: ${row.subjectClassId}`);
      console.log(`Old class name: ${row.videoClassName || 'MISSING_CLASS'}`);
      console.log(`New class name: ${row.subjectClassName || 'MISSING_CLASS'}`);
      if (row.issue === 'DANGLING_SUBJECT') {
        console.log('Dangling subject');
      }
    },
  });

  for (const row of result.rows) {
    if (row.issue === 'DANGLING_SUBJECT') {
      console.log('SKIPPED (Dangling subject)');
      continue;
    }
    if (row.status === 'MISMATCH' && row.repaired) {
      console.log('FIXED');
    }
  }

  console.log('=== SUMMARY ===');
  console.log(`Videos scanned: ${result.videosScanned}`);
  console.log(`Videos repaired: ${result.videosRepaired}`);
  console.log(`Videos skipped: ${result.videosSkipped}`);
  console.log(`Dangling subjects: ${result.danglingSubjects}`);
  console.log(`Missing classes: ${result.missingClasses}`);
  console.log(`Errors: ${result.errors.length}`);

  if (result.errors.length) {
    console.log('ERROR_DETAILS');
    console.log(JSON.stringify(result.errors, null, 2));
  }

  await mongoose.disconnect();
};

run().catch(async (err) => {
  console.error('Repair failed:', err.message);
  try {
    await mongoose.disconnect();
  } catch (_) {}
  process.exit(1);
});
