# 🎯 COMPLETE API ENDPOINT INVENTORY
## School ERP Phase-1 Backend

**Production URL:** `https://schoolero.onrender.com`  
**Date:** January 12, 2026

---

## 📋 ENDPOINT SUMMARY

| # | METHOD | URL | AUTH REQUIRED | ROLE/PERMISSION | STATUS |
|---|--------|-----|---------------|-----------------|--------|
| 1 | GET | `/health` | ❌ NO | PUBLIC | ⏳ To Test |
| 2 | POST | `/api/auth/register` | ❌ NO | PUBLIC (any role) | ⏳ To Test |
| 3 | POST | `/api/auth/login` | ❌ NO | PUBLIC | ⏳ To Test |
| 4 | GET | `/api/auth/me` | ✅ YES | ALL AUTHENTICATED | ⏳ To Test |
| 5 | POST | `/api/schools` | ❌ NO (missing) | SUPER_ADMIN (not enforced) | ⏳ To Test |
| 6 | GET | `/api/schools` | ❌ NO (missing) | SUPER_ADMIN (not enforced) | ⏳ To Test |
| 7 | GET | `/api/schools/:id` | ❌ NO (missing) | SUPER_ADMIN (not enforced) | ⏳ To Test |
| 8 | POST | `/api/sessions` | ❌ NO (missing) | SUPER_ADMIN/PRINCIPAL (not enforced) | ⏳ To Test |
| 9 | GET | `/api/sessions/school/:schoolId` | ❌ NO (missing) | ALL (not enforced) | ⏳ To Test |
| 10 | GET | `/api/sessions/active/:schoolId` | ❌ NO (missing) | ALL (not enforced) | ⏳ To Test |
| 11 | PATCH | `/api/sessions/:id` | ❌ NO (missing) | SUPER_ADMIN/PRINCIPAL (not enforced) | ⏳ To Test |
| 12 | POST | `/api/users` | ✅ YES | OPERATOR+ (school-scoped) | ⏳ To Test |
| 13 | GET | `/api/users` | ✅ YES | ALL (school-filtered) | ⏳ To Test |
| 14 | GET | `/api/users/:id` | ✅ YES | ALL | ⏳ To Test |
| 15 | PATCH | `/api/users/:id` | ✅ YES | PRINCIPAL+ | ⏳ To Test |
| 16 | DELETE | `/api/users/:id` | ✅ YES | PRINCIPAL+ | ⏳ To Test |

**Total Endpoints:** 16  
**Public Endpoints:** 3 (health, register, login)  
**Protected Endpoints:** 4 (auth/me, user routes)  
**Partially Protected:** 9 (school/session routes - auth not enforced in code)

---

## 🔍 DETAILED ENDPOINT SPECIFICATIONS

### 1️⃣ HEALTH CHECK
```
GET /health
```
- **Auth:** None
- **Role:** Public
- **Purpose:** Server health check
- **Expected Response:** `{ status: 'OK', message: 'School ERP Backend is running' }`
- **Status Code:** 200

---

### 2️⃣ AUTHENTICATION ENDPOINTS

#### Register User
```
POST /api/auth/register
```
- **Auth:** None (TODO: Should require SUPER_ADMIN for first user, PRINCIPAL+ for others)
- **Role:** Currently open to all
- **Body:**
  ```json
  {
    "name": "string",
    "email": "string (optional)",
    "mobile": "string (optional)",
    "password": "string",
    "role": "SUPER_ADMIN|PRINCIPAL|OPERATOR|TEACHER|STUDENT|PARENT",
    "schoolId": "ObjectId (optional for SUPER_ADMIN)"
  }
  ```
- **Expected Response:** User object + token
- **Status Code:** 201

#### Login
```
POST /api/auth/login
```
- **Auth:** None
- **Role:** Public
- **Body:**
  ```json
  {
    "email": "string (or mobile)",
    "mobile": "string (or email)",
    "password": "string"
  }
  ```
- **Expected Response:** `{ token, user }`
- **Status Code:** 200
- **Audit:** Creates LOGIN audit log

#### Get Current User
```
GET /api/auth/me
```
- **Auth:** Required (Bearer token)
- **Role:** All authenticated
- **Expected Response:** User object (without password)
- **Status Code:** 200

---

### 3️⃣ SCHOOL ENDPOINTS

