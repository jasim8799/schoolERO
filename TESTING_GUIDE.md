# 🧪 Phase-1 API Testing Guide (Postman)

## ⚠️ MANDATORY: Test in EXACT Order

This guide provides step-by-step testing instructions for ALL Phase-1 APIs.
**Follow the exact sequence** to ensure proper testing.

---

## 📋 Pre-Testing Setup

### 1. Server Status
- ✅ MongoDB Atlas connected
- ✅ Server running (local or Render)
- ✅ Roles seeded (6 roles)

### 2. Postman Setup
- Import collection: `School_ERP_Phase1.postman_collection.json`
- Create environment with variables:
  - `base_url`: `https://schoolero.onrender.com/api` (production) or `http://localhost:5000/api` (local)
  - `token`: (will be auto-saved)
  - `school_id`: (will be auto-saved)
  - `principal_token`: (will be saved manually)

---

## 🔴 Test Sequence (DO NOT SKIP)

---

### TEST 1️⃣: Health Check ✅

**Purpose:** Verify server is running

**Request:**
```http
GET https://schoolero.onrender.com/health
```

**Expected Response (200 OK):**
```json
{
  "status": "OK",
  "message": "School ERP Backend is running"
}
```

**Pass Criteria:**
- ✅ Status: 200 OK
- ✅ Server responds without error

---

### TEST 2️⃣: Create School (SUPER_ADMIN) ✅

**Purpose:** Create the first school in the system

**Request:**
```http
POST {{base_url}}/schools
Content-Type: application/json

{
  "name": "Springfield High School",
  "code": "SHS001",
  "address": "123 Main Street, Springfield",
  "contact": {
    "phone": "555-1234",
    "email": "info@springfield.edu"
  }
}
```

**Expected Response (201 Created):**
```json
{
  "success": true,
  "message": "School created successfully",
  "data": {
    "_id": "679e7f8a...",
    "name": "Springfield High School",
    "code": "SHS001",
    "status": "active",
    ...
  }
}
```

**Actions After Success:**
- ✅ **SAVE the `_id`** → This is your `school_id`
- ✅ Copy to Postman environment variable: `school_id`

**Pass Criteria:**
- ✅ Status: 201 Created
- ✅ School code is unique
- ✅ Status is "active"

---

### TEST 3️⃣: Create Academic Session ✅

**Purpose:** Create academic year for the school

**Request:**
```http
POST {{base_url}}/sessions
Content-Type: application/json

{
  "schoolId": "{{school_id}}",
  "name": "2024-2025",
  "startDate": "2024-04-01",
  "endDate": "2025-03-31",
  "isActive": true
}
```

**Expected Response (201 Created):**
```json
{
  "success": true,
  "message": "Academic session created successfully",
  "data": {
    "_id": "679e7f9b...",
    "schoolId": "679e7f8a...",
    "name": "2024-2025",
    "isActive": true,
    ...
  }
}
```

**Pass Criteria:**
- ✅ Status: 201 Created
- ✅ Session linked to correct school
- ✅ Only ONE active session exists

**Additional Test:**
Try creating another active session for the same school:
- ✅ Previous session should be auto-deactivated

---

### TEST 4️⃣: Register SUPER_ADMIN ✅

**Purpose:** Create the first system administrator

**Request:**
```http
POST {{base_url}}/auth/register
Content-Type: application/json

{
  "name": "System Administrator",
  "email": "admin@system.com",
  "password": "Admin@123",
  "role": "SUPER_ADMIN"
}
```

**Expected Response (201 Created):**
```json
{
  "success": true,
  "message": "User registered successfully",
  "data": {
    "_id": "679e7fa5...",
    "name": "System Administrator",
    "email": "admin@system.com",
    "role": "SUPER_ADMIN",
    "status": "active"
    // Note: password is NOT returned
  }
}
```

**Pass Criteria:**
- ✅ Status: 201 Created
- ✅ Password is hashed (not visible)
- ✅ Role is SUPER_ADMIN
- ✅ No schoolId required

**Security Check:**
- ✅ Password is NOT returned in response

---

### TEST 5️⃣: Login SUPER_ADMIN ✅

**Purpose:** Authenticate and get JWT token

**Request:**
```http
POST {{base_url}}/auth/login
Content-Type: application/json

{
  "email": "admin@system.com",
  "password": "Admin@123"
}
```

