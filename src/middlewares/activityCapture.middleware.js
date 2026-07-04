const { auditLog } = require('../utils/auditLog');

const Student = require('../models/Student');
const User = require('../models/User');
const Bill = require('../models/Bill');
const Route = require('../models/Route');
const Hostel = require('../models/Hostel');
const Room = require('../models/Room');
const Admission = require('../models/Admission');
const StudentTransport = require('../models/StudentTransport');
const StudentHostel = require('../models/StudentHostel');

const ROLE_MODULE_MAP = {
  PRINCIPAL: 'Principal',
  OPERATOR: 'Operator',
  TEACHER: 'Teacher',
  PARENT: 'Parent',
  STUDENT: 'Student',
};

function _asId(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    return value._id?.toString?.() || value.id?.toString?.() || null;
  }
  return value.toString();
}

function _reqUserId(req) {
  return req.user?.userId || req.user?._id || null;
}

function _reqSchoolId(req) {
  return req.user?.schoolId?._id || req.user?.schoolId || req.schoolId || null;
}

function _reqSessionId(req) {
  return req.user?.sessionId || req.activeSession?._id || null;
}

function _reqUserName(req) {
  return req.user?.name || req.user?.userName || null;
}

async function _studentLabel(studentId, schoolId) {
  if (!studentId || !schoolId) return null;
  const student = await Student.findOne({ _id: studentId, schoolId })
    .select('name classId')
    .populate('classId', 'name')
    .lean();
  if (!student) return null;
  const className = student.classId?.name ? ` (${student.classId.name})` : '';
  return `${student.name}${className}`;
}

async function _billContext(billIds, schoolId) {
  if (!Array.isArray(billIds) || billIds.length === 0 || !schoolId) return null;
  const firstBill = await Bill.findOne({ _id: billIds[0], schoolId })
    .select('studentId billType totalAmount')
    .populate({ path: 'studentId', select: 'name classId', populate: { path: 'classId', select: 'name' } })
    .lean();
  if (!firstBill) return null;
  const studentName = firstBill.studentId?.name || 'student';
  const className = firstBill.studentId?.classId?.name ? ` (${firstBill.studentId.classId.name})` : '';
  return {
    studentLabel: `${studentName}${className}`,
    entityId: firstBill._id,
    entityType: 'BILL',
    billType: firstBill.billType,
  };
}

function createActivityCapture(resolver) {
  return (req, res, next) => {
    let responseBody;
    const originalJson = res.json.bind(res);

    res.json = function patchedActivityJson(body) {
      responseBody = body;
      return originalJson(body);
    };

    res.on('finish', () => {
      if (req.method === 'GET' || res.statusCode < 200 || res.statusCode >= 400) {
        return;
      }

      setImmediate(async () => {
        try {
          const payload = await resolver({ req, res, body: responseBody });
          if (!payload) return;

          await auditLog({
            action: payload.action,
            userId: _reqUserId(req),
            userName: _reqUserName(req),
            role: req.user?.role || 'SYSTEM',
            entityType: payload.entityType,
            entityId: payload.entityId || null,
            entityName: payload.entityName || null,
            description: payload.description,
            schoolId: payload.schoolId || _reqSchoolId(req),
            sessionId: payload.sessionId || _reqSessionId(req),
            details: {
              ...(payload.details || {}),
              module: payload.module,
              activityAction: payload.displayAction,
              userName: _reqUserName(req),
            },
            req,
          });
        } catch (_) {}
      });
    });

    next();
  };
}

const captureAdmissionCreate = createActivityCapture(async ({ req, body }) => {
  const schoolId = _reqSchoolId(req);
  const studentLabel = await _studentLabel(req.body.studentId, schoolId);
  return {
    action: 'ADMISSION_CREATED',
    entityType: 'ADMISSION',
    entityId: _asId(body?.data?._id || body?._id),
    description: studentLabel
      ? `New student admitted: ${studentLabel}`
      : 'New student admission created',
    module: 'Admission',
    displayAction: 'Created',
    details: {
      studentId: req.body.studentId || null,
      studentLabel,
    },
  };
});

const captureAdmissionUpdate = createActivityCapture(async ({ req }) => {
  let admissionLabel = null;
  const schoolId = _reqSchoolId(req);
  const admission = await Admission.findOne({ _id: req.params.id, schoolId })
    .populate({ path: 'studentId', select: 'name classId', populate: { path: 'classId', select: 'name' } })
    .lean()
    .catch(() => null);
  if (admission?.studentId?.name) {
    admissionLabel = `${admission.studentId.name}${admission.studentId.classId?.name ? ` (${admission.studentId.classId.name})` : ''}`;
  }
  return {
    action: 'ADMISSION_UPDATED',
    entityType: 'ADMISSION',
    entityId: req.params.id,
    description: admissionLabel
      ? `Admission updated for ${admissionLabel}`
      : 'Admission record updated',
    module: 'Admission',
    displayAction: 'Updated',
  };
});

