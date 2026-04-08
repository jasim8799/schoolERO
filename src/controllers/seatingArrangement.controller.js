const SeatingArrangement = require('../models/SeatingArrangement');

const saveArrangement = async (req, res) => {
  try {
    const { examId, classId, halls } = req.body;
    const { schoolId, sessionId, _id: createdBy } = req.user;

    if (!examId || !halls) {
      return res.status(400).json({ success: false, message: 'examId and halls are required' });
    }

    const arrangement = await SeatingArrangement.findOneAndUpdate(
      { examId, schoolId, sessionId },
      { examId, classId, schoolId, sessionId, halls, createdBy },
      { upsert: true, new: true }
    );

    res.status(201).json({ success: true, data: arrangement, message: 'Seating arrangement saved' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getArrangement = async (req, res) => {
  try {
    const { examId } = req.params;
    const { schoolId, sessionId } = req.user;

    const arrangement = await SeatingArrangement.findOne({ examId, schoolId, sessionId })
      .populate('halls.seats.studentId', 'name rollNumber')
      .lean();

    if (!arrangement) {
      return res.status(404).json({ success: false, message: 'No seating arrangement found' });
    }

    res.json({ success: true, data: arrangement });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  saveArrangement,
  getArrangement,
};
