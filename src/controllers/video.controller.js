const Video = require('../models/Video');
const Class = require('../models/Class');
const Subject = require('../models/Subject');
const { HTTP_STATUS, USER_ROLES } = require('../config/constants');

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

const _resolveContextSessionId = (req) => req.activeSession?._id || req.user?.sessionId || null;

const _validateClassSubjectPair = async ({ classId, subjectId, req }) => {
  const schoolId = req.schoolId;
  const sessionId = _resolveContextSessionId(req);

  const classFilter = { _id: classId, schoolId };
  const subjectFilter = { _id: subjectId, schoolId };
  if (sessionId) {
    classFilter.sessionId = sessionId;
    subjectFilter.sessionId = sessionId;
  }

  const classDoc = await Class.findOne(classFilter).select('_id');
  if (!classDoc) {
    return {
      ok: false,
      message: 'Selected class does not exist in the current school/session',
    };
  }

  const subjectDoc = await Subject.findOne(subjectFilter).select('_id classId');
  if (!subjectDoc) {
    return {
      ok: false,
      message: 'Selected subject does not exist in the current school/session',
    };
  }

  if (subjectDoc.classId?.toString() !== classDoc._id.toString()) {
    return {
      ok: false,
      message: 'Selected subject does not belong to the selected class',
    };
  }

  return { ok: true };
};

// ── POST /api/videos ────────────────────────────────────────────
const createVideo = async (req, res) => {
  try {
    const {
      title,
      description,
      topic,
      chapter,
      classId,
      subjectId,
      videoUrl,
      videoType,
      thumbnailUrl,
      duration,
      isFree,
      visibility,
    } = req.body;

    if (!title || !classId || !subjectId || !videoUrl) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'title, classId, subjectId, and videoUrl are required',
      });
    }

    const pairValidation = await _validateClassSubjectPair({ classId, subjectId, req });
    if (!pairValidation.ok) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: pairValidation.message,
      });
    }

    const video = new Video({
      title,
      description,
      topic,
      chapter: chapter || null,
      classId,
      subjectId,
      videoUrl,
      videoType: videoType || 'external',
      thumbnailUrl,
      duration,
      isFree: isFree !== undefined ? isFree : true,
      visibility: visibility || 'class',
      createdBy: req.user._id || req.user.userId,
      schoolId: req.schoolId,
      sessionId: req.activeSession?._id || req.user.sessionId || null,
    });

    await video.save();
    await video.populate([
      { path: 'classId', select: 'name' },
      { path: 'subjectId', select: 'name' },
      { path: 'createdBy', select: 'name' },
    ]);

    res.status(HTTP_STATUS.CREATED).json({
      success: true,
      data: video,
      message: 'Video uploaded successfully',
    });
    _audit('VIDEO_UPLOADED', 'VIDEO', video._id,
      `Video "${video.title}" uploaded`, {}, req);
  } catch (error) {
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error.message,
    });
  }
};

// ── GET /api/videos ─────────────────────────────────────────────
const getVideos = async (req, res) => {
  try {
    const { classId, subjectId } = req.query;
    const role = req.user.role?.toUpperCase();
    const filter = { schoolId: req.schoolId };

    if (
      role === USER_ROLES.PRINCIPAL ||
      role === USER_ROLES.OPERATOR ||
      role === USER_ROLES.SUPER_ADMIN
    ) {
      if (classId) filter.classId = classId;
      if (subjectId) filter.subjectId = subjectId;
    } else if (role === USER_ROLES.TEACHER) {
      filter.createdBy = req.user._id || req.user.userId;
      if (classId) filter.classId = classId;
      if (subjectId) filter.subjectId = subjectId;
    } else if (role === USER_ROLES.STUDENT) {
      const Student = require('../models/Student');
      const student = await Student.findOne({
        userId: req.user._id || req.user.userId,
        schoolId: req.schoolId,
      });

      if (!student) {
        return res.json({ success: true, data: [] });
      }

      filter.classId = student.classId;
      if (subjectId) filter.subjectId = subjectId;
    } else if (role === USER_ROLES.PARENT) {
      const Parent = require('../models/Parent');
      const parent = await Parent.findOne({
        userId: req.user._id || req.user.userId,
        schoolId: req.schoolId,
      }).populate('children', 'classId');

      if (!parent || !Array.isArray(parent.children) || parent.children.length === 0) {
        return res.json({ success: true, data: [] });
      }

      const childId = req.query.childId;
      let targetChild = parent.children[0];
      if (childId) {
        const found = parent.children.find((c) => c._id.toString() === childId);
        if (found) targetChild = found;
      }

      filter.classId = targetChild.classId;
      if (subjectId) filter.subjectId = subjectId;
    }

    const rawVideos = await Video.find(filter)
      .select('_id title classId subjectId')
      .lean();

    const rawSubjectIds = [...new Set(rawVideos.map((v) => v.subjectId?.toString()).filter(Boolean))];
    const rawSubjects = await Subject.find({ _id: { $in: rawSubjectIds } })
      .select('_id classId')
      .lean();
    const rawSubjectById = new Map(rawSubjects.map((s) => [s._id.toString(), s]));

    const videos = await Video.find(filter)
      .populate('classId', 'name')
      .populate('subjectId', 'name classId')
      .populate('createdBy', 'name')
      .sort({ createdAt: -1 });

    const mismatches = rawVideos.filter((video) => {
      const subject = rawSubjectById.get(video.subjectId?.toString());
      if (!subject) return true;
      return subject.classId?.toString() !== video.classId?.toString();
    });

    if (mismatches.length) {
      await Promise.allSettled(
        mismatches.map((video) => _audit(
          'VIDEO_CLASS_SUBJECT_MISMATCH',
          'VIDEO',
          video._id,
          `Video class/subject mismatch detected for "${video.title}"`,
          {
            videoId: video._id?.toString?.(),
            classId: video.classId?.toString?.(),
            subjectId: video.subjectId?.toString?.(),
          },
          req,
        ))
      );
    }

    res.json({ success: true, data: videos });
  } catch (error) {
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error.message,
    });
  }
};

