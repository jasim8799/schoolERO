const USER_ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  PRINCIPAL: 'PRINCIPAL',
  OPERATOR: 'OPERATOR',
  TEACHER: 'TEACHER',
  STUDENT: 'STUDENT',
  PARENT: 'PARENT'
};

const USER_STATUS = {
  ACTIVE: 'active',
  INACTIVE: 'inactive'
};

const SCHOOL_STATUS = {
  ACTIVE: 'active',
  INACTIVE: 'inactive'
};

const SCHOOL_MODULES = {
  ATTENDANCE: 'attendance',
  EXAM: 'exam',
  FEES: 'fees',
  TRANSPORT: 'transport',
  HOSTEL: 'hostel',
  ACADEMIC_HISTORY: 'academic_history',
  PROMOTION: 'promotion',
  TC: 'tc',
  HOMEWORK: 'homework',
  NOTICES: 'notices',
  VIDEOS: 'videos',
  REPORTS: 'reports',
  SALARY: 'salary',
  ONLINE_PAYMENTS: 'online_payments'
};

const SAAS_PLANS = {
  BASIC: 'BASIC',
  STANDARD: 'STANDARD',
  PREMIUM: 'PREMIUM'
};

const PLAN_CONFIGS = {
  [SAAS_PLANS.BASIC]: {
    name: 'Basic',
    description: 'Essential features for small schools',
    limits: {
      studentLimit: 500,
      teacherLimit: 50,
      storageLimit: 5368709120 // 5GB
    },
    modules: {
      attendance: true,
      exam: false,
      fees: true,
      transport: false,
      hostel: false,
      academic_history: true,
      promotion: true,
      tc: true,
      homework: true,
      notices: true,
      videos: false,
      reports: true,
      salary: false,
      online_payments: false
    }
  },
  [SAAS_PLANS.STANDARD]: {
    name: 'Standard',
    description: 'Comprehensive features for growing schools',
    limits: {
      studentLimit: 2000,
      teacherLimit: 150,
      storageLimit: 10737418240 // 10GB
    },
    modules: {
      attendance: true,
      exam: true,
      fees: true,
      transport: true,
      hostel: false,
      academic_history: true,
      promotion: true,
      tc: true,
      homework: true,
      notices: true,
      videos: true,
      reports: true,
      salary: true,
      online_payments: true
    }
  },
  [SAAS_PLANS.PREMIUM]: {
    name: 'Premium',
    description: 'All features for large educational institutions',
    limits: {
      studentLimit: 10000,
      teacherLimit: 500,
      storageLimit: 53687091200 // 50GB
    },
    modules: {
      attendance: true,
      exam: true,
      fees: true,
      transport: true,
      hostel: true,
      academic_history: true,
      promotion: true,
      tc: true,
      homework: true,
      notices: true,
      videos: true,
      reports: true,
      salary: true,
      online_payments: true
    }
  }
};

const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INTERNAL_SERVER_ERROR: 500
};

module.exports = {
  USER_ROLES,
  USER_STATUS,
  SCHOOL_STATUS,
  SCHOOL_MODULES,
  SAAS_PLANS,
  PLAN_CONFIGS,
  HTTP_STATUS
};
