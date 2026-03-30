const cron = require('node-cron');
const mongoose = require('mongoose');

const generateBillNumber = (schoolId) => {
  const ts = Date.now();
  const r = Math.floor(Math.random() * 1000)
    .toString().padStart(3, '0');
  return `BILL-${schoolId.toString().slice(-4)}-${ts}-${r}`;
};

const generateMonthlyBills = async () => {
  try {
    const Bill = mongoose.model('Bill');
    const StudentHostel = mongoose.model('StudentHostel');
    const StudentTransport = mongoose.model('StudentTransport');
    const Hostel = mongoose.model('Hostel');
    const Route = mongoose.model('Route');
    const AcademicSession = mongoose.model('AcademicSession');

    const now = new Date();
    const monthKey = `${now.getFullYear()}-${
      String(now.getMonth() + 1).padStart(2, '0')
    }`;

    console.log(`[Cron] Generating monthly bills for ${monthKey}`);

    // Get all active hostel assignments
    const hostelAssignments = await StudentHostel.find({
      status: 'ACTIVE'
    }).lean();

    let hostelCount = 0;
    for (const assignment of hostelAssignments) {
      try {
        // Check if bill already exists for this month
        const existing = await Bill.findOne({
          sourceType: 'StudentHostel',
          sourceId: assignment._id,
          description: { $regex: monthKey }
        });
        if (existing) continue;

        const hostel = await Hostel.findById(assignment.hostelId).lean();
        if (!hostel || !hostel.monthlyFee || hostel.monthlyFee <= 0) continue;

        const session = await AcademicSession.findOne({
          schoolId: assignment.schoolId,
          isActive: true
        });
        if (!session) continue;

        let billNumber;
        let attempts = 0;
        do {
          billNumber = generateBillNumber(assignment.schoolId);
          attempts++;
        } while (attempts < 10 &&
          await Bill.findOne({ billNumber }));

        await Bill.create({
          billNumber,
          studentId: assignment.studentId,
          schoolId: assignment.schoolId,
          sessionId: session._id,
          billType: 'HOSTEL',
          sourceType: 'StudentHostel',
          sourceId: assignment._id,
          description: `Hostel Fee — ${hostel.name} — ${monthKey}`,
          totalAmount: hostel.monthlyFee,
          paidAmount: 0,
          dueAmount: hostel.monthlyFee,
          status: 'UNPAID',
          createdBy: assignment.studentId
        });
        hostelCount++;
      } catch (err) {
        console.error('[Cron] Hostel bill error:', err.message);
      }
    }

    // Get all active transport assignments
    const transportAssignments = await StudentTransport.find({
      status: 'ACTIVE'
    }).lean();

    let transportCount = 0;
    for (const assignment of transportAssignments) {
      try {
        const existing = await Bill.findOne({
          sourceType: 'StudentTransport',
          sourceId: assignment._id,
          description: { $regex: monthKey }
        });
        if (existing) continue;

        const route = await Route.findById(assignment.routeId).lean();
        if (!route || !route.monthlyFee || route.monthlyFee <= 0) continue;

        const session = await AcademicSession.findOne({
          schoolId: assignment.schoolId,
          isActive: true
        });
        if (!session) continue;

        let billNumber;
        let attempts = 0;
        do {
          billNumber = generateBillNumber(assignment.schoolId);
          attempts++;
        } while (attempts < 10 &&
          await Bill.findOne({ billNumber }));

        await Bill.create({
          billNumber,
          studentId: assignment.studentId,
          schoolId: assignment.schoolId,
          sessionId: session._id,
          billType: 'TRANSPORT',
          sourceType: 'StudentTransport',
          sourceId: assignment._id,
          description: `Transport Fee — ${route.name} — ${monthKey}`,
          totalAmount: route.monthlyFee,
          paidAmount: 0,
          dueAmount: route.monthlyFee,
          status: 'UNPAID',
          createdBy: assignment.studentId
        });
        transportCount++;
      } catch (err) {
        console.error('[Cron] Transport bill error:', err.message);
      }
    }

    console.log(
      `[Cron] Generated ${hostelCount} hostel bills, ` +
      `${transportCount} transport bills for ${monthKey}`
    );
  } catch (err) {
    console.error('[Cron] Monthly bill generation failed:', err.message);
  }
};

// Run on 1st of every month at 6:00 AM
const startRecurringBillsCron = () => {
  cron.schedule('0 6 1 * *', generateMonthlyBills);
  console.log('[Cron] Recurring bills cron scheduled');
};

module.exports = { startRecurringBillsCron, generateMonthlyBills };
