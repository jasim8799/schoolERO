const mongoose = require('mongoose');
const Notice = require('../models/Notice');
const Student = require('../models/Student');
const Parent = require('../models/Parent');

const handleError = (res, err, context = 'Request') => {
  if (err.name === 'CastError') {
    return res.status(400).json({
      success: false,
      message: `Invalid ID format: ${err.path}`,
    });
  }
  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors || {})
      .map((entry) => entry.message)
      .join(', ');
    return res.status(422).json({
      success: false,
      message: `Validation failed: ${messages}`,
    });
  }
  console.error(`${context} error:`, err.message);
  return res.status(500).json({
    success: false,
    message: 'Internal server error. Please try again later.',
    error: err.message,
  });
};

const _ip = (req) =>
  req.headers['x-forwarded-for']?.split(',')[0]?.trim()
  || req.socket?.remoteAddress || req.ip || '0.0.0.0';

const _audit = async (action, entityType, entityId, desc, details, req) => {
  try {
    const { auditLog } = require('../utils/auditLog');
    await auditLog({
      action, entityType, entityId,
      userId: req.user?._id,
      schoolId: req.user?.schoolId,
      description: desc,
      details,
      ipAddress: _ip(req),
      role: req.user?.role || 'SYSTEM',
    });
  } catch (_) {}
};

function _activeExpiryFilter() {
  return {
    $or: [
      { expiryDate: null },
      { expiryDate: { $exists: false } },
      { expiryDate: { $gte: new Date() } },
    ],
  };
}

function _buildFilter(schoolId, audienceConditions) {
  return {
    schoolId,
    isActive: true,
    $and: [{ $or: audienceConditions }, _activeExpiryFilter()],
  };
}

const createNotice = async (req, res) => {
  try {
    const {
      title,
      message,
      target,
      classId,
      isImportant,
      expiryDate,
      announcementType,
      eventDate,
      attachments,
    } = req.body;
    const { schoolId, _id: createdBy, role, sessionId } = req.user;

    if (!title || !message) {
      return res.status(400).json({
        success: false,
        message: 'Title and message are required',
      });
    }
    if (title && title.trim().length > 200) {
      return res.status(400).json({
        success: false,
        message: 'Title cannot exceed 200 characters',
      });
    }
    if (message && message.trim().length > 5000) {
      return res.status(400).json({
        success: false,
        message: 'Message cannot exceed 5000 characters',
      });
    }
    if (
      target === 'Class'
      && classId
      && !mongoose.Types.ObjectId.isValid(classId)
    ) {
      return res.status(400).json({
        success: false,
        message: 'Invalid classId format',
      });
    }

    // Teachers can ONLY send to a specific class
    if (role === 'TEACHER') {
      if (target !== 'Class' || !classId) {
        return res.status(403).json({
          success: false,
          message: 'Teachers can only send notices to a specific class. Please select "Specific Class" and choose a class.',
        });
      }
    }

    const validTypes = ['Notice', 'Announcement'];
    const finalType = validTypes.includes(announcementType) ? announcementType : 'Notice';

    const payload = {
      schoolId,
      sessionId,
      title: title.trim(),
      message: message.trim(),
      target: target || 'All School',
      classId: target === 'Class' && classId ? classId : null,
      announcementType: finalType,
      eventDate: eventDate ? new Date(eventDate) : null,
      attachments: Array.isArray(attachments) ? attachments : [],
      isImportant: isImportant === true,
      expiryDate: expiryDate ? new Date(expiryDate) : null,
      createdBy,
    };

    const notice = await Notice.create(payload);
    _audit('NOTICE_CREATED', 'NOTICE', notice._id,
      `Notice "${notice.title}" created`, {}, req);
    return res.status(201).json({ success: true, data: notice });
  } catch (err) {
    return handleError(res, err, 'Create notice');
  }
};

const getAllNotices = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { target, classId } = req.query;

    const filter = { schoolId };
    if (target) filter.target = target;
    if (classId) filter.classId = classId;

    const notices = await Notice.find(filter)
      .populate('classId', 'name')
      .populate('createdBy', 'name')
      .sort({ createdAt: -1 })
      .lean();

    return res.json({ success: true, data: notices });
  } catch (err) {
    return handleError(res, err, 'Get notices');
  }
};

const getStudentNotices = async (req, res) => {
  try {
    const { schoolId, _id: userId } = req.user;

    const student = await Student.findOne({ userId, schoolId }).select('classId').lean();

    const audienceConditions = [{ target: 'All School' }, { target: 'Students' }];
    if (student?.classId) {
      audienceConditions.push({ target: 'Class', classId: student.classId });
    }

    const notices = await Notice.find(_buildFilter(schoolId, audienceConditions))
      .populate('classId', 'name')
      .sort({ createdAt: -1 })
      .lean();

    return res.json({ success: true, data: notices });
  } catch (err) {
    return handleError(res, err, 'Get student notices');
  }
};

