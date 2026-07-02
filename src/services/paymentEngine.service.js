const mongoose = require('mongoose');
const Bill = require('../models/Bill');
const Payment = require('../models/Payment');
const LedgerEntry = require('../models/LedgerEntry');
const AcademicSession = require('../models/AcademicSession');
const StudentHostel = require('../models/StudentHostel');
const StudentTransport = require('../models/StudentTransport');
const TransportFee = require('../models/TransportFee');
const ExamPayment = require('../models/ExamPayment');
const { syncBillPaymentToSource } = require('./feeSync.service');
const { extractBillMonthYear } = require('./billMonth.service');

class PaymentEngineError extends Error {
  constructor(message, statusCode = 400, details = null) {
    super(message);
    this.name = 'PaymentEngineError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

const BILL_TYPE_TO_CATEGORY = {
  TUITION: 'FEE_COLLECTION',
  HOSTEL: 'HOSTEL_COLLECTION',
  TRANSPORT: 'TRANSPORT_COLLECTION',
  EXAM: 'EXAM_COLLECTION',
  ADMISSION: 'FEE_COLLECTION',
  LIBRARY: 'FEE_COLLECTION',
  SPORTS: 'FEE_COLLECTION',
  MISCELLANEOUS: 'FEE_COLLECTION',
  DRESS: 'FEE_COLLECTION',
  BOOKS: 'FEE_COLLECTION',
};

const makeReceiptNumber = (schoolId) => {
  const ts = Date.now();
  const r = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, '0');
  return `RCP-${schoolId.toString().slice(-4)}-${ts}-${r}`;
};

const makeBillNumber = (schoolId) => {
  const ts = Date.now();
  const r = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, '0');
  return `BILL-${schoolId.toString().slice(-4)}-${ts}-${r}`;
};

const makeTransactionGroupId = (schoolId) => {
  const ts = Date.now();
  const r = Math.floor(Math.random() * 10000)
    .toString()
    .padStart(4, '0');
  return `PTX-${schoolId.toString().slice(-4)}-${ts}-${r}`;
};

const getSessionFilter = (sessionId) => {
  if (!sessionId) return {};
  return {
    $or: [
      { sessionId },
      { sessionId: null },
      { sessionId: { $exists: false } },
    ],
  };
};

const getBillMonthYear = (bill) => {
  return extractBillMonthYear(bill);
};

const ensureUniqueReceiptNumber = async ({ schoolId, mongoSession }) => {
  let attempts = 0;
  let receiptNumber;
  do {
    receiptNumber = makeReceiptNumber(schoolId);
    attempts += 1;
    if (attempts > 20) {
      throw new PaymentEngineError('Could not generate receipt number', 500);
    }
  } while (await Payment.findOne({ receiptNumber }).session(mongoSession));
  return receiptNumber;
};

const ensureUniqueBillNumber = async ({ schoolId, mongoSession }) => {
  let attempts = 0;
  let billNumber;
  do {
    billNumber = makeBillNumber(schoolId);
    attempts += 1;
    if (attempts > 20) {
      throw new PaymentEngineError('Could not generate bill number', 500);
    }
  } while (await Bill.findOne({ billNumber }).session(mongoSession));
  return billNumber;
};

const resolveActiveSessionId = async ({ schoolId, reqSessionId, mongoSession }) => {
  if (reqSessionId) return reqSessionId;

  const activeSession = await AcademicSession.findOne({
    schoolId,
    isActive: true,
  }).session(mongoSession);

  if (!activeSession?._id) {
    throw new PaymentEngineError('No active academic session found', 400);
  }

  return activeSession._id;
};

const normalizeTransportBillSource = async ({ bill, schoolId, sessionId, mongoSession }) => {
  if (bill.billType !== 'TRANSPORT') return;

  const directFee = await TransportFee.findOne({
    _id: bill.sourceId,
    studentId: bill.studentId,
    schoolId,
    ...getSessionFilter(sessionId),
  }).session(mongoSession);

  if (directFee) return;

  const assignmentFromSource = await StudentTransport.findOne({
    _id: bill.sourceId,
    studentId: bill.studentId,
    schoolId,
  }).session(mongoSession);

  const assignment =
    assignmentFromSource ||
    (await StudentTransport.findOne({
      studentId: bill.studentId,
      schoolId,
      status: 'ACTIVE',
    }).session(mongoSession));

  if (!assignment) return;

  const { month, year } = getBillMonthYear(bill);
  if (!month || !year) return;

  let feeRecord = await TransportFee.findOne({
    studentId: bill.studentId,
    routeId: assignment.routeId,
    schoolId,
    month,
    year,
    ...getSessionFilter(sessionId),
  }).session(mongoSession);

  if (!feeRecord) {
    feeRecord = await TransportFee.create([
      {
        studentId: bill.studentId,
        routeId: assignment.routeId,
        vehicleId: assignment.vehicleId,
        schoolId,
        sessionId,
        amount: Number(bill.totalAmount || bill.dueAmount || 0),
        status: bill.status === 'PAID' ? 'PAID' : 'PENDING',
        paymentDate: bill.status === 'PAID' ? new Date() : null,
        month,
        year,
      },
    ], { session: mongoSession }).then((docs) => docs[0]);
  }

  if (feeRecord && String(bill.sourceId) !== String(feeRecord._id)) {
    bill.sourceId = feeRecord._id;
    bill.sourceType = 'StudentTransport';
    await bill.save({ session: mongoSession });
  }
};

