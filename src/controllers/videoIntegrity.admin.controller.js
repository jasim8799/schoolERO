const { HTTP_STATUS } = require('../config/constants');
const { processVideoIntegrity } = require('../services/videoIntegrity.service');

const checkVideoIntegrity = async (req, res) => {
  try {
    const { schoolId = null, sessionId = null } = req.body || {};

    const result = await processVideoIntegrity({
      schoolId,
      sessionId,
      applyFix: false,
    });

    const report = result.rows.map((r) => ({
      videoTitle: r.videoTitle,
      videoClassId: r.videoClassId,
      subjectClassId: r.subjectClassId,
      status: r.status,
      videoId: r.videoId,
      subjectId: r.subjectId,
    }));

    return res.status(HTTP_STATUS.OK).json({
      success: true,
      message: 'Video integrity scan completed',
      data: {
        videosScanned: result.videosScanned,
        mismatches: report.filter((r) => r.status === 'MISMATCH').length,
        report,
      },
    });
  } catch (error) {
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error.message,
    });
  }
};

const fixVideoIntegrity = async (req, res) => {
  try {
    const { schoolId = null, sessionId = null } = req.body || {};

    const result = await processVideoIntegrity({
      schoolId,
      sessionId,
      applyFix: true,
    });

    return res.status(HTTP_STATUS.OK).json({
      success: true,
      message: 'Video integrity repair completed',
      data: {
        videosScanned: result.videosScanned,
        videosRepaired: result.videosRepaired,
        videosSkipped: result.videosSkipped,
        danglingSubjects: result.danglingSubjects,
        missingClasses: result.missingClasses,
        errors: result.errors,
      },
    });
  } catch (error) {
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error.message,
    });
  }
};

module.exports = {
  checkVideoIntegrity,
  fixVideoIntegrity,
};
