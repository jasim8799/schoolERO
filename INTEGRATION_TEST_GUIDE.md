# Session Module Fixes - Integration & Testing Guide

## Quick Start

### 1. Verify Files are in Place
```bash
# Check helper utilities exist
ls -la backend/src/utils/sessionHelpers.js

# Check controller is updated
ls -la backend/src/controllers/session.controller.js

# Check test suite exists
ls -la backend/tests/session.fixes.test.js

# Check documentation
ls -la backend/SESSION_FIXES_SUMMARY.md
ls -la backend/SESSION_FIXES_VERIFICATION.md
```

### 2. Import Verification
Check that session.controller.js has the import:
```bash
grep -n "sessionHelpers" backend/src/controllers/session.controller.js
# Expected output: line ~19 with the import statement
```

### 3. Run Tests (Optional - for validation)
```bash
cd backend
npm test -- tests/session.fixes.test.js
# Expected: All 33 test cases pass
```

---

## Manual Verification Tests

These tests verify each fix actually works in a running environment.

### Setup
```bash
# Terminal 1: Start the server
npm start

# Terminal 2: Run verification tests
npm run verify:session-fixes
# OR manually run curl commands below
```

### FIX 1 Test: Single Activation Path

**Test 1a: Reject isActive in PATCH**
```bash
curl -X PATCH http://localhost:3000/api/sessions/507f1f77bcf86cd799439011 \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"isActive": true, "name": "Session 2024"}'

# Expected Response (HTTP 400):
# {
#   "success": false,
#   "message": "Session activation must use POST /api/sessions/:id/activate endpoint"
# }
```

**Test 1b: Accept other fields in PATCH**
```bash
curl -X PATCH http://localhost:3000/api/sessions/507f1f77bcf86cd799439011 \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Updated Session Name", "description": "New description"}'

# Expected Response (HTTP 200):
# {
#   "success": true,
#   "message": "Session updated successfully",
#   "data": { ... session object ... }
# }
```

**Test 1c: Use POST for activation**
```bash
curl -X POST http://localhost:3000/api/sessions/507f1f77bcf86cd799439011/activate \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json"

# Expected Response (HTTP 200):
# {
#   "success": true,
#   "message": "Session activated successfully",
#   "data": { ... session object with isActive: true ... }
# }
```

---

### FIX 2 Test: Transactional Duplicate Setup

**Test 2a: Successful duplicate setup (all data copied)**
```bash
curl -X POST http://localhost:3000/api/sessions/507f1f77bcf86cd799439012/duplicate-setup \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "fromSessionId": "507f1f77bcf86cd799439011",
    "copyFeeStructures": true,
    "copyExamTemplates": true,
    "copyTimetableTemplates": true
  }'

# Expected Response (HTTP 200):
# {
#   "success": true,
#   "message": "Session setup complete",
#   "data": {
#     "classesCreated": 5,
#     "sectionsCreated": 15,
#     "subjectsCreated": 45,
#     "feeStructuresCreated": 12,
#     "examTemplatesCreated": 8,
#     "timetableTemplatesCreated": 120,
#     ...
#   }
# }
```

**Test 2b: Verify atomicity (via code inspection)**
- Add a throw statement in FeeStructure.insertMany() for testing
- Rerun duplicate-setup
- Verify: Classes/Sections/Subjects are rolled back (not created)
- Verify: Error message includes "No data was modified"

```javascript
// In session.controller.js duplicateSessionSetup, add for testing:
if (copyFeeStructures && feeDocs.length > 0) {
  throw new Error('[TEST] Intentional failure for transaction verification');
}
```

---

### FIX 3 Test: ObjectId Validation

**Test 3a: Invalid ObjectId format in PATCH**
```bash
curl -X PATCH http://localhost:3000/api/sessions/not-an-object-id \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Test"}'

# Expected Response (HTTP 400):
# {
#   "success": false,
#   "message": "Invalid session ID format"
# }
# Note: Should NOT return HTTP 500 with CastError
```

**Test 3b: Invalid ObjectId in duplicate-setup**
```bash
curl -X POST http://localhost:3000/api/sessions/invalid-id/duplicate-setup \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"fromSessionId": "507f1f77bcf86cd799439011"}'

# Expected Response (HTTP 400):
# {
#   "success": false,
#   "message": "Invalid target session ID format"
# }
```

**Test 3c: Invalid fromSessionId in duplicate-setup**
```bash
curl -X POST http://localhost:3000/api/sessions/507f1f77bcf86cd799439012/duplicate-setup \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"fromSessionId": "xyz"}'

# Expected Response (HTTP 400):
# {
#   "success": false,
#   "message": "Invalid source session ID format"
# }
```

