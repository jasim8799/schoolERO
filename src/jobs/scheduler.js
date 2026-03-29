const cron = require('node-cron');
const mongoose = require('mongoose');
const {
  runAutomations,
  checkAttendanceNotMarked,
  generateMonthlyFees,
  checkFeesDue
} = require('../services/automation.service');

/**
 * Get all active school IDs.
 */
async function getActiveSchoolIds() {
  const School = mongoose.model('School');
  const schools = await School.find({ isActive: true }).select('_id').lean();
  return schools.map(s => s._id);
}

/**
 * Run a job for every active school, catching per-school errors.
 */
async function runForAllSchools(jobName, jobFn) {
  try {
    const schoolIds = await getActiveSchoolIds();
    for (const schoolId of schoolIds) {
      try {
        await jobFn(schoolId);
      } catch (err) {
        console.error(`[Scheduler] ${jobName} failed for school ${schoolId}:`, err.message);
      }
    }
  } catch (err) {
    console.error(`[Scheduler] ${jobName} — could not fetch schools:`, err.message);
  }
}

// ── Cron Jobs ──────────────────────────────────────────────────────────────────

/**
 * Every day at 02:00 — run all automation rules
 */
cron.schedule('0 2 * * *', async () => {
  console.log('[Scheduler] Running daily automations...');
  await runForAllSchools('runAutomations', async (schoolId) => {
    const triggers = [
      'FEE_DUE',
      'STUDENT_ABSENT',
      'ATTENDANCE_NOT_MARKED'
    ];
    for (const trigger of triggers) {
      await runAutomations(schoolId, trigger);
    }
  });
});

/**
 * Every day at 06:00 — check attendance not marked (for previous day)
 */
cron.schedule('0 6 * * *', async () => {
  console.log('[Scheduler] Checking attendance not marked...');
  await runForAllSchools('checkAttendanceNotMarked', (schoolId) =>
    checkAttendanceNotMarked(schoolId)
  );
});

/**
 * 1st of every month at 00:00 — generate monthly fee assignments
 */
cron.schedule('0 0 1 * *', async () => {
  console.log('[Scheduler] Generating monthly fees...');
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  await runForAllSchools('generateMonthlyFees', (schoolId) =>
    generateMonthlyFees(schoolId, month)
  );
});

/**
 * Every day at 22:00 — check overdue fees and queue reminders
 */
cron.schedule('0 22 * * *', async () => {
  console.log('[Scheduler] Checking fees due...');
  await runForAllSchools('checkFeesDue', (schoolId) => checkFeesDue(schoolId));
});

console.log('[Scheduler] Cron jobs registered');