const getParentNotices = async (req, res) => {
  try {
    const { schoolId, _id: userId } = req.user;
    const { studentId } = req.query;

    const parent = await Parent.findOne({ userId, schoolId }).select('children').lean();

    let classId = null;
    if (studentId && parent?.children?.some((id) => id.toString() === studentId.toString())) {
      const student = await Student.findOne({ _id: studentId, schoolId }).select('classId').lean();
      classId = student?.classId || null;
    } else if (parent?.children?.length) {
      const student = await Student.findOne({
        _id: { $in: parent.children },
        schoolId,
      })
        .select('classId')
        .lean();
      classId = student?.classId || null;
    }

    const audienceConditions = [{ target: 'All School' }, { target: 'Parents' }];
    if (classId) {
      audienceConditions.push({ target: 'Class', classId });
    }

    const notices = await Notice.find(_buildFilter(schoolId, audienceConditions))
      .populate('classId', 'name')
      .sort({ createdAt: -1 })
      .lean();

    return res.json({ success: true, data: notices });
  } catch (err) {
    return handleError(res, err, 'Get parent notices');
  }
};

const getTeacherNotices = async (req, res) => {
  try {
    const { schoolId, _id: userId } = req.user;

    const audienceConditions = [{ target: 'All School' }, { target: 'Teachers' }];

    // Also include class notices created by this teacher
    const teacherCreatedNotices = await Notice.find({
      schoolId,
      createdBy: userId,
      target: 'Class',
    }).select('classId').lean();

    const classIds = teacherCreatedNotices.map((n) => n.classId).filter(Boolean);
    for (const cid of classIds) {
      audienceConditions.push({ target: 'Class', classId: cid });
    }

    const notices = await Notice.find(_buildFilter(schoolId, audienceConditions))
      .populate('classId', 'name')
      .populate('createdBy', 'name')
      .sort({ createdAt: -1 })
      .lean();

    return res.json({ success: true, data: notices });
  } catch (err) {
    return handleError(res, err, 'Get teacher notices');
  }
};

const updateNotice = async (req, res) => {
  try {
    const { id } = req.params;
    const { schoolId, role, _id: userId } = req.user;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid notice ID format',
      });
    }

    const notice = await Notice.findOne({ _id: id, schoolId });
    if (!notice) {
      return res.status(404).json({
        success: false,
        message: 'Notice not found',
      });
    }

    if (
      role !== 'PRINCIPAL'
      && role !== 'OPERATOR'
      && notice.createdBy.toString() !== userId.toString()
    ) {
      return res.status(403).json({
        success: false,
        message: 'You can only edit notices you created',
      });
    }

    const {
      title,
      message,
      target,
      classId,
      isImportant,
      expiryDate,
      announcementType,
      eventDate,
      attachments,
      isActive,
    } = req.body;

    if (title !== undefined && !title.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Title cannot be empty',
      });
    }
    if (message !== undefined && !message.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Message cannot be empty',
      });
    }

    const updates = {};
    if (title !== undefined) updates.title = title.trim();
    if (message !== undefined) updates.message = message.trim();
    if (target !== undefined) updates.target = target;
    if (classId !== undefined) {
      updates.classId = target === 'Class' && classId ? classId : null;
    }
    if (isImportant !== undefined) updates.isImportant = isImportant;
    if (expiryDate !== undefined) {
      updates.expiryDate = expiryDate ? new Date(expiryDate) : null;
    }
    if (eventDate !== undefined) {
      updates.eventDate = eventDate ? new Date(eventDate) : null;
    }
    if (announcementType !== undefined) {
      updates.announcementType = announcementType;
    }
    if (attachments !== undefined) updates.attachments = attachments;
    if (isActive !== undefined) updates.isActive = isActive;

    const updated = await Notice.findByIdAndUpdate(
      id,
      { $set: updates },
      { new: true, runValidators: true },
    )
      .populate('classId', 'name')
      .populate('createdBy', 'name');

    _audit(
      'NOTICE_UPDATED',
      'NOTICE',
      id,
      `Notice "${updated.title}" updated`,
      {},
      req,
    );

    return res.json({ success: true, data: updated });
  } catch (err) {
    return handleError(res, err, 'Update notice');
  }
};

const deleteNotice = async (req, res) => {
  try {
    const { id } = req.params;
    const { schoolId } = req.user;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid notice ID format',
      });
    }

    const notice = await Notice.findOneAndDelete({ _id: id, schoolId });
    if (!notice) {
      return res.status(404).json({ success: false, message: 'Notice not found' });
    }
    _audit('NOTICE_DELETED', 'NOTICE', id,
      `Notice deleted`, {}, req);
    return res.json({ success: true, message: 'Notice deleted' });
  } catch (err) {
    return handleError(res, err, 'Delete notice');
  }
};

module.exports = {
  createNotice,
  getAllNotices,
  getStudentNotices,
  getParentNotices,
  getTeacherNotices,
  deleteNotice,
  updateNotice,
};
