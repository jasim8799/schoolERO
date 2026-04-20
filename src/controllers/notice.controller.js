const Notice = require('../models/Notice');
const Student = require('../models/Student');
const Parent = require('../models/Parent');

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
    return res.status(201).json({ success: true, data: notice });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
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
    return res.status(500).json({ success: false, message: err.message });
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
    return res.status(500).json({ success: false, message: err.message });
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
    return res.status(500).json({ success: false, message: err.message });
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
    return res.status(500).json({ success: false, message: err.message });
  }
};

const deleteNotice = async (req, res) => {
  try {
    const { id } = req.params;
    const { schoolId } = req.user;

    const notice = await Notice.findOneAndDelete({ _id: id, schoolId });
    if (!notice) {
      return res.status(404).json({ success: false, message: 'Notice not found' });
    }

    return res.json({ success: true, message: 'Notice deleted' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  createNotice,
  getAllNotices,
  getStudentNotices,
  getParentNotices,
  getTeacherNotices,
  deleteNotice,
};