const normalizeHostelBillSource = async ({ bill, schoolId, mongoSession }) => {
  if (bill.billType !== 'HOSTEL') return;

  const assignment = await StudentHostel.findOne({
    _id: bill.sourceId,
    studentId: bill.studentId,
    schoolId,
  }).session(mongoSession);

  if (assignment) return;

  const fallbackAssignment = await StudentHostel.findOne({
    studentId: bill.studentId,
    schoolId,
    status: 'ACTIVE',
  }).session(mongoSession);

  if (!fallbackAssignment) return;

  bill.sourceId = fallbackAssignment._id;
  bill.sourceType = 'StudentHostel';
  await bill.save({ session: mongoSession });
};

const normalizeBillSourceForConsistency = async ({ bill, schoolId, sessionId, mongoSession }) => {
  await normalizeTransportBillSource({ bill, schoolId, sessionId, mongoSession });
  await normalizeHostelBillSource({ bill, schoolId, mongoSession });
};

const processBillPayments = async ({
  schoolId,
  actorId,
  reqSessionId,
  paymentMode,
  notes,
  billItems,
  allOrNothing = true,
  mongoSession = null,
  transactionGroupId = null,
}) => {
  if (!Array.isArray(billItems) || billItems.length === 0) {
    throw new PaymentEngineError('No bills selected');
  }
  if (!paymentMode) {
    throw new PaymentEngineError('Payment mode required');
  }

  const ownsSession = !mongoSession;
  const sessionHandle = mongoSession || (await mongoose.startSession());
  const groupId = transactionGroupId || makeTransactionGroupId(schoolId);

  const runCore = async () => {
      const sessionId = await resolveActiveSessionId({
        schoolId,
        reqSessionId,
        mongoSession: sessionHandle,
      });

      const billIds = [...new Set(billItems.map((b) => String(b.billId)))];
      const dbBills = await Bill.find({
        _id: { $in: billIds },
        schoolId,
        ...getSessionFilter(reqSessionId || sessionId),
      }).session(sessionHandle);

      const billMap = new Map(dbBills.map((b) => [String(b._id), b]));
      const receipts = [];
      const warnings = [];

      for (const item of billItems) {
        const bill = billMap.get(String(item.billId));
        if (!bill) {
          if (allOrNothing) {
            throw new PaymentEngineError('Bill not found', 404, { billId: item.billId });
          }
          warnings.push({ billId: item.billId, error: 'Bill not found' });
          continue;
        }

        if (bill.status === 'PAID') {
          const existingPayment = await Payment.findOne({
            billId: bill._id,
            schoolId,
          })
            .sort({ paymentDate: -1 })
            .session(sessionHandle)
            .lean();

          if (existingPayment) {
            receipts.push({
              receiptNumber: existingPayment.receiptNumber,
              billId: bill._id,
              billNumber: bill.billNumber,
              billType: bill.billType,
              description: bill.description,
              amount: Number(existingPayment.amount || bill.paidAmount || 0),
              paymentId: existingPayment._id,
              transactionGroupId: existingPayment.transactionGroupId || groupId,
              existing: true,
            });
          } else {
            warnings.push({ billId: item.billId, error: 'Already paid (no receipt found)' });
          }
          continue;
        }

        const requested = Number(item.amount || bill.dueAmount);
        if (!requested || requested <= 0) {
          if (allOrNothing) {
            throw new PaymentEngineError('Invalid payment amount', 400, { billId: item.billId });
          }
          warnings.push({ billId: item.billId, error: 'Invalid amount' });
          continue;
        }

        if (requested > bill.dueAmount) {
          throw new PaymentEngineError('Payment amount exceeds due amount', 400, {
            billId: item.billId,
          });
        }

        await normalizeBillSourceForConsistency({
          bill,
          schoolId,
          sessionId: bill.sessionId || sessionId,
          mongoSession: sessionHandle,
        });

        const receiptNumber = await ensureUniqueReceiptNumber({
          schoolId,
          mongoSession: sessionHandle,
        });

        const payment = await Payment.create([
          {
            receiptNumber,
            transactionGroupId: groupId,
            billId: bill._id,
            studentId: bill.studentId,
            schoolId,
            sessionId: bill.sessionId || sessionId,
            amount: requested,
            paymentMode,
            paymentDate: new Date(),
            collectedBy: actorId,
            notes: notes || '',
          },
        ], { session: sessionHandle }).then((docs) => docs[0]);

        bill.paidAmount += requested;
        await bill.save({ session: sessionHandle });

        const { month, year } = getBillMonthYear(bill);
        await syncBillPaymentToSource(bill, {
          mongoSession: sessionHandle,
          sessionId: bill.sessionId || sessionId,
          month,
          year,
        });

        await LedgerEntry.create([
          {
            schoolId,
            sessionId: bill.sessionId || sessionId,
            entryType: 'DEBIT',
            category: BILL_TYPE_TO_CATEGORY[bill.billType] || 'FEE_COLLECTION',
            amount: requested,
            sourceModel: 'Payment',
            referenceId: payment._id,
            description: `Fee collected — ${bill.description}`,
            entryDate: new Date(),
            performedBy: actorId,
          },
        ], { session: sessionHandle });

        receipts.push({
          receiptNumber,
          billId: bill._id,
          billNumber: bill.billNumber,
          billType: bill.billType,
          description: bill.description,
          amount: requested,
          paymentId: payment._id,
          transactionGroupId: groupId,
        });
      }

      if (!receipts.length) {
        throw new PaymentEngineError('No valid bills to process', 400, warnings);
      }

      return {
        success: true,
        sessionId,
        receipts,
        warnings,
        billIds: receipts.map((r) => String(r.billId)),
        totalCollected: receipts.reduce((sum, r) => sum + Number(r.amount || 0), 0),
        transactionGroupId: groupId,
      };
    };

  try {
    if (ownsSession) {
      return await sessionHandle.withTransaction(runCore);
    }
    return await runCore();
  } finally {
    if (ownsSession) {
      await sessionHandle.endSession();
    }
  }
};

