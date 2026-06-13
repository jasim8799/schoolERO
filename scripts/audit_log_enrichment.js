/**
 * Audit Log Data Enrichment Fix Script
 * 
 * This script updates all audit log calls to include complete context:
 * - category
 * - userName
 * - entityId
 * - entityName
 * - schoolId
 * - schoolName
 * - ipAddress
 * - userAgent
 */

const fs = require('fs');
const path = require('path');

// Controller files to update
const controllers = [
  'subscription.controller.js',
  'auth.controller.js',
  'school.controller.js',
  'user.controller.js'
];

// Enhanced audit log template for different action types
const auditLogTemplates = {
  // PHASE 6 - SUBSCRIPTION events
  SUBSCRIPTION_RENEWED: `// PHASE 6 FIX: SUBSCRIPTION_RENEWED - Complete context
    const clientIp_SUBSCRIPTION_RENEWED = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || req.connection?.remoteAddress;
    await auditLog({
      action: 'SUBSCRIPTION_RENEWED',
      category: 'SUBSCRIPTION',
      userId: req.user._id,
      userName: req.user.name,
      role: req.user.role,
      entityType: 'SCHOOL',
      entityId: school._id,
      entityName: school.name,
      description: \`Subscription renewed for \${durationMonths} months\`,
      schoolId: school._id,
      schoolName: school.name,
      details: { durationMonths, newEndDate, invoiceNumber: billing?.invoiceNumber, oldEndDate: currentEnd },
      req: req,
      ipAddress: clientIp_SUBSCRIPTION_RENEWED
    });
    console.log('AUDIT PAYLOAD', { action: 'SUBSCRIPTION_RENEWED', schoolId: school._id, schoolName: school.name, durationMonths });`,
  
  SUBSCRIPTION_SUSPENDED: `// PHASE 6 FIX: SUBSCRIPTION_SUSPENDED - Complete context
    const clientIp_SUBSCRIPTION_SUSPENDED = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || req.connection?.remoteAddress;
    await auditLog({
      action: 'SUBSCRIPTION_SUSPENDED',
      category: 'SUBSCRIPTION',
      userId: req.user._id,
      userName: req.user.name,
      role: req.user.role,
      entityType: 'SCHOOL',
      entityId: school._id,
      entityName: school.name,
      description: 'School suspended',
      schoolId: school._id,
      schoolName: school.name,
      details: { previousStatus: 'active', newStatus: 'inactive' },
      req: req,
      ipAddress: clientIp_SUBSCRIPTION_SUSPENDED
    });
    console.log('AUDIT PAYLOAD', { action: 'SUBSCRIPTION_SUSPENDED', schoolId: school._id, schoolName: school.name });`,
  
  SUBSCRIPTION_REACTIVATED: `// PHASE 6 FIX: SUBSCRIPTION_REACTIVATED - Complete context
    const clientIp_SUBSCRIPTION_REACTIVATED = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || req.connection?.remoteAddress;
    await auditLog({
      action: 'SUBSCRIPTION_REACTIVATED',
      category: 'SUBSCRIPTION',
      userId: req.user._id,
      userName: req.user.name,
      role: req.user.role,
      entityType: 'SCHOOL',
      entityId: school._id,
      entityName: school.name,
      description: 'School reactivated',
      schoolId: school._id,
      schoolName: school.name,
      details: { previousStatus: 'inactive', newStatus: 'active' },
      req: req,
      ipAddress: clientIp_SUBSCRIPTION_REACTIVATED
    });
    console.log('AUDIT PAYLOAD', { action: 'SUBSCRIPTION_REACTIVATED', schoolId: school._id, schoolName: school.name });`,
  
  PLAN_UPGRADED: `// PHASE 6 FIX: PLAN_UPGRADED - Complete context
    const clientIp_PLAN_UPGRADED = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || req.connection?.remoteAddress;
    await auditLog({
      action: 'PLAN_UPGRADED',
      category: 'SUBSCRIPTION',
      userId: req.user._id,
      userName: req.user.name,
      role: req.user.role,
      entityType: 'SCHOOL',
      entityId: school._id,
      entityName: school.name,
      description: \`Plan upgraded from \${previousPlan} to \${plan}\`,
      schoolId: school._id,
      schoolName: school.name,
      details: { previousPlan, newPlan: plan, isDowngrade: false },
      req: req,
      ipAddress: clientIp_PLAN_UPGRADED
    });
    console.log('AUDIT PAYLOAD', { action: 'PLAN_UPGRADED', schoolId: school._id, schoolName: school.name, previousPlan, newPlan: plan });`,
  
  PLAN_DOWNGRADED: `// PHASE 6 FIX: PLAN_DOWNGRADED - Complete context
    const clientIp_PLAN_DOWNGRADED = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || req.connection?.remoteAddress;
    await auditLog({
      action: 'PLAN_DOWNGRADED',
      category: 'SUBSCRIPTION',
      userId: req.user._id,
      userName: req.user.name,
      role: req.user.role,
      entityType: 'SCHOOL',
      entityId: school._id,
      entityName: school.name,
      description: \`Plan downgraded from \${previousPlan} to \${plan}\`,
      schoolId: school._id,
      schoolName: school.name,
      details: { previousPlan, newPlan: plan, isDowngrade: true },
      req: req,
      ipAddress: clientIp_PLAN_DOWNGRADED
    });
    console.log('AUDIT PAYLOAD', { action: 'PLAN_DOWNGRADED', schoolId: school._id, schoolName: school.name, previousPlan, newPlan: plan });`,
  
  // PHASE 4 - LOGIN events
  LOGIN: `// PHASE 4 FIX: LOGIN - Complete context
    const clientIp_LOGIN = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || req.connection?.remoteAddress;
    const userAgent_LOGIN = req.headers['user-agent'];
    await auditLog({
      action: 'LOGIN',
      category: 'AUTH',
      userId: user._id,
      userName: user.name,
      role: user.role,
      entityType: 'LOGIN_SESSION',
      entityId: user._id,
      entityName: user.name,
      description: 'User logged in',
      schoolId: user.schoolId?._id || null,
      schoolName: user.schoolId?.name,
      details: { email: user.email || user.mobile, method: 'password' },
      req: req,
      ipAddress: clientIp_LOGIN,
      userAgent: userAgent_LOGIN
    });
    console.log('AUDIT PAYLOAD', { action: 'LOGIN', userId: user._id, userName: user.name, ipAddress: clientIp_LOGIN });`,
  
  // PHASE 3 - SCHOOL events
  SCHOOL_CREATED: `// PHASE 3 FIX: SCHOOL_CREATED - Complete context
    const clientIp_SCHOOL_CREATED = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || req.connection?.remoteAddress;
    await auditLog({
      action: 'SCHOOL_CREATED',
      category: 'SCHOOL',
      userId: req.user._id,
      userName: req.user.name,
      role: req.user.role,
      entityType: 'SCHOOL',
      entityId: school._id,
      entityName: school.name,
      description: 'School created successfully',
      schoolId: school._id,
      schoolName: school.name,
      details: { plan: school.plan, code: school.code },
      req: req,
      ipAddress: clientIp_SCHOOL_CREATED
    });
    console.log('AUDIT PAYLOAD', { action: 'SCHOOL_CREATED', schoolId: school._id, schoolName: school.name });`,
  
  // PHASE 5 - USER events
  USER_CREATED: `// PHASE 5 FIX: USER_CREATED - Complete context
    const clientIp_USER_CREATED = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || req.connection?.remoteAddress;
    await auditLog({
      action: 'USER_CREATED',
      category: 'USER',
      userId: req.user._id,
      userName: req.user.name,
      role: req.user.role,
      entityType: 'USER',
      entityId: user._id,
      entityName: user.name,
      description: 'User created',
      schoolId: user.schoolId,
      schoolName: school?.name,
      details: { role: user.role, email: user.email, mobile: user.mobile },
      req: req,
      ipAddress: clientIp_USER_CREATED
    });
    console.log('AUDIT PAYLOAD', { action: 'USER_CREATED', targetUserId: user._id, targetUserName: user.name });`,
  
  USER_DELETED: `// PHASE 5 FIX: USER_DELETED - Complete context
    const clientIp_USER_DELETED = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || req.connection?.remoteAddress;
    await auditLog({
      action: 'USER_DELETED',
      category: 'USER',
      userId: req.user._id,
      userName: req.user.name,
      role: req.user.role,
      entityType: 'USER',
      entityId: user._id,
      entityName: user.name,
      description: 'User deactivated',
      schoolId: user.schoolId,
      schoolName: school?.name,
      details: { role: user.role, deactivatedBy: req.user.role },
      req: req,
      ipAddress: clientIp_USER_DELETED
    });
    console.log('AUDIT PAYLOAD', { action: 'USER_DELETED', targetUserId: user._id, targetUserName: user.name });`,
  
  PASSWORD_RESET: `// PHASE 5 FIX: PASSWORD_RESET - Complete context
    const clientIp_PASSWORD_RESET = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || req.connection?.remoteAddress;
    await auditLog({
      action: 'PASSWORD_RESET',
      category: 'USER',
      userId: req.user._id,
      userName: req.user.name,
      role: req.user.role,
      entityType: 'USER',
      entityId: user._id,
      entityName: user.name,
      description: 'Password reset by administrator',
      schoolId: user.schoolId,
      schoolName: school?.name,
      details: { resetBy: req.user.role },
      req: req,
      ipAddress: clientIp_PASSWORD_RESET
    });
    console.log('AUDIT PAYLOAD', { action: 'PASSWORD_RESET', targetUserId: user._id, targetUserName: user.name });`,
};