**Expected Response (200 OK):**
```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "user": {
      "_id": "679e7fa5...",
      "name": "System Administrator",
      "email": "admin@system.com",
      "role": "SUPER_ADMIN",
      "status": "active"
    },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

**Actions After Success:**
- ✅ **SAVE the `token`** from response
- ✅ Copy to Postman environment variable: `token`
- ✅ This token will be used for ALL subsequent requests

**Pass Criteria:**
- ✅ Status: 200 OK
- ✅ JWT token generated
- ✅ User details returned
- ✅ Password NOT in response

**Security Tests:**
- ❌ Wrong password should return 401
- ❌ Non-existent email should return 401
- ❌ Inactive user should be denied

---

### TEST 6️⃣: Get Current User (Protected) ✅

**Purpose:** Verify JWT authentication works

**Request:**
```http
GET {{base_url}}/auth/me
Authorization: Bearer {{token}}
```

**Expected Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "_id": "679e7fa5...",
    "name": "System Administrator",
    "email": "admin@system.com",
    "role": "SUPER_ADMIN",
    "status": "active"
  }
}
```

**Pass Criteria:**
- ✅ Status: 200 OK
- ✅ Correct user data returned
- ✅ Token is valid

**Security Tests:**
- ❌ Request without token should return 401
- ❌ Request with invalid token should return 401
- ❌ Request with expired token should return 401

---

### TEST 7️⃣: Create PRINCIPAL User ✅

**Purpose:** Create school administrator

**Request:**
```http
POST {{base_url}}/users
Authorization: Bearer {{token}}
Content-Type: application/json

{
  "name": "John Principal",
  "email": "principal@springfield.edu",
  "password": "Principal@123",
  "role": "PRINCIPAL",
  "schoolId": "{{school_id}}"
}
```

**Expected Response (201 Created):**
```json
{
  "success": true,
  "message": "User created successfully",
  "data": {
    "_id": "679e7fb2...",
    "name": "John Principal",
    "email": "principal@springfield.edu",
    "role": "PRINCIPAL",
    "schoolId": {
      "_id": "679e7f8a...",
      "name": "Springfield High School",
      "code": "SHS001"
    },
    "status": "active"
  }
}
```

**Pass Criteria:**
- ✅ Status: 201 Created
- ✅ User linked to correct school
- ✅ Role is PRINCIPAL
- ✅ Password is hashed

**Security Check:**
- ✅ SUPER_ADMIN can create users for any school
- ✅ Audit log entry created

---

### TEST 8️⃣: Login PRINCIPAL ✅

**Purpose:** Test school-level authentication

**Request:**
```http
POST {{base_url}}/auth/login
Content-Type: application/json

{
  "email": "principal@springfield.edu",
  "password": "Principal@123"
}
```

**Expected Response (200 OK):**
```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "user": {
      "_id": "679e7fb2...",
      "name": "John Principal",
      "role": "PRINCIPAL",
      "schoolId": {
        "_id": "679e7f8a...",
        "name": "Springfield High School"
      }
    },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

**Actions After Success:**
- ✅ **SAVE this token separately** as `principal_token`
- ✅ This will be used for school isolation tests

**Pass Criteria:**
- ✅ Status: 200 OK
- ✅ Token contains schoolId in payload
- ✅ Login audit log created

---

### TEST 9️⃣: Create OPERATOR (by PRINCIPAL) ✅

**Purpose:** Test role hierarchy and school isolation

**Request:**
```http
POST {{base_url}}/users
Authorization: Bearer {{principal_token}}
Content-Type: application/json

{
  "name": "Jane Operator",
  "email": "operator@springfield.edu",
  "password": "Operator@123",
  "role": "OPERATOR",
  "schoolId": "{{school_id}}"
}
```

**Expected Response (201 Created):**
```json
{
  "success": true,
  "message": "User created successfully",
  "data": {
    "_id": "679e7fc5...",
    "name": "Jane Operator",
    "email": "operator@springfield.edu",
    "role": "OPERATOR",
    "schoolId": "{{school_id}}",
    "status": "active"
  }
}
```

**Pass Criteria:**
- ✅ Status: 201 Created
- ✅ PRINCIPAL can create lower-level users
- ✅ User auto-assigned to principal's school

**Security Tests:**
❌ **Try creating PRINCIPAL role (should FAIL):**
```json
{
  "name": "Another Principal",
  "email": "another@test.com",
  "password": "Test@123",
  "role": "PRINCIPAL",
  "schoolId": "{{school_id}}"
}
```
Expected: 403 Forbidden - "Cannot assign a role equal to or higher than your own"

❌ **Try creating SUPER_ADMIN (should FAIL):**
Expected: 403 Forbidden

---

### TEST 🔟: Create TEACHER ✅

**Purpose:** Continue testing role hierarchy

**Request:**
```http
POST {{base_url}}/users
Authorization: Bearer {{principal_token}}
Content-Type: application/json

