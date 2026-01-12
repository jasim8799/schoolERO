# School ERP - Phase 1: Core System & Security

## Overview
This is Phase 1 of the School ERP system, focusing on building a secure, multi-school backend foundation. This phase includes:
- Database models
- Authentication & Authorization
- Role-based access control
- School data isolation
- Audit logging

**Important:** This phase is BACKEND ONLY - no UI or frontend code.

---

## Folder Structure

```
backend/
├── src/
│   ├── config/           # Configuration files
│   │   ├── db.js        # MongoDB connection
│   │   ├── env.js       # Environment variables
│   │   └── constants.js # Application constants
│   │
│   ├── models/          # Database models
│   │   ├── School.js
│   │   ├── AcademicSession.js
│   │   ├── User.js
│   │   ├── Role.js
│   │   └── AuditLog.js
│   │
│   ├── controllers/     # Business logic
│   │   ├── school.controller.js
│   │   ├── session.controller.js
│   │   ├── auth.controller.js
│   │   └── user.controller.js
│   │
│   ├── routes/          # API routes
│   │   ├── school.routes.js
│   │   ├── session.routes.js
│   │   ├── auth.routes.js
│   │   └── user.routes.js
│   │
│   ├── middlewares/     # Custom middlewares
│   │   ├── auth.middleware.js
│   │   ├── role.middleware.js
│   │   └── school.middleware.js
│   │
│   ├── utils/           # Utility functions
│   │   ├── jwt.js
│   │   ├── password.js
│   │   ├── logger.js
│   │   ├── seedRoles.js
│   │   └── auditLog.js
│   │
│   └── app.js           # Express app setup
│
├── server.js            # Server entry point
├── package.json
└── .env
```

---

## Installation

### 1. Prerequisites
- Node.js (v18 or higher)
- MongoDB (v6 or higher)
- npm or yarn

### 2. Install Dependencies
```bash
cd backend
npm install
```

### 3. Setup Environment Variables
Create a `.env` file in the `backend` folder (already created):
```env
PORT=5000
NODE_ENV=development
MONGODB_URI=mongodb://localhost:27017/school_erp
JWT_SECRET=your_super_secret_jwt_key_change_this_in_production
JWT_EXPIRES_IN=7d
CORS_ORIGIN=*
```

### 4. Start MongoDB
Make sure MongoDB is running on your system:
```bash
# Windows (if MongoDB is installed as a service)
net start MongoDB

# Or start manually
mongod
```

### 5. Start Server
```bash
npm start
# or for development with auto-reload
npm run dev
```

Server will start on `http://localhost:5000`

---

## API Documentation

### Base URL
```
http://localhost:5000/api
```

### Authentication
All protected endpoints require a JWT token in the Authorization header:
```
Authorization: Bearer <your_jwt_token>
```

---

## API Endpoints

### 1. Health Check
```http
GET /health
```
Response:
```json
{
  "status": "OK",
  "message": "School ERP Backend is running"
}
```

---

### 2. Schools

#### Create School
```http
POST /api/schools
```
**Access:** SUPER_ADMIN only (will be enforced after first SUPER_ADMIN is created)

Request Body:
```json
{
  "name": "Springfield High School",
  "code": "SHS001",
  "address": "123 Main St, Springfield",
  "contact": {
    "phone": "555-1234",
    "email": "info@springfield.edu"
  }
}
```

#### Get All Schools
```http
GET /api/schools
```

#### Get School by ID
```http
GET /api/schools/:id
```

---

### 3. Academic Sessions

#### Create Session
```http
POST /api/sessions
```
**Access:** SUPER_ADMIN / PRINCIPAL

Request Body:
```json
{
  "schoolId": "mongodb_object_id",
  "name": "2024-2025",
  "startDate": "2024-04-01",
  "endDate": "2025-03-31",
  "isActive": true
}
```

#### Get Sessions by School
```http
GET /api/sessions/school/:schoolId
```

#### Get Active Session
```http
GET /api/sessions/active/:schoolId
```

#### Update Session (Activate/Deactivate)
```http
PATCH /api/sessions/:id
```
Request Body:
```json
{
  "isActive": true
}
```

---

### 4. Authentication

#### Register User
```http
POST /api/auth/register
```
Request Body:
```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "mobile": "1234567890",
  "password": "password123",
  "role": "PRINCIPAL",
  "schoolId": "mongodb_object_id"
}
```

**Roles:**
- SUPER_ADMIN (no schoolId required)
- PRINCIPAL
- OPERATOR
- TEACHER
- STUDENT
- PARENT

#### Login
```http
POST /api/auth/login
```
Request Body:
```json
{
  "email": "john@example.com",
  "password": "password123"
}
```

Response:
```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "user": { ... },
    "token": "jwt_token_here"
  }
}
```

#### Get Current User
```http
GET /api/auth/me
```
**Requires:** Authentication token

---

### 5. User Management