// ── DELETE /api/videos/:id ──────────────────────────────────────
const deleteVideo = async (req, res) => {
  try {
    const video = await Video.findOne({
      _id: req.params.id,
      schoolId: req.schoolId,
    });

    if (!video) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'Video not found',
      });
    }

    await video.deleteOne();
    _audit('VIDEO_DELETED', 'VIDEO', req.params.id,
      `Video deleted`, {}, req);
    res.json({ success: true, message: 'Video deleted successfully' });
  } catch (error) {
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error.message,
    });
  }
};

const updateVideo = async (req, res) => {
  try {
    const { id } = req.params;
    const { role, schoolId } = req.user;

    const video = await Video.findOne({ _id: id, schoolId });
    if (!video) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'Video not found',
      });
    }

    // Teachers can only edit their own videos
    if (role === 'TEACHER') {
      const userId = req.user._id || req.user.userId;
      if (video.createdBy.toString() !== userId.toString()) {
        return res.status(HTTP_STATUS.FORBIDDEN).json({
          success: false,
          message: 'You can only edit your own videos',
        });
      }
    }

    const {
      title, description, topic, chapter, classId, subjectId,
      videoUrl, videoType, thumbnailUrl, duration, isFree, visibility
    } = req.body;

    const nextClassId = classId || video.classId;
    const nextSubjectId = subjectId || video.subjectId;
    const pairValidation = await _validateClassSubjectPair({
      classId: nextClassId,
      subjectId: nextSubjectId,
      req,
    });
    if (!pairValidation.ok) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: pairValidation.message,
      });
    }

    if (title !== undefined && !title.trim()) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false, message: 'Title cannot be empty'
      });
    }

    const updates = {};
    if (title !== undefined) updates.title = title.trim();
    if (description !== undefined) updates.description = description;
    if (topic !== undefined) updates.topic = topic;
    if (chapter !== undefined) updates.chapter = chapter || null;
    if (classId !== undefined) updates.classId = classId;
    if (subjectId !== undefined) updates.subjectId = subjectId;
    if (videoUrl !== undefined) updates.videoUrl = videoUrl;
    if (videoType !== undefined) updates.videoType = videoType;
    if (thumbnailUrl !== undefined) updates.thumbnailUrl = thumbnailUrl || null;
    if (duration !== undefined) updates.duration = duration || null;
    if (isFree !== undefined) updates.isFree = isFree;
    if (visibility !== undefined) updates.visibility = visibility;

    const updated = await Video.findByIdAndUpdate(
      id,
      { $set: updates },
      { new: true, runValidators: true }
    )
      .populate('classId', 'name')
      .populate('subjectId', 'name')
      .populate('createdBy', 'name');

    _audit('VIDEO_UPDATED', 'VIDEO', id,
      `Video "${updated.title}" updated`, {}, req);

    res.json({
      success: true,
      data: updated,
      message: 'Video updated successfully',
    });
  } catch (error) {
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error.message,
    });
  }
};

module.exports = { createVideo, getVideos, deleteVideo, updateVideo };
