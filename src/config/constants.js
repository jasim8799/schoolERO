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
  attendance: 'attendance',
  exams: 'exams',
  fees: 'fees',
  transport: 'transport',
  hostel: 'hostel',
  academic_history: 'academic_history',
  promotion: 'promotion',
  tc: 'tc',
  homework: 'homework',
  notices: 'notices',
  videos: 'videos',
  reports: 'reports',
  salary: 'salary',
  online_payments: 'online_payments',
  classes: 'classes',
  sections: 'sections',
  subjects: 'subjects',
  schools: 'schools',
  users: 'users',
  teachers: 'teachers',
  students: 'students',
  parents: 'parents',
  dashboard: 'dashboard',
  system: 'system',
  expenses: 'expenses'
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
      exams: false,
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
      online_payments: false,
      classes: true,
      sections: true,
      subjects: true,
      schools: false,
      users: false,
      teachers: false,
      students: false,
      parents: false,
      dashboard: true,
      system: false,
      expenses: false
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
      exams: true,
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
      online_payments: true,
      classes: true,
      sections: true,
      subjects: true,
      schools: true,
      users: true,
      teachers: true,
      students: true,
      parents: true,
      dashboard: true,
      system: true,
      expenses: true
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
      exams: true,
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
      online_payments: true,
      classes: true,
      sections: true,
      subjects: true,
      schools: true,
      users: true,
      teachers: true,
      students: true,
      parents: true,
      dashboard: true,
      system: true,
      expenses: true
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
  TOO_MANY_REQUESTS: 429,
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