**Test 3d: Verify in other endpoints**
```bash
# closeSession
curl -X POST http://localhost:3000/api/sessions/invalid/close \
  -H "Authorization: Bearer YOUR_TOKEN"
# Expected: HTTP 400

# deleteSession
curl -X DELETE http://localhost:3000/api/sessions/invalid \
  -H "Authorization: Bearer YOUR_TOKEN"
# Expected: HTTP 400

# getSessionStats
curl -X GET http://localhost:3000/api/sessions/invalid/stats \
  -H "Authorization: Bearer YOUR_TOKEN"
# Expected: HTTP 400

# getSessionReadiness
curl -X GET http://localhost:3000/api/sessions/invalid/readiness \
  -H "Authorization: Bearer YOUR_TOKEN"
# Expected: HTTP 400
```

---

### FIX 4 Test: Date Validation

**Test 4a: Invalid start date**
```bash
curl -X POST http://localhost:3000/api/sessions \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Session 2024",
    "startDate": "not-a-date",
    "endDate": "2024-12-31"
  }'

# Expected Response (HTTP 400):
# {
#   "success": false,
#   "message": "Start date is invalid"
# }
```

**Test 4b: Invalid end date**
```bash
curl -X POST http://localhost:3000/api/sessions \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Session 2024",
    "startDate": "2024-01-01",
    "endDate": "invalid-date"
  }'

# Expected Response (HTTP 400):
# {
#   "success": false,
#   "message": "End date is invalid"
# }
```

**Test 4c: End date before start date**
```bash
curl -X POST http://localhost:3000/api/sessions \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Session 2024",
    "startDate": "2024-12-31",
    "endDate": "2024-01-01"
  }'

# Expected Response (HTTP 400):
# {
#   "success": false,
#   "message": "End date must be after start date"
# }
```

**Test 4d: Valid dates**
```bash
curl -X POST http://localhost:3000/api/sessions \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Session 2024",
    "startDate": "2024-01-01",
    "endDate": "2024-12-31"
  }'

# Expected Response (HTTP 200):
# {
#   "success": true,
#   "message": "Session created successfully",
#   "data": { ... session object ... }
# }
```

---

### FIX 6 Test: Extended Readiness Checks

**Test 6a: Check includes new fields**
```bash
curl -X GET http://localhost:3000/api/sessions/507f1f77bcf86cd799439011/readiness \
  -H "Authorization: Bearer YOUR_TOKEN"

# Expected Response (HTTP 200):
# {
#   "success": true,
#   "data": {
#     "checks": [
#       { "key": "classes", ... },
#       { "key": "sections", ... },
#       { "key": "subjects", ... },
#       { "key": "students", ... },
#       { "key": "teacherAssignments", "label": "Teacher assignments created", ... },
#       { "key": "exams", ... },
#       { "key": "fees", ... },
#       { "key": "academicHistory", "label": "Academic history migrated", ... }
#     ],
#     "canActivate": true/false,
#     "sessionId": "507f1f77bcf86cd799439011"
#   }
# }

# Verify:
# - "teacherAssignments" key is present
# - "academicHistory" key is present
# - Both have required: false
# - Query completes in < 1 second
```

---

### FIX 8 Test: Redis SCAN Usage

**Test 8a: Monitor Redis commands (via redis-cli)**
```bash
# Terminal 1: Start Redis monitor
redis-cli MONITOR

# Terminal 2: Trigger cache invalidation
curl -X POST http://localhost:3000/api/sessions/507f1f77bcf86cd799439011/activate \
  -H "Authorization: Bearer YOUR_TOKEN"

# Expected in Terminal 1 (Monitor output):
# - Multiple "SCAN" commands (non-blocking batches)
# - "DEL" commands for matched keys
# - NO "KEYS" commands (old blocking operation)

# Look for pattern like:
# "SCAN" "0" "MATCH" "sessions:507f1f77bcf86cd799439011:*" "COUNT" "1000"
# "DEL" "sessions:507f1f77bcf86cd799439011:cache1" "sessions:507f1f77bcf86cd799439011:cache2" ...
```

**Test 8b: Check logs for invalidation**
```bash
# Look for log line like:
# [SESSION_CACHE] Invalidated 42 cache keys for schoolId=507f1f77bcf86cd799439011

grep "SESSION_CACHE" /path/to/app.log
```

---

### Concurrency Test: FIX 1 + FIX 7