#### Create School
```
POST /api/schools
```
- **Auth:** ⚠️ NOT ENFORCED (should be SUPER_ADMIN only)
- **Role:** SUPER_ADMIN (not checked in route)
- **Body:**
  ```json
  {
    "name": "string",
    "code": "string (unique, uppercase)",
    "address": "string",
    "contact": {
      "phone": "string",
      "email": "string"
    }
  }
  ```
- **Expected Response:** School object
- **Status Code:** 201

#### Get All Schools
```
GET /api/schools
```
- **Auth:** ⚠️ NOT ENFORCED (should be SUPER_ADMIN only)
- **Role:** SUPER_ADMIN (not checked in route)
- **Expected Response:** Array of schools
- **Status Code:** 200

#### Get School by ID
```
GET /api/schools/:id
```
- **Auth:** ⚠️ NOT ENFORCED
- **Role:** Any
- **Expected Response:** School object
- **Status Code:** 200

---

### 4️⃣ SESSION ENDPOINTS

#### Create Academic Session
```
POST /api/sessions
```
- **Auth:** ⚠️ NOT ENFORCED (should be SUPER_ADMIN/PRINCIPAL)
- **Role:** SUPER_ADMIN/PRINCIPAL (not checked in route)
- **Body:**
  ```json
  {
    "schoolId": "ObjectId",
    "name": "string (e.g., 2024-2025)",
    "startDate": "ISO Date",
    "endDate": "ISO Date",
    "isActive": "boolean"
  }
  ```
- **Expected Response:** Session object
- **Status Code:** 201
- **Business Logic:** Auto-deactivates other sessions if isActive=true

#### Get Sessions by School
```
GET /api/sessions/school/:schoolId
```
- **Auth:** ⚠️ NOT ENFORCED
- **Role:** Any
- **Expected Response:** Array of sessions
- **Status Code:** 200

#### Get Active Session
```
GET /api/sessions/active/:schoolId
```
- **Auth:** ⚠️ NOT ENFORCED
- **Role:** Any
- **Expected Response:** Active session object or null
- **Status Code:** 200

#### Update Session
```
PATCH /api/sessions/:id
```
- **Auth:** ⚠️ NOT ENFORCED (should be SUPER_ADMIN/PRINCIPAL)
- **Role:** SUPER_ADMIN/PRINCIPAL (not checked in route)
- **Body:**
  ```json
  {
    "name": "string (optional)",
    "startDate": "ISO Date (optional)",
    "endDate": "ISO Date (optional)",
    "isActive": "boolean (optional)"
  }
  ```
- **Expected Response:** Updated session object
- **Status Code:** 200

---

### 5️⃣ USER ENDPOINTS (FULLY PROTECTED)

#### Create User
```
POST /api/users
```
- **Auth:** ✅ REQUIRED
- **Role:** OPERATOR or higher
- **Middlewares:**
  - `authenticate` - Verifies JWT
  - `requireMinRole(OPERATOR)` - Checks role level >= 4
  - `attachSchoolId` - Auto-adds user's schoolId to body
  - `canAssignRole` - Prevents assigning higher role than own
  - `enforceSchoolIsolation` - SUPER_ADMIN can assign any school, others only own school
- **Body:**
  ```json
  {
    "name": "string",
    "email": "string (optional)",
    "mobile": "string (optional)",
    "password": "string",
    "role": "PRINCIPAL|OPERATOR|TEACHER|STUDENT|PARENT",
    "schoolId": "ObjectId (auto-attached if not SUPER_ADMIN)"
  }
  ```
- **Expected Response:** User object
- **Status Code:** 201
- **Audit:** Creates USER_CREATED audit log

#### Get All Users
```
GET /api/users
```
- **Auth:** ✅ REQUIRED
- **Role:** All authenticated
- **Middlewares:**
  - `authenticate` - Verifies JWT
  - `filterBySchool` - SUPER_ADMIN sees all, others see own school only
- **Expected Response:** Array of users (school-filtered)
- **Status Code:** 200

#### Get User by ID
```
GET /api/users/:id
```
- **Auth:** ✅ REQUIRED
- **Role:** All authenticated
- **Middlewares:**
  - `authenticate` - Verifies JWT
- **Expected Response:** User object
- **Status Code:** 200

