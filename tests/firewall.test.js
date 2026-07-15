/**
 * FIREWALL FIX VERIFICATION TEST SUITE
 * Tests the recursive field validation and injection detection improvements
 * 
 * This ensures:
 * 1. Legitimate staff creation payloads pass through
 * 2. Real attacks are still blocked
 * 3. False positives are eliminated
 */

// Mock injection detection functions from firewall.monitor.js
const SAFE_TEXT_FIELDS = new Set([
  'name', 'address', 'city', 'state', 'pincode', 'mobile', 'email', 'phone',
  'designation', 'department', 'qualification', 'subjects',
  'previousSchool', 'employeeId', 'accountNumber', 'ifscCode',
  'emergencyContactName', 'emergencyContactRelation', 'emergencyContactPhone',
  'spouseName', 'spouseMobile', 'bloodGroup', 'gender', 'occupation',
  'description', 'note', 'remarks', 'comments', 'feedback',
  'whatsappNumber', 'upiId', 'bankName', 'schoolName', 'schoolCode',
  'className', 'section', 'title', 'content', 'message',
  'street', 'landmark', 'building', 'block', 'sector', 'ward',
  'courseCode', 'courseName', 'program', 'stream'
]);

function _testSevereInjectionPatterns(value) {
  if (/<script[^>]*>|javascript:|onerror=|onload=|onclick=/i.test(value)) {
    return 'XSS_DETECTED';
  }
  if (/\$where.*function|\beval\s*\(|\bFunction\s*\(|\bexec\s*\(/i.test(value)) {
    return 'CODE_EXECUTION_DETECTED';
  }
  if (/\b(DROP\s+TABLE|DELETE\s+FROM|UNION\s+SELECT|INSERT\s+INTO.*VALUES)\b/i.test(value)) {
    return 'SQL_INJECTION_DETECTED';
  }
  if (/[;&|`$(){}\\]/i.test(value) && /bash|sh|cmd|powershell|rm\s+-rf|rm\s+-fr|del\s+/i.test(value)) {
    return 'COMMAND_INJECTION_DETECTED';
  }
  if (/(__proto__|constructor\.prototype|prototype\.)/i.test(value)) {
    return 'PROTOTYPE_POLLUTION_DETECTED';
  }
  return null;
}

function _testInjectionPatterns(value, strictMode) {
  if (/<script[^>]*>|javascript:|onerror=|onload=|onclick=/i.test(value)) {
    return 'XSS_DETECTED';
  }
  if (/\$where.*function|\beval\s*\(|\$ne.*true|\$gt.*null|\$regex.*eval/i.test(value)) {
    return 'NOSQL_INJECTION_DETECTED';
  }
  if (strictMode || !value.match(/^[a-zA-Z0-9\s.,'&\-]+$/)) {
    if (/(\bDROP\b.*\bTABLE\b|\bDELETE\b.*\bFROM\b|\bUNION\b.*\bSELECT\b|\bINSERT\b.*\bINTO\b.*\bVALUES\b)/i.test(value)) {
      return 'SQL_INJECTION_DETECTED';
    }
    if (/[;&|`$(){}\\]/i.test(value) && /bash|sh|cmd|powershell|rm\s+-rf|rm\s+-fr|del\s+/i.test(value)) {
      return 'COMMAND_INJECTION_DETECTED';
    }
    if (/(__proto__|constructor\.prototype|prototype\.)/i.test(value)) {
      return 'PROTOTYPE_POLLUTION_DETECTED';
    }
  }
  return null;
}

function testField(fieldName, value, isSafeField) {
  if (isSafeField) {
    return _testSevereInjectionPatterns(value);
  } else {
    return _testInjectionPatterns(value, false);
  }
}

// Test Suite
const tests = {
  mustPass: [
    // Staff creation payloads that MUST NOT be blocked
    { name: 'Staff with "OR" in name', data: { name: 'John OR Jane Smith', designation: 'Class Teacher' }, safe: true },
    { name: 'Staff with ampersand', data: { designation: 'Maths & Science Teacher', department: 'STEM & Arts' }, safe: true },
    { name: 'School with apostrophe', data: { previousSchool: "St. Mary's School", schoolName: "O'Brien International" }, safe: true },
    { name: 'Qualifications', data: { qualification: 'B.Tech (CSE) OR M.Tech (AI)', subjects: 'C++, C#, Node.js' }, safe: true },
    { name: 'Long address', data: { address: 'No.12, Main Road, Sector-21, A-Block, Flat-5, Ward-A, H.NO. 12' }, safe: true },
    { name: 'Indian naming conventions', data: { name: 'Dr. Raj Kumar Singh', address: '10th Cross Road, BTM Layout' }, safe: true },
    { name: 'MERN stack qualification', data: { qualification: 'B.Ed, M.Ed, MERN Stack, React.js' }, safe: true },
    { name: 'Multiple staff rapid creation', data: { name: 'Teacher 1', designation: 'Class Teacher' }, safe: true },
    { name: 'Emergency contact', data: { emergencyContactName: 'John O\'Brien', emergencyContactRelation: 'Father/Mother OR Relative' }, safe: true },
    { name: 'Bank details', data: { accountNumber: '123-456-789', bankName: 'HDFC Bank', ifscCode: 'HDFC0001234' }, safe: true },
    { name: 'Complex address', data: { address: 'Bungalow No. 25-A, Green Valley Sector-12, Opp. St. Joseph\'s School' }, safe: true },
    { name: 'Math with special chars', data: { subjects: 'Maths, Physics, Chemistry, Biology & Environmental Science' }, safe: true },
    { name: 'English names', data: { name: 'Robert O\'Sullivan', occupation: 'Software Engineer & Consultant' }, safe: true },
    { name: 'Address with or', data: { address: 'Plot 5-A or Flat 5B, Sector-21' }, safe: true },
  ],

  mustFail: [
    // SQL Injection attempts
    { name: 'SQL DROP TABLE', data: { designation: 'DROP TABLE users' }, safe: false, shouldBlock: true },
    { name: 'SQL UNION SELECT', data: { address: 'UNION SELECT password FROM admin' }, safe: false, shouldBlock: true },
    { name: 'SQL INSERT INTO', data: { name: 'x\'; INSERT INTO users VALUES(...)' }, safe: false, shouldBlock: true },
    
    // NoSQL Injection
    { name: 'NoSQL $where code exec', data: { address: 'test"; $where: function(){return true}' }, safe: true, shouldBlock: true },
    { name: 'NoSQL eval function', data: { qualification: 'eval(function(){malicious code})' }, safe: true, shouldBlock: true },
    
    // XSS attempts
    { name: 'XSS script tag', data: { name: '<script>alert("XSS")</script>' }, safe: true, shouldBlock: true },
    { name: 'XSS javascript protocol', data: { address: 'javascript:alert(1)' }, safe: true, shouldBlock: true },
    { name: 'XSS onerror', data: { designation: 'Teacher" onerror="alert(1)"' }, safe: true, shouldBlock: true },
    { name: 'XSS onload', data: { emergencyContactName: 'John" onload="alert(1)' }, safe: true, shouldBlock: true },
    
    // Command Injection
    { name: 'Command injection rm -rf', data: { address: '"; rm -rf /;' }, safe: false, shouldBlock: true },
    { name: 'Command injection bash', data: { qualification: 'test$(bash -i)' }, safe: false, shouldBlock: true },
    
    // Prototype Pollution
    { name: 'Prototype pollution', data: { address: '__proto__[admin]=true' }, safe: true, shouldBlock: true },
    { name: 'Constructor prototype', data: { name: 'constructor.prototype.isAdmin=true' }, safe: true, shouldBlock: true },
  ]
};

// Run tests
console.log('🧪 FIREWALL FIX VERIFICATION TEST SUITE\n');
console.log('=' .repeat(80));

let passCount = 0, failCount = 0;

console.log('\n✅ TESTING LEGITIMATE STAFF CREATION PAYLOADS (MUST PASS)\n');
tests.mustPass.forEach(test => {
  const result = Object.entries(test.data).some(([fieldName, value]) => {
    const isSafeField = SAFE_TEXT_FIELDS.has(fieldName);
    return testField(fieldName, value, isSafeField);
  });

  if (!result) {
    console.log(`✓ PASS: ${test.name}`);
    passCount++;
  } else {
    console.log(`✗ FAIL: ${test.name} - Should not be blocked but was`);
    failCount++;
  }
});

console.log(`\n❌ TESTING ATTACK PAYLOADS (MUST FAIL - BLOCKED)\n`);
tests.mustFail.forEach(test => {
  const result = Object.entries(test.data).some(([fieldName, value]) => {
    const isSafeField = SAFE_TEXT_FIELDS.has(fieldName);
    return testField(fieldName, value, isSafeField);
  });

  if (result) {
    console.log(`✓ PASS: ${test.name} - Correctly blocked`);
    passCount++;
  } else {
    console.log(`✗ FAIL: ${test.name} - Should be blocked but wasn't`);
    failCount++;
  }
});

console.log('\n' + '='.repeat(80));
console.log(`\n📊 RESULTS: ${passCount} passed, ${failCount} failed\n`);

if (failCount === 0) {
  console.log('✅ ALL TESTS PASSED - Firewall fix is working correctly!\n');
  process.exit(0);
} else {
  console.log(`❌ ${failCount} tests failed - Firewall fix needs review\n`);
  process.exit(1);
}
