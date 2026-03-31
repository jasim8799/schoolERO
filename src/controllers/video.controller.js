const Video = require('../models/Video');
const { HTTP_STATUS, USER_ROLES } = require('../config/constants');

// ── POST /api/videos ────────────────────────────────────────────
const createVideo = async (req, res) => {
  try {
    const {
      title,
      description,
      topic,
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
      sessionId: req.activeSession?._id,
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
    const filter = { schoolId: req.schoolId };
    if (classId) filter.classId = classId;
    if (subjectId) filter.subjectId = subjectId;

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