const captureAdmissionDelete = createActivityCapture(async ({ req }) => ({
  action: 'ADMISSION_UPDATED',
  entityType: 'ADMISSION',
  entityId: req.params.id,
  description: 'Admission record deleted',
  module: 'Admission',
  displayAction: 'Deleted',
}));

const captureTransportAssign = createActivityCapture(async ({ req, body }) => {
  const schoolId = _reqSchoolId(req);
  const studentLabel = await _studentLabel(req.body.studentId, schoolId);
  const route = await Route.findById(req.body.routeId).select('name').lean().catch(() => null);
  return {
    action: 'TRANSPORT_ASSIGNED',
    entityType: 'TRANSPORT',
    entityId: _asId(body?.data?._id || body?._id),
    description: `Assigned ${route?.name || 'route'} to ${studentLabel || 'student'}`,
    module: 'Transport',
    displayAction: 'Assigned',
  };
});

const captureTransportRemove = createActivityCapture(async ({ req }) => {
  const schoolId = _reqSchoolId(req);
  const assignment = await StudentTransport.findOne({ _id: req.params.id, schoolId })
    .populate({ path: 'studentId', select: 'name classId', populate: { path: 'classId', select: 'name' } })
    .populate('routeId', 'name')
    .lean()
    .catch(() => null);
  const studentLabel = assignment?.studentId?.name
    ? `${assignment.studentId.name}${assignment.studentId.classId?.name ? ` (${assignment.studentId.classId.name})` : ''}`
    : 'student';
  return {
    action: 'TRANSPORT_ASSIGNED',
    entityType: 'TRANSPORT',
    entityId: req.params.id,
    description: `Removed transport assignment${assignment?.routeId?.name ? ` (${assignment.routeId.name})` : ''} for ${studentLabel}`,
    module: 'Transport',
    displayAction: 'Removed',
  };
});

const captureTransportReassign = createActivityCapture(async ({ req }) => {
  const schoolId = _reqSchoolId(req);
  const assignment = await StudentTransport.findOne({ _id: req.params.id, schoolId })
    .populate({ path: 'studentId', select: 'name classId', populate: { path: 'classId', select: 'name' } })
    .populate('routeId', 'name')
    .lean()
    .catch(() => null);
  const studentLabel = assignment?.studentId?.name
    ? `${assignment.studentId.name}${assignment.studentId.classId?.name ? ` (${assignment.studentId.classId.name})` : ''}`
    : 'student';
  return {
    action: 'TRANSPORT_ASSIGNED',
    entityType: 'TRANSPORT',
    entityId: req.params.id,
    description: `Reassigned transport route${assignment?.routeId?.name ? ` to ${assignment.routeId.name}` : ''} for ${studentLabel}`,
    module: 'Transport',
    displayAction: 'Reassigned',
  };
});

const captureHostelAssign = createActivityCapture(async ({ req, body }) => {
  const schoolId = _reqSchoolId(req);
  const studentLabel = await _studentLabel(req.body.studentId, schoolId);
  const hostel = await Hostel.findById(req.body.hostelId).select('name').lean().catch(() => null);
  const room = await Room.findById(req.body.roomId).select('roomNumber').lean().catch(() => null);
  return {
    action: 'HOSTEL_ASSIGNED',
    entityType: 'HOSTEL',
    entityId: _asId(body?.data?._id || body?._id),
    description: `Assigned ${hostel?.name || 'hostel'}${room?.roomNumber ? ` / Room ${room.roomNumber}` : ''} to ${studentLabel || 'student'}`,
    module: 'Hostel',
    displayAction: 'Assigned',
  };
});

const captureHostelRemove = createActivityCapture(async ({ req }) => {
  const schoolId = _reqSchoolId(req);
  const assignment = await StudentHostel.findOne({ _id: req.params.id, schoolId })
    .populate({ path: 'studentId', select: 'name classId', populate: { path: 'classId', select: 'name' } })
    .populate('hostelId', 'name')
    .populate('roomId', 'roomNumber')
    .lean()
    .catch(() => null);
  const studentLabel = assignment?.studentId?.name
    ? `${assignment.studentId.name}${assignment.studentId.classId?.name ? ` (${assignment.studentId.classId.name})` : ''}`
    : 'student';
  return {
    action: 'HOSTEL_ASSIGNED',
    entityType: 'HOSTEL',
    entityId: req.params.id,
    description: `Removed hostel assignment${assignment?.hostelId?.name ? ` (${assignment.hostelId.name})` : ''} for ${studentLabel}`,
    module: 'Hostel',
    displayAction: 'Removed',
  };
});