const ensureHostelBill = async ({
  schoolId,
  studentId,
  actorId,
  sessionId,
  assignment,
  month,
  year,
  amount,
  mongoSession,
}) => {
  const monthNames = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const description = `Hostel Fee — ${monthNames[month]} ${year}`;

  let bill = await Bill.findOne({
    studentId,
    schoolId,
    billType: 'HOSTEL',
    sourceType: 'StudentHostel',
    sourceId: assignment._id,
    description,
  }).session(mongoSession);

  if (!bill) {
    const billNumber = await ensureUniqueBillNumber({ schoolId, mongoSession });
    bill = await Bill.create([
      {
        billNumber,
        studentId,
        schoolId,
        sessionId,
        billType: 'HOSTEL',
        sourceType: 'StudentHostel',
        sourceId: assignment._id,
        description,
        totalAmount: amount,
        paidAmount: 0,
        dueAmount: amount,
        status: 'UNPAID',
        createdBy: actorId,
      },
    ], { session: mongoSession }).then((docs) => docs[0]);
  }

  return bill;
};

const ensureTransportBill = async ({
  schoolId,
  studentId,
  actorId,
  sessionId,
  feeRecord,
  month,
  year,
  amount,
  mongoSession,
}) => {
  const description = `Transport Fee — ${month}/${year}`;

  let bill = await Bill.findOne({
    studentId,
    schoolId,
    billType: 'TRANSPORT',
    sourceType: 'StudentTransport',
    sourceId: feeRecord._id,
  }).session(mongoSession);

  if (!bill) {
    const billNumber = await ensureUniqueBillNumber({ schoolId, mongoSession });
    bill = await Bill.create([
      {
        billNumber,
        studentId,
        schoolId,
        sessionId,
        billType: 'TRANSPORT',
        sourceType: 'StudentTransport',
        sourceId: feeRecord._id,
        description,
        totalAmount: amount,
        paidAmount: 0,
        dueAmount: amount,
        status: 'UNPAID',
        createdBy: actorId,
      },
    ], { session: mongoSession }).then((docs) => docs[0]);
  }

  return bill;
};

