const Video = require('../models/Video');
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

    // DEBUG: Log upload details
    console.log('========== VIDEO UPLOAD DEBUG ==========');
    console.log('Selected Subject Name:', req.body.subjectName);
    console.log('Selected Subject ID (payload):', subjectId);
    console.log('Selected Class ID:', classId);
    console.log('School ID:', req.schoolId);
    console.log('Session ID:', req.activeSession?._id || req.user.sessionId);
    console.log('======================================');

    if (!title || !classId || !subjectId || !videoUrl) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'title, classId, subjectId, and videoUrl are required',
      });
    }

    // DEBUG: Verify Subject exists in DB before saving
    const Subject = require('../models/Subject');
    const subjectDoc = await Subject.findById(subjectId);
    console.log('MongoDB Subject ID:', subjectDoc ? subjectDoc._id.toString() : 'NOT FOUND');
    console.log('MongoDB Subject Name:', subjectDoc ? subjectDoc.name : 'N/A');
    console.log('MongoDB Subject classId:', subjectDoc ? subjectDoc.classId.toString() : 'N/A');
    console.log('MongoDB Subject sessionId:', subjectDoc ? subjectDoc.sessionId.toString() : 'N/A');
    console.log('MongoDB Subject schoolId:', subjectDoc ? subjectDoc.schoolId.toString() : 'N/A');
    console.log('Comparing: payloadSubjectId === mongoSubjectId:', subjectDoc ? (subjectId === subjectDoc._id.toString()) : 'N/A');
    console.log('========================================');

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

const videos = await Video.find(filter)
      .populate('classId', 'name')
      .populate('subjectId', 'name')
      .populate('createdBy', 'name')
      .sort({ createdAt: -1 });

    // DEBUG: Log all videos returned
    console.log('========== GET /api/videos DEBUG ==========');
    console.log('Total videos returned:', videos.length);
    console.log('Filter used:', filter);
    for (var i = 0; i < videos.length; i++) {
      const v = videos[i];
      console.log(`Video[${i}]: _id=${v._id}, title=${v.title}, classId=${v.classId?._id}, className=${v.classId?.name}, subjectId=${v.subjectId?._id}, subjectName=${v.subjectId?.name}, sessionId=${v.sessionId}, schoolId=${v.schoolId}`);
    }
    console.log('==========================================');

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