#### Create User
```http
POST /api/users
```
**Access:** PRINCIPAL / OPERATOR
**Requires:** Authentication token

Request Body:
```json
{
  "name": "Jane Smith",
  "email": "jane@example.com",
  "password": "password123",
  "role": "TEACHER",
  "schoolId": "mongodb_object_id"
}
```

#### Get All Users
```http
GET /api/users
```
**Requires:** Authentication token
**Query Params:**
- `schoolId` (optional)
- `role` (optional)
- `status` (optional)

#### Get User by ID
```http
GET /api/users/:id
```
**Requires:** Authentication token

#### Update User
```http
PATCH /api/users/:id
```
**Access:** PRINCIPAL and above
**Requires:** Authentication token

Request Body:
```json
{
  "name": "Jane Doe",
  "status": "inactive"
}
```

#### Delete User
```http
DELETE /api/users/:id
```
**Access:** PRINCIPAL and above
**Requires:** Authentication token

---

## Security Features

### 1. Authentication
- JWT-based authentication
- Password hashing using bcrypt
- Token expiration

### 2. Authorization
- Role-based access control (RBAC)
- Role hierarchy enforcement
- Cannot assign higher role than own role

### 3. School Isolation
- Users can only access their own school's data
- SUPER_ADMIN can access all schools
- Automatic school filtering for non-SUPER_ADMIN users

### 4. Audit Logging
Actions logged:
- LOGIN
- USER_CREATED
- USER_UPDATED
- USER_DELETED
- ROLE_CHANGED
- PASSWORD_CHANGED

---

## Testing Phase 1

### Test Checklist

Use Postman or any API testing tool to test the following:

#### ✅ Step 1: Create a School
```http
POST /api/schools
{
  "name": "Test School",
  "code": "TEST001"
}
```

#### ✅ Step 2: Create Academic Session
```http
POST /api/sessions
{
  "schoolId": "<school_id_from_step_1>",
  "name": "2024-2025",
  "startDate": "2024-04-01",
  "endDate": "2025-03-31",
  "isActive": true
}
```

#### ✅ Step 3: Register SUPER_ADMIN
```http
POST /api/auth/register
{
  "name": "Super Admin",
  "email": "admin@system.com",
  "password": "admin123",
  "role": "SUPER_ADMIN"
}
```

#### ✅ Step 4: Login
```http
POST /api/auth/login
{
  "email": "admin@system.com",
  "password": "admin123"
}
```
Save the token from the response!

#### ✅ Step 5: Create a PRINCIPAL
```http
POST /api/users
Authorization: Bearer <your_token>
{
  "name": "School Principal",
  "email": "principal@test.com",
  "password": "principal123",
  "role": "PRINCIPAL",
  "schoolId": "<school_id>"
}
```

#### ✅ Step 6: Test School Isolation
1. Login as PRINCIPAL
2. Try to create a user for a DIFFERENT school
3. Should be DENIED

#### ✅ Step 7: Verify Roles Seeded
Check MongoDB:
```bash
mongo
use school_erp
db.roles.find()
```
Should see all 6 roles.

---

## Role Hierarchy

```
SUPER_ADMIN (Level 6)
    ↓
PRINCIPAL (Level 5)
    ↓
OPERATOR (Level 4)
    ↓
TEACHER (Level 3)
    ↓
STUDENT (Level 2)
    ↓
PARENT (Level 1)
```

**Rules:**
- Higher roles can manage lower roles
- Cannot assign role equal to or higher than own role
- SUPER_ADMIN has access to all schools
- Other roles restricted to their school only

---

## Database Models

### School
- name
- code (unique)
- status (active/inactive)
- address
- contact (phone, email)

### AcademicSession
- schoolId
- name
- startDate
- endDate
- isActive (only one active per school)

### User
- name
- email (unique, optional)
- mobile (unique, optional)
- password (hashed)
- role
- schoolId (not required for SUPER_ADMIN)
- status (active/inactive)

### Role
- name (enum: SUPER_ADMIN, PRINCIPAL, etc.)
- description

### AuditLog
- action
- userId
- schoolId
- targetUserId
- details
- ipAddress
- userAgent
- timestamp

---

## Next Steps (Phase 2)

Phase 1 is complete! Next phases will include:
- Student management
- Fee management
- Attendance system
- Communication system
- Reports and analytics

---

## Troubleshooting

### MongoDB Connection Error
- Ensure MongoDB is running
- Check MONGODB_URI in .env
- Verify MongoDB port (default: 27017)

### Token Errors
- Check JWT_SECRET in .env
- Ensure token is sent in Authorization header
- Token format: `Bearer <token>`

### Permission Denied
- Check user role
- Verify school isolation rules
- Ensure user is active

---

## Support

For issues or questions, check:
1. Server logs for detailed error messages
2. MongoDB logs
3. API response error messages

---

**Phase 1 Status:** ✅ COMPLETE

All core security and foundation features implemented and ready for testing!