const processHostelMonthsPayment = async ({
  schoolId,
  actorId,
  reqSessionId,
  studentId,
  hostelId,
  months,
  paymentMethod,
}) => {
  const mongoSession = await mongoose.startSession();
  try {
    return await mongoSession.withTransaction(async () => {
      const sessionId = await resolveActiveSessionId({ schoolId, reqSessionId, mongoSession });

      const assignment = await StudentHostel.findOne({
        studentId,
        hostelId,
        schoolId,
        status: 'ACTIVE',
      }).session(mongoSession);

      if (!assignment) {
        throw new PaymentEngineError('Active hostel assignment not found', 404);
      }

      const billItems = [];
      for (const m of months) {
        const month = Number(m.month);
        const year = Number(m.year);
        const amount = Number(m.amount || 0);
        if (!month || !year || month < 1 || month > 12 || amount <= 0) continue;

        const bill = await ensureHostelBill({
          schoolId,
          studentId,
          actorId,
          sessionId,
          assignment,
          month,
          year,
          amount,
          mongoSession,
        });
        billItems.push({ billId: bill._id, amount });
      }

      if (!billItems.length) {
        throw new PaymentEngineError('No valid months to process', 400);
      }

      return processBillPayments({
        schoolId,
        actorId,
        reqSessionId: sessionId,
        paymentMode: paymentMethod === 'ONLINE' ? 'Online' : paymentMethod === 'CHEQUE' ? 'Cheque' : 'Cash',
        notes: '',
        billItems,
        allOrNothing: true,
        mongoSession,
      });
    });
  } finally {
    await mongoSession.endSession();
  }
};

const processTransportMonthsPayment = async ({
  schoolId,
  actorId,
  reqSessionId,
  studentId,
  routeId,
  vehicleId,
  months,
  paymentMethod,
}) => {
  const mongoSession = await mongoose.startSession();
  try {
    return await mongoSession.withTransaction(async () => {
      const sessionId = await resolveActiveSessionId({ schoolId, reqSessionId, mongoSession });

      const billItems = [];
      for (const m of months) {
        const month = Number(m.month);
        const year = Number(m.year);
        const amount = Number(m.amount || 0);
        if (!month || !year || month < 1 || month > 12 || amount <= 0) continue;

        let feeRecord = await TransportFee.findOne({
          studentId,
          routeId,
          schoolId,
          month,
          year,
          ...getSessionFilter(sessionId),
        }).session(mongoSession);

        if (!feeRecord) {
          feeRecord = await TransportFee.create([
            {
              studentId,
              routeId,
              vehicleId,
              schoolId,
              sessionId,
              amount,
              status: 'PENDING',
              month,
              year,
            },
          ], { session: mongoSession }).then((docs) => docs[0]);
        }

        const bill = await ensureTransportBill({
          schoolId,
          studentId,
          actorId,
          sessionId,
          feeRecord,
          month,
          year,
          amount,
          mongoSession,
        });

        billItems.push({ billId: bill._id, amount });
      }

      if (!billItems.length) {
        throw new PaymentEngineError('No valid months to process', 400);
      }

      return processBillPayments({
        schoolId,
        actorId,
        reqSessionId: sessionId,
        paymentMode: paymentMethod === 'ONLINE' ? 'Online' : paymentMethod === 'CHEQUE' ? 'Cheque' : 'Cash',
        notes: '',
        billItems,
        allOrNothing: true,
        mongoSession,
      });
    });
  } finally {
    await mongoSession.endSession();
  }
};