**Test: Race condition between PATCH and POST**
```bash
# Use Apache Bench or similar to send concurrent requests
ab -n 10 -c 5 \
  -X PATCH \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -p payload.json \
  http://localhost:3000/api/sessions/507f1f77bcf86cd799439011

# payload.json:
# {
#   "isActive": true
# }

# Expected:
# - All 10 requests return HTTP 400
# - No CastError or other exceptions
# - Database shows only 1 active session

# Then try:
ab -n 10 -c 5 \
  -X POST \
  -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:3000/api/sessions/507f1f77bcf86cd799439011/activate

# Expected:
# - First succeeds (HTTP 200)
# - Others might fail with "already active"
# - Database shows only 1 active session (guaranteed)
```

---

## Performance Validation

### Measure Cache Invalidation Time

**Before Fixes:**
```javascript
// redis.keys() - BLOCKING
console.time('cache-invalidation');
const keys = await redis.keys('sessions:*');
await redis.del(...keys);
console.timeEnd('cache-invalidation');
// Typical: 50-150ms on large datasets
```

**After Fixes:**
```javascript
// redis.scan() - NON-BLOCKING
console.time('cache-invalidation');
await invalidateSessionCachesProduction(schoolId);
console.timeEnd('cache-invalidation');
// Expected: 10-30ms with SCAN batching
```

### Measure Session Activation Time

```bash
curl -w "\nTime: %{time_total}s\n" \
  -X POST http://localhost:3000/api/sessions/507f1f77bcf86cd799439011/activate \
  -H "Authorization: Bearer YOUR_TOKEN"

# Expected: < 1 second (should include transaction overhead)
# Typical: 0.3-0.8 seconds
```

---

## Debugging Tips

### Enable Detailed Logging
```javascript
// In session.controller.js, add before transaction:
const startTime = Date.now();
logger.info(`[DUPLICATE_SETUP] Starting with transaction for targetSessionId=${targetSessionId}`);

// Inside transaction:
logger.info(`[DUPLICATE_SETUP] Inserted ${newClasses.length} classes`);
logger.info(`[DUPLICATE_SETUP] Inserted ${newSections.length} sections`);

// After transaction:
logger.info(`[DUPLICATE_SETUP] Transaction completed in ${Date.now() - startTime}ms`);
```

### Monitor Database Transactions
```bash
# MongoDB connection string must have retryWrites=true
# Check in logs for transaction messages:
grep "transaction" app.log | grep -i duplicate

# Expected output:
# Mongoose transaction started for duplicateSessionSetup
# Mongoose transaction committed: 3 writes
```

### Check Redis Cache Keys
```bash
# List all session cache keys
redis-cli KEYS "sessions:507f1f77bcf86cd799439011:*"

# Should return empty after activation (all invalidated)
# Or show only current session's keys

# Manual invalidation test:
redis-cli SCAN 0 MATCH "sessions:507f1f77bcf86cd799439011:*" COUNT 100
# Should return cursor position and matching keys
```

---

## Troubleshooting

| Problem | Likely Cause | Solution |
|---------|-------------|----------|
| "TypeError: isValidObjectId is not a function" | Missing import in controller | Check import statement in controller line ~19 |
| "Session activation must use POST" when trying POST | Different session ID in URL | Verify session ID format and existence |
| Transaction rollback but no error logged | Error caught silently | Check mongoSession.abortTransaction error handling |
| Cache invalidation slow (> 100ms) | Still using redis.keys somewhere | Search for "redis.keys" in controller, replace with SCAN |
| Partial data in session setup | Transaction not wrapping all operations | Verify all insertMany include {session: mongoSession} |
| CastError still occurring | ObjectId validation skipped | Check all findById calls have validation first |
| Tests fail with auth errors | Authentication token expired | Regenerate valid token in test setup |

---

## Summary of Expected Behavior

### After All Fixes Applied:

1. **Activation Path:** POST /activate only
2. **PATCH/PUT:** Editing only (rejects isActive)
3. **Date Validation:** Immediate 400 errors for invalid dates
4. **ObjectId Validation:** Immediate 400 errors for invalid IDs
5. **Transaction Safety:** All or nothing in duplicate-setup
6. **Cache Performance:** < 30ms invalidation with SCAN
7. **Readiness Checks:** 8 checks including teacher assignments & history
8. **Concurrency:** Race-safe with unique index enforcement

---

## Next Steps

1. ✅ Code changes deployed
2. ✅ Tests created
3. ⏳ Run manual verification tests above
4. ⏳ Monitor logs for 24 hours post-deployment
5. ⏳ Measure performance improvements
6. ⏳ Archive verification results
7. ⏳ Mark issue as RESOLVED in tracking system

---

**For questions or issues, refer to:**
- SESSION_FIXES_SUMMARY.md (detailed explanations)
- SESSION_FIXES_VERIFICATION.md (verification checklist)
- session.fixes.test.js (automated tests)
- sessionHelpers.js (utility function documentation)
