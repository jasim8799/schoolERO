const Video = require('../models/Video');
const { HTTP_STATUS, USER_ROLES } = require('../config/constants');

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
    res.json({ success: true, message: 'Video deleted successfully' });
  } catch (error) {
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error.message,
    });
  }
};

module.exports = { createVideo, getVideos, deleteVideo };
