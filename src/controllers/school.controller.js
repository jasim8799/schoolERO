import School from '../models/School.js';
import { HTTP_STATUS } from '../config/constants.js';
import { logger } from '../utils/logger.js';

// Create School
export const createSchool = async (req, res) => {
  try {
    const { name, code, address, contact } = req.body;

    // Validate required fields
    if (!name || !code) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'School name and code are required'
      });
    }

    // Check if school code already exists
    const existingSchool = await School.findOne({ code: code.toUpperCase() });
    if (existingSchool) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: 'School code already exists'
      });
    }

    // Create school
    const school = await School.create({
      name,
      code: code.toUpperCase(),
      address,
      contact
    });

    logger.success(`School created: ${school.name} (${school.code})`);

    res.status(HTTP_STATUS.CREATED).json({
      success: true,
      message: 'School created successfully',
      data: school
    });
  } catch (error) {
    logger.error('Create school error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error creating school',
      error: error.message
    });
  }
};

// Get All Schools
export const getAllSchools = async (req, res) => {
  try {
    const schools = await School.find().sort({ createdAt: -1 });

    res.status(HTTP_STATUS.OK).json({
      success: true,
      count: schools.length,
      data: schools
    });
  } catch (error) {
    logger.error('Get schools error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error fetching schools',
      error: error.message
    });
  }
};

// Get School by ID
export const getSchoolById = async (req, res) => {
  try {
    const school = await School.findById(req.params.id);

    if (!school) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        message: 'School not found'
      });
    }

    res.status(HTTP_STATUS.OK).json({
      success: true,
      data: school
    });
  } catch (error) {
    logger.error('Get school error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error fetching school',
      error: error.message
    });
  }
};
