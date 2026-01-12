import Role from '../models/Role.js';
import { USER_ROLES } from '../config/constants.js';
import { logger } from './logger.js';

export const seedRoles = async () => {
  try {
    const roles = [
      { name: USER_ROLES.SUPER_ADMIN, description: 'Super Administrator with full system access' },
      { name: USER_ROLES.PRINCIPAL, description: 'School Principal with administrative access' },
      { name: USER_ROLES.OPERATOR, description: 'School Operator with limited administrative access' },
      { name: USER_ROLES.TEACHER, description: 'Teacher with classroom and student access' },
      { name: USER_ROLES.STUDENT, description: 'Student with limited access' },
      { name: USER_ROLES.PARENT, description: 'Parent with access to their child\'s information' }
    ];

    for (const roleData of roles) {
      const existingRole = await Role.findOne({ name: roleData.name });
      if (!existingRole) {
        await Role.create(roleData);
        logger.success(`Role created: ${roleData.name}`);
      }
    }

    logger.info('✅ Roles seeded successfully');
  } catch (error) {
    logger.error('Error seeding roles:', error.message);
  }
};
