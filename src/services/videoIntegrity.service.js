const Video = require('../models/Video');
const Subject = require('../models/Subject');
const ClassModel = require('../models/Class');

const _toStr = (v) => (v == null ? null : String(v));

const processVideoIntegrity = async ({
  schoolId = null,
  sessionId = null,
  applyFix = false,
  onMismatch = null,
} = {}) => {
  const filter = {};
  if (schoolId) filter.schoolId = schoolId;
  if (sessionId) filter.sessionId = sessionId;

  const videos = await Video.find(filter)
    .select('_id title classId subjectId schoolId sessionId')
    .sort({ createdAt: 1 })
    .lean();

  const subjectIds = [...new Set(videos.map((v) => _toStr(v.subjectId)).filter(Boolean))];
  const subjects = await Subject.find({ _id: { $in: subjectIds } })
    .select('_id name classId schoolId sessionId')
    .lean();
  const subjById = new Map(subjects.map((s) => [_toStr(s._id), s]));

  const classIds = new Set();
  for (const v of videos) classIds.add(_toStr(v.classId));
  for (const s of subjects) classIds.add(_toStr(s.classId));

  const classes = await ClassModel.find({ _id: { $in: [...classIds].filter(Boolean) } })
    .select('_id name')
    .lean();
  const classById = new Map(classes.map((c) => [_toStr(c._id), c]));

  const rows = [];
  const errors = [];
  let videosScanned = 0;
  let videosRepaired = 0;
  let videosSkipped = 0;
  let danglingSubjects = 0;
  let missingClasses = 0;

  for (const v of videos) {
    videosScanned += 1;

    try {
      const videoClassId = _toStr(v.classId);
      const videoSubjectId = _toStr(v.subjectId);
      const subject = subjById.get(videoSubjectId);
      const videoClass = classById.get(videoClassId);

      if (!subject) {
        danglingSubjects += 1;
        videosSkipped += 1;

        rows.push({
          videoId: _toStr(v._id),
          videoTitle: v.title,
          schoolId: _toStr(v.schoolId),
          sessionId: _toStr(v.sessionId),
          videoClassId,
          videoSubjectId,
          subjectId: null,
          subjectName: null,
          subjectClassId: null,
          videoClassName: videoClass?.name || null,
          subjectClassName: null,
          status: 'MISMATCH',
          issue: 'DANGLING_SUBJECT',
          repaired: false,
        });
        continue;
      }

      const subjectClassId = _toStr(subject.classId);
      const subjectClass = classById.get(subjectClassId);
      const isMatch = videoClassId === subjectClassId;

      if (!videoClass || !subjectClass) {
        missingClasses += 1;
      }

      const row = {
        videoId: _toStr(v._id),
        videoTitle: v.title,
        schoolId: _toStr(v.schoolId),
        sessionId: _toStr(v.sessionId),
        videoClassId,
        videoSubjectId,
        subjectId: _toStr(subject._id),
        subjectName: subject.name || null,
        subjectClassId,
        videoClassName: videoClass?.name || null,
        subjectClassName: subjectClass?.name || null,
        status: isMatch ? 'OK' : 'MISMATCH',
        issue: isMatch ? null : 'CLASS_SUBJECT_MISMATCH',
        repaired: false,
      };

      if (!isMatch) {
        if (typeof onMismatch === 'function') {
          await onMismatch(row);
        }

        if (applyFix) {
          await Video.updateOne(
            { _id: v._id },
            { $set: { classId: subject.classId } }
          );
          row.repaired = true;
          row.fixedClassId = subjectClassId;
          videosRepaired += 1;
        } else {
          videosSkipped += 1;
        }
      }

      rows.push(row);
    } catch (err) {
      videosSkipped += 1;
      errors.push({
        videoId: _toStr(v._id),
        message: err.message,
      });
    }
  }

  return {
    videosScanned,
    videosRepaired,
    videosSkipped,
    danglingSubjects,
    missingClasses,
    errors,
    rows,
  };
};

module.exports = { processVideoIntegrity };