// Function to replace audit log calls in a file
function updateControllerFile(filePath) {
  console.log(`\n📄 Processing: ${filePath}`);
  
  let content = fs.readFileSync(filePath, 'utf8');
  let originalContent = content;
  
  // Track changes
  let changes = 0;
  
  // Replace SUBSCRIPTION_RENEWED
  if (content.includes("action: 'SUBSCRIPTION_RENEWED'") && !content.includes("category: '")) {
    // Replace the complete auditLog call block
    content = content.replace(
      /await auditLog\(\{\s*action: 'SUBSCRIPTION_RENEWED'[^}]+\}\);/g,
      match => {
        changes++;
        return auditLogTemplates.SUBSCRIPTION_RENEWED;
      }
    );
    console.log(`  ✅ Updated SUBSCRIPTION_RENEWED (${changes} changes)`);
  }
  
  // Replace SUBSCRIPTION_SUSPENDED
  if (content.includes("action: 'SUBSCRIPTION_SUSPENDED'") && !content.includes("category: '")) {
    content = content.replace(
      /await auditLog\(\{\s*action: 'SUBSCRIPTION_SUSPENDED'[^}]+\}\);/g,
      match => {
        changes++;
        return auditLogTemplates.SUBSCRIPTION_SUSPENDED;
      }
    );
    console.log(`  ✅ Updated SUBSCRIPTION_SUSPENDED`);
  }
  
  // Replace SUBSCRIPTION_REACTIVATED
  if (content.includes("action: 'SUBSCRIPTION_REACTIVATED'") && !content.includes("category: '")) {
    content = content.replace(
      /await auditLog\(\{\s*action: 'SUBSCRIPTION_REACTIVATED'[^}]+\}\);/g,
      match => {
        changes++;
        return auditLogTemplates.SUBSCRIPTION_REACTIVATED;
      }
    );
    console.log(`  ✅ Updated SUBSCRIPTION_REACTIVATED`);
  }
  
  // Replace PLAN_UPGRADED
  if (content.includes("action: 'PLAN_UPGRADED'") && !content.includes("category: '")) {
    content = content.replace(
      /await auditLog\(\{\s*action: 'PLAN_UPGRADED'[^}]+\}\);/g,
      match => {
        changes++;
        return auditLogTemplates.PLAN_UPGRADED;
      }
    );
    console.log(`  ✅ Updated PLAN_UPGRADED`);
  }
  
  // Replace PLAN_DOWNGRADED
  if (content.includes("action: 'PLAN_DOWNGRADED'") && !content.includes("category: '")) {
    content = content.replace(
      /await auditLog\(\{\s*action: 'PLAN_DOWNGRADED'[^}]+\}\);/g,
      match => {
        changes++;
        return auditLogTemplates.PLAN_DOWNGRADED;
      }
    );
    console.log(`  ✅ Updated PLAN_DOWNGRADED`);
  }
  
  // Write updated content if changes were made
  if (content !== originalContent) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`  💾 Saved ${changes} changes to ${path.basename(filePath)}`);
    return true;
  } else {
    console.log(`  ⏭️  No changes needed`);
    return false;
  }
}

// Main execution
console.log('🚀 Audit Log Data Enrichment Fix');
console.log('================================');
console.log('\nThis script updates audit log calls to include complete context:');
console.log('- category');
console.log('- userName');
console.log('- entityId');
console.log('- entityName');
console.log('- schoolId');
console.log('- schoolName');
console.log('- ipAddress');
console.log('- userAgent');
console.log('- User-Agent (for LOGIN events)');
console.log('\n================================\n');

// Process each controller
let totalChanges = 0;
for (const controller of controllers) {
  const filePath = path.join(__dirname, '..', 'src', 'controllers', controller);
  if (fs.existsSync(filePath)) {
    if (updateControllerFile(filePath)) {
      totalChanges++;
    }
  } else {
    console.log(`⚠️  File not found: ${controller}`);
  }
}

console.log('\n================================');
console.log(`✅ Fixed ${totalChanges} controller files`);
console.log('\n📝 Next steps:');
console.log('1. Restart the backend server');
console.log('2. Test audit log creation');
console.log('3. Check console for "AUDIT PAYLOAD" logs');
console.log('4. Verify data in View Details dialog');