{
  "name": "Sarah Teacher",
  "email": "teacher@springfield.edu",
  "password": "Teacher@123",
  "role": "TEACHER",
  "schoolId": "{{school_id}}"
}
```

**Expected Response (201 Created):**
```json
{
  "success": true,
  "message": "User created successfully",
  "data": {
    "_id": "679e7fd1...",
    "name": "Sarah Teacher",
    "role": "TEACHER",
    ...
  }
}
```

**Pass Criteria:**
- ✅ Status: 201 Created
- ✅ Teacher created successfully
- ✅ Linked to correct school

---

### TEST 1️⃣1️⃣: List Users (School-Filtered) ✅

**Purpose:** Test school isolation on GET requests

**Request (as PRINCIPAL):**
```http
GET {{base_url}}/users
Authorization: Bearer {{principal_token}}
```

**Expected Response (200 OK):**
```json
{
  "success": true,
  "count": 3,
  "data": [
    {
      "_id": "679e7fb2...",
      "name": "John Principal",
      "role": "PRINCIPAL",
      "schoolId": "{{school_id}}"
    },
    {
      "_id": "679e7fc5...",
      "name": "Jane Operator",
      "role": "OPERATOR",
      "schoolId": "{{school_id}}"
    },
    {
      "_id": "679e7fd1...",
      "name": "Sarah Teacher",
      "role": "TEACHER",
      "schoolId": "{{school_id}}"
    }
  ]
}
```

**Pass Criteria:**
- ✅ Status: 200 OK
- ✅ Only shows users from PRINCIPAL's school
- ✅ SUPER_ADMIN user is NOT in the list (different school)

**Request (as SUPER_ADMIN):**
```http
GET {{base_url}}/users
Authorization: Bearer {{token}}
```

**Expected:**
- ✅ Should see ALL users (including SUPER_ADMIN)

---

### TEST 1️⃣2️⃣: 🚨 School Isolation Test (CRITICAL) ✅

**Purpose:** Ensure users CANNOT access other schools' data

#### Step 1: Create Second School (as SUPER_ADMIN)
```http
POST {{base_url}}/schools
Authorization: Bearer {{token}}
Content-Type: application/json

{
  "name": "Riverside Academy",
  "code": "RVA001",
  "address": "456 River Road"
}
```
- ✅ Save the new `school_id` as `school_id_2`

#### Step 2: Try Creating User for School 2 (as PRINCIPAL of School 1)
```http
POST {{base_url}}/users
Authorization: Bearer {{principal_token}}
Content-Type: application/json

{
  "name": "Unauthorized User",
  "email": "unauthorized@riverside.edu",
  "password": "Test@123",
  "role": "TEACHER",
  "schoolId": "{{school_id_2}}"
}
```

**Expected Response (403 Forbidden):**
```json
{
  "success": false,
  "message": "Access denied. Cannot access other school's data."
}
```

**Pass Criteria:**
- ❌ Request should be BLOCKED
- ❌ Status: 403 Forbidden
- ❌ User should NOT be created
- ✅ School isolation enforced!

---

### TEST 1️⃣3️⃣: Update User ✅

**Purpose:** Test user modification

**Request:**
```http
PATCH {{base_url}}/users/{{operator_user_id}}
Authorization: Bearer {{principal_token}}
Content-Type: application/json

{
  "name": "Jane Senior Operator",
  "status": "active"
}
```

**Expected Response (200 OK):**
```json
{
  "success": true,
  "message": "User updated successfully",
  "data": {
    "_id": "679e7fc5...",
    "name": "Jane Senior Operator",
    "status": "active",
    ...
  }
}
```

**Pass Criteria:**
- ✅ Status: 200 OK
- ✅ User updated successfully
- ✅ Only allowed fields modified

---

### TEST 1️⃣4️⃣: Get Active Academic Session ✅

**Purpose:** Verify session management

**Request:**
```http
GET {{base_url}}/sessions/active/{{school_id}}
Authorization: Bearer {{principal_token}}
```

**Expected Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "_id": "679e7f9b...",
    "schoolId": {
      "_id": "679e7f8a...",
      "name": "Springfield High School",
      "code": "SHS001"
    },
    "name": "2024-2025",
    "isActive": true,
    "startDate": "2024-04-01T00:00:00.000Z",
    "endDate": "2025-03-31T00:00:00.000Z"
  }
}
```