const processExamFeePayment = async ({
  schoolId,
  actorId,
  reqSessionId,
  studentId,
  examFormId,
  amount,
  paymentMode,
}) => {
  const mongoSession = await mongoose.startSession();
  try {
    return await mongoSession.withTransaction(async () => {
      const sessionId = await resolveActiveSessionId({ schoolId, reqSessionId, mongoSession });

      const examPayment = await ExamPayment.create([
        {
          studentId,
          examFormId,
          amount,
          paymentMode,
          status: 'Paid',
          receiptNumber: `EXAM-${Date.now()}`,
          sessionId,
          schoolId,
          createdBy: actorId,
        },
      ], { session: mongoSession }).then((docs) => docs[0]);

      const ExamForm = require('../models/ExamForm');
      const examForm = await ExamForm.findById(examFormId)
        .populate('examId', 'name')
        .session(mongoSession)
        .lean();
      const description = examForm?.examId?.name
        ? `Exam Fee — ${examForm.examId.name}`
        : 'Exam Fee';

      let bill = await Bill.findOne({
        studentId,
        schoolId,
        billType: 'EXAM',
        sourceType: 'ExamPayment',
        sourceId: examPayment._id,
        description,
      }).session(mongoSession);

      if (!bill) {
        const billNumber = await ensureUniqueBillNumber({ schoolId, mongoSession });
        bill = await Bill.create([
          {
            billNumber,
            studentId,
            schoolId,
            sessionId,
            billType: 'EXAM',
            sourceType: 'ExamPayment',
            sourceId: examPayment._id,
            description,
            totalAmount: amount,
            paidAmount: 0,
            dueAmount: amount,
            status: 'UNPAID',
            createdBy: actorId,
          },
        ], { session: mongoSession }).then((docs) => docs[0]);
      }

      const paymentResult = await processBillPayments({
        schoolId,
        actorId,
        reqSessionId: sessionId,
        paymentMode: paymentMode === 'Online' ? 'Online' : 'Cash',
        notes: `Exam payment — ${examPayment.receiptNumber}`,
        billItems: [{ billId: bill._id, amount }],
        allOrNothing: true,
        mongoSession,
      });

      return {
        examPayment,
        paymentResult,
      };
    });
  } finally {
    await mongoSession.endSession();
  }
};

const processAdmissionComponentsPayment = async ({
  schoolId,
  actorId,
  reqSessionId,
  studentId,
  admissionId,
  components,
  paymentMode = 'Cash',
  admissionDate,
}) => {
  const mongoSession = await mongoose.startSession();
  try {
    return await mongoSession.withTransaction(async () => {
      const sessionId = await resolveActiveSessionId({ schoolId, reqSessionId, mongoSession });
      const normalizedAdmissionDate = admissionDate ? new Date(admissionDate) : new Date();
      const admissionMonth = normalizedAdmissionDate.getMonth() + 1;
      const admissionYear = normalizedAdmissionDate.getFullYear();

      const findLinkedMonthBill = async (component) => {
        const candidates = await Bill.find({
          studentId,
          schoolId,
          billType: component.billType,
          ...getSessionFilter(sessionId),
          status: { $in: ['UNPAID', 'PARTIAL', 'PAID'] },
        }).session(mongoSession);

        const monthMatched = candidates.filter((b) => {
          const { month, year } = extractBillMonthYear(b);
          return month === admissionMonth && year === admissionYear;
        });
        if (!monthMatched.length) return null;

        // Prefer canonical module bills over Admission-source bills
        const nonAdmission = monthMatched.find((b) => b.sourceType !== 'Admission');
        if (nonAdmission) return nonAdmission;

        // Fallback to same admission bill if already present.
        return monthMatched.find(
          (b) =>
            b.sourceType === 'Admission' &&
            String(b.sourceId || '') === String(admissionId || '')
        ) || null;
      };

      const billItems = [];
      for (const component of components || []) {
        const amount = Number(component.amount || 0);
        if (amount <= 0) continue;

        let bill = await findLinkedMonthBill(component);

        if (!bill) {
          bill = await Bill.findOne({
            studentId,
            schoolId,
            billType: component.billType,
            sourceType: 'Admission',
            sourceId: admissionId,
            description: component.description,
          }).session(mongoSession);
        }

        if (!bill) {
          const billNumber = await ensureUniqueBillNumber({ schoolId, mongoSession });
          bill = await Bill.create([
            {
              billNumber,
              studentId,
              schoolId,
              sessionId,
              billType: component.billType,
              sourceType: 'Admission',
              sourceId: admissionId,
              description: component.description,
              totalAmount: amount,
              paidAmount: 0,
              dueAmount: amount,
              status: 'UNPAID',
              createdBy: actorId,
            },
          ], { session: mongoSession }).then((docs) => docs[0]);
        }

        if (bill.status !== 'PAID') {
          billItems.push({
            billId: bill._id,
            amount: Math.min(amount, Number(bill.dueAmount || amount)),
          });
        }
      }

      if (!billItems.length) {
        return {
          success: true,
          receipts: [],
          billIds: [],
          totalCollected: 0,
          warnings: [],
        };
      }

      return processBillPayments({
        schoolId,
        actorId,
        reqSessionId: sessionId,
        paymentMode,
        notes: 'Admission payment',
        billItems,
        allOrNothing: true,
        mongoSession,
      });
    });
  } finally {
    await mongoSession.endSession();
  }
};


module.exports = {
  PaymentEngineError,
  processBillPayments,
  processHostelMonthsPayment,
  processTransportMonthsPayment,
  processExamFeePayment,
  processAdmissionComponentsPayment,
  getBillMonthYear,
};