#### Update User
```
PATCH /api/users/:id
```
- **Auth:** ✅ REQUIRED
- **Role:** PRINCIPAL or higher
- **Middlewares:**
  - `authenticate` - Verifies JWT
  - `requireMinRole(PRINCIPAL)` - Checks role level >= 5
- **Body:**
  ```json
  {
    "name": "string (optional)",
    "email": "string (optional)",
    "mobile": "string (optional)",
    "status": "active|inactive (optional)",
    "role": "string (optional)"
  }
  ```
- **Expected Response:** Updated user object
- **Status Code:** 200
- **Audit:** Creates USER_UPDATED/ROLE_CHANGED audit log

#### Delete User
```
DELETE /api/users/:id
```
- **Auth:** ✅ REQUIRED
- **Role:** PRINCIPAL or higher
- **Middlewares:**
  - `authenticate` - Verifies JWT
  - `requireMinRole(PRINCIPAL)` - Checks role level >= 5
- **Expected Response:** Success message
- **Status Code:** 200

---

## 🔐 SECURITY ANALYSIS

### ✅ PROTECTED PROPERLY
- `/api/auth/me` - JWT required
- `/api/users/*` - JWT + Role + School isolation enforced

### ⚠️ MISSING AUTHENTICATION (Phase-1 Known Gaps)
- `/api/schools/*` - Comments indicate "will add auth later"
- `/api/sessions/*` - Comments indicate "will add auth later"

### 🎯 SCHOOL ISOLATION STATUS
- **Users:** ✅ Enforced via `enforceSchoolIsolation` middleware
- **Schools:** ❌ Not enforced (accessible to all)
- **Sessions:** ❌ Not enforced (accessible to all)

### 🔑 ROLE HIERARCHY
```
6: SUPER_ADMIN (can access all schools)
5: PRINCIPAL (school-scoped)
4: OPERATOR (school-scoped)
3: TEACHER (school-scoped)
2: STUDENT (school-scoped)
1: PARENT (school-scoped)
```

---

## 📝 TESTING PLAN

### Phase 1: Public Endpoints (No Auth)
1. ✅ Health check
2. ✅ Register SUPER_ADMIN
3. ✅ Login SUPER_ADMIN

### Phase 2: School Endpoints (No Auth - Test Gap)
4. ✅ Create School A
5. ✅ Create School B
6. ✅ Get All Schools
7. ✅ Get School by ID

### Phase 3: Session Endpoints (No Auth - Test Gap)
8. ✅ Create Session for School A
9. ✅ Get Sessions by School
10. ✅ Get Active Session
11. ✅ Update Session

### Phase 4: User Endpoints (Fully Protected)
12. ✅ Create Principal for School A (as SUPER_ADMIN)
13. ✅ Login as Principal
14. ✅ Create Operator (as Principal)
15. ✅ Get All Users (verify school filtering)
16. ✅ Update User (as Principal)

### Phase 5: Negative Tests
17. ❌ Access /api/users without token → 401
18. ❌ Create user with OPERATOR trying to assign PRINCIPAL role → 403
19. ❌ Principal from School A accessing School B users → blocked
20. ❌ Invalid JWT token → 401

### Phase 6: Audit Logs
21. ✅ Verify LOGIN actions in MongoDB
22. ✅ Verify USER_CREATED actions in MongoDB

---

## 🎯 EXPECTED TEST RESULTS

| Test Category | Expected Pass | Expected Fail | Notes |
|---------------|---------------|---------------|-------|
| Public Endpoints | 3/3 | 0 | Health, Login, Register |
| School Endpoints | 4/4 | 0 | No auth = anyone can access |
| Session Endpoints | 4/4 | 0 | No auth = anyone can access |
| User Endpoints (Positive) | 5/5 | 0 | With valid tokens |
| Negative Tests | 0 | 4/4 | Should all be blocked |
| School Isolation | 0 | 1/1 | Cross-school access blocked |

**Total:** 16 Pass + 5 Fail (expected) = 21 Tests

---

## ⚠️ KNOWN PHASE-1 LIMITATIONS

1. **School routes have NO authentication** - Commented as "will add auth later"
2. **Session routes have NO authentication** - Commented as "will add auth later"
3. **Register endpoint is open** - Anyone can register with any role
4. **No rate limiting** - Can spam endpoints
5. **No request validation** - Using controller-level validation only

These are DOCUMENTED gaps for Phase-1. Phase-2 will address them.

---

**Status:** Ready for systematic testing ✅