**Pass Criteria:**
- ✅ Status: 200 OK
- ✅ Only ONE active session returned
- ✅ Correct school association

---

### TEST 1️⃣5️⃣: Verify Audit Logs (Database Check) ✅

**Purpose:** Confirm security logging is working

**Access MongoDB:**
```bash
mongosh
use school_erp
db.auditlogs.find().pretty()
```

**Expected Logs:**
```javascript
{
  "_id": ObjectId("..."),
  "action": "LOGIN",
  "userId": ObjectId("679e7fa5..."),
  "schoolId": null,
  "details": { "email": "admin@system.com" },
  "ipAddress": "::1",
  "createdAt": ISODate("2026-01-12T...")
}

{
  "_id": ObjectId("..."),
  "action": "USER_CREATED",
  "userId": ObjectId("679e7fa5..."),
  "schoolId": ObjectId("679e7f8a..."),
  "targetUserId": ObjectId("679e7fb2..."),
  "details": { "role": "PRINCIPAL", "email": "principal@springfield.edu" },
  "createdAt": ISODate("2026-01-12T...")
}
```

**Pass Criteria:**
- ✅ LOGIN actions logged
- ✅ USER_CREATED actions logged
- ✅ Correct user and school associations
- ✅ IP address captured
- ✅ Timestamps present

---

## 📊 Test Summary Checklist

After completing all tests, verify:

### ✅ Authentication & Authorization
- [ ] Health check works
- [ ] User registration works
- [ ] Login returns JWT token
- [ ] Protected endpoints require token
- [ ] Invalid token rejected
- [ ] Current user endpoint works

### ✅ School Management
- [ ] School creation works
- [ ] School code uniqueness enforced
- [ ] Multiple schools supported

### ✅ Session Management
- [ ] Session creation works
- [ ] Only one active session per school
- [ ] Session linked to correct school

### ✅ User Management
- [ ] User creation works
- [ ] Users linked to schools
- [ ] Password hashing works
- [ ] User listing works
- [ ] User update works

### ✅ Security & Isolation
- [ ] Role hierarchy enforced
- [ ] Cannot assign higher roles
- [ ] School isolation works
- [ ] Cross-school access blocked
- [ ] SUPER_ADMIN has full access

### ✅ Audit Logging
- [ ] Login events logged
- [ ] User creation logged
- [ ] Audit logs queryable

---

## 🎯 Success Criteria

**Phase-1 is COMPLETE when ALL tests pass:**

- ✅ All 15 tests executed successfully
- ✅ No security vulnerabilities found
- ✅ School isolation confirmed
- ✅ Role hierarchy enforced
- ✅ Audit logs present
- ✅ No console errors
- ✅ All validations working

---

## 🚨 Common Test Failures & Solutions

### Failure: 401 Unauthorized
**Cause:** Token missing or invalid
**Solution:** 
- Verify token in Authorization header
- Format: `Bearer <token>`
- Re-login to get fresh token

### Failure: 403 Forbidden
**Cause:** Insufficient permissions
**Solution:**
- Check user role
- Verify required role for endpoint
- Confirm school access rights

### Failure: 400 Bad Request
**Cause:** Invalid input data
**Solution:**
- Check required fields
- Verify data types
- Validate email/mobile format

### Failure: 404 Not Found
**Cause:** Resource doesn't exist
**Solution:**
- Verify correct ID
- Check if resource was created
- Confirm correct endpoint

---

## 📝 Test Report Template

After testing, document results:

```
Phase-1 API Testing Report
Date: _______________
Environment: [ ] Local [ ] Render
Base URL: _______________

Test Results:
✅ Test 1: Health Check - PASS
✅ Test 2: Create School - PASS
✅ Test 3: Create Session - PASS
✅ Test 4: Register SUPER_ADMIN - PASS
✅ Test 5: Login SUPER_ADMIN - PASS
✅ Test 6: Get Current User - PASS
✅ Test 7: Create PRINCIPAL - PASS
✅ Test 8: Login PRINCIPAL - PASS
✅ Test 9: Create OPERATOR - PASS
✅ Test 10: Create TEACHER - PASS
✅ Test 11: List Users (Filtered) - PASS
✅ Test 12: School Isolation - PASS
✅ Test 13: Update User - PASS
✅ Test 14: Get Active Session - PASS
✅ Test 15: Audit Logs - PASS

Overall Status: READY FOR PRODUCTION ✅
```

---

**🎉 Once all tests pass, Phase-1 is LOCKED and COMPLETE!**

**Next Step:** Deploy to Render and retest with production URL.