const captureHostelReassign = createActivityCapture(async ({ req }) => {
  const schoolId = _reqSchoolId(req);
  const assignment = await StudentHostel.findOne({ _id: req.params.id, schoolId })
    .populate({ path: 'studentId', select: 'name classId', populate: { path: 'classId', select: 'name' } })
    .populate('hostelId', 'name')
    .populate('roomId', 'roomNumber')
    .lean()
    .catch(() => null);
  const studentLabel = assignment?.studentId?.name
    ? `${assignment.studentId.name}${assignment.studentId.classId?.name ? ` (${assignment.studentId.classId.name})` : ''}`
    : 'student';
  return {
    action: 'HOSTEL_ASSIGNED',
    entityType: 'HOSTEL',
    entityId: req.params.id,
    description: `Reassigned hostel${assignment?.hostelId?.name ? ` to ${assignment.hostelId.name}` : ''}${assignment?.roomId?.roomNumber ? ` / Room ${assignment.roomId.roomNumber}` : ''} for ${studentLabel}`,
    module: 'Hostel',
    displayAction: 'Reassigned',
  };
});

const capturePromotionExecute = createActivityCapture(async ({ req, body }) => ({
  action: 'PROMOTION_EXECUTED',
  entityType: 'PROMOTION',
  entityId: null,
  description: `Promotion executed from session ${req.body.fromSessionId || ''} to ${req.body.toSessionId || ''}`.trim(),
  module: 'Promotion',
  displayAction: body?.data?.graduated || body?.data?.promoted || body?.data?.retained ? 'Executed' : 'Previewed',
}));

const captureFeeCollection = createActivityCapture(async ({ req, body }) => {
  const schoolId = _reqSchoolId(req);
  const context = await _billContext(req.body.billIds, schoolId);
  const amount = Number(body?.totalCollected || 0);
  return {
    action: 'FEE_COLLECTED',
    entityType: 'FEE_PAYMENT',
    entityId: context?.entityId || null,
    description: context?.studentLabel
      ? `Collected ₹${amount.toFixed(0)} from ${context.studentLabel}`
      : `Collected ₹${amount.toFixed(0)} in fee payment`,
    module: context?.billType === 'TRANSPORT'
      ? 'Transport'
      : context?.billType === 'HOSTEL'
        ? 'Hostel'
        : 'Fees',
    displayAction: 'Collected',
  };
});

const captureBillCreate = createActivityCapture(async ({ req, body }) => {
  const schoolId = _reqSchoolId(req);
  const studentLabel = await _studentLabel(req.body.studentId, schoolId);
  return {
    action: 'BILL_CREATED',
    entityType: 'BILL',
    entityId: _asId(body?.data?._id || body?._id),
    description: `Created ${req.body.billType || 'bill'}${studentLabel ? ` for ${studentLabel}` : ''}`,
    module: req.body.billType === 'TRANSPORT'
      ? 'Transport'
      : req.body.billType === 'HOSTEL'
        ? 'Hostel'
        : 'Fees',
    displayAction: 'Created',
  };
});

const captureBillPayment = createActivityCapture(async ({ req }) => {
  const schoolId = _reqSchoolId(req);
  const bill = await Bill.findOne({ _id: req.params.billId, schoolId })
    .populate({ path: 'studentId', select: 'name classId', populate: { path: 'classId', select: 'name' } })
    .lean()
    .catch(() => null);
  const studentLabel = bill?.studentId?.name
    ? `${bill.studentId.name}${bill.studentId.classId?.name ? ` (${bill.studentId.classId.name})` : ''}`
    : 'student';
  const amount = Number(req.body.amount || 0);
  return {
    action: 'BILL_PAID',
    entityType: 'BILL',
    entityId: req.params.billId,
    description: `Collected ₹${amount.toFixed(0)}${bill?.billType ? ` for ${bill.billType.toLowerCase()} bill` : ''} from ${studentLabel}`,
    module: bill?.billType === 'TRANSPORT'
      ? 'Transport'
      : bill?.billType === 'HOSTEL'
        ? 'Hostel'
        : 'Fees',
    displayAction: 'Collected',
  };
});

const captureUserCreate = createActivityCapture(async ({ req, body }) => {
  const targetRole = (req.body.role || body?.data?.role || '').toString().toUpperCase();
  const name = req.body.name || body?.data?.name || 'User';
  return {
    action: targetRole === 'OPERATOR' ? 'OPERATOR_CREATED' : 'USER_CREATED',
    entityType: 'USER',
    entityId: _asId(body?.data?._id || body?._id),
    description: `${ROLE_MODULE_MAP[targetRole] || 'User'} created: ${name}`,
    module: ROLE_MODULE_MAP[targetRole] || 'User',
    displayAction: 'Created',
  };
});

module.exports = {
  captureAdmissionCreate,
  captureAdmissionUpdate,
  captureAdmissionDelete,
  captureTransportAssign,
  captureTransportRemove,
  captureTransportReassign,
  captureHostelAssign,
  captureHostelRemove,
  captureHostelReassign,
  capturePromotionExecute,
  captureFeeCollection,
  captureBillCreate,
  captureBillPayment,
  captureUserCreate,
};