# 🚀 Quick Start Guide - School ERP Phase 1

## 1️⃣ Prerequisites Check

Before starting, ensure you have:
- [ ] Node.js installed (v18 or higher)
- [ ] MongoDB installed and running
- [ ] Postman or similar API testing tool

---

## 2️⃣ Installation (5 minutes)

```bash
# Navigate to backend folder
cd backend

# Install dependencies
npm install

# Verify .env file exists with correct settings
# Edit if needed: MongoDB URI, JWT secret, etc.
```

---

## 3️⃣ Start MongoDB

### Windows
```bash
# If MongoDB is installed as a service
net start MongoDB

# Or start manually
mongod
```

### Mac/Linux
```bash
mongod
```

---

## 4️⃣ Start Server

```bash
cd backend
npm start
```

**Expected Output:**
```
✅ MongoDB Connected: localhost
✅ Roles seeded successfully
🚀 Server running on port 5000
Environment: development
```

---

## 5️⃣ Test the API (Follow This Order)

### Test 1: Health Check
```http
GET https://schoolero.onrender.com/health
```
✅ Should return: `{ "status": "OK" }`

---

### Test 2: Create a School
```http
POST https://schoolero.onrender.com/api/schools
Content-Type: application/json

{
  "name": "Test School",
  "code": "TEST001",
  "address": "123 Main Street",
  "contact": {
    "phone": "555-1234",
    "email": "info@test.com"
  }
}
```
✅ **Save the `_id` from response** → This is your `school_id`

---

### Test 3: Create Academic Session
```http
POST https://schoolero.onrender.com/api/sessions
Content-Type: application/json

{
  "schoolId": "<paste_school_id_here>",
  "name": "2024-2025",
  "startDate": "2024-04-01",
  "endDate": "2025-03-31",
  "isActive": true
}
```
✅ Session created successfully

---

### Test 4: Register SUPER_ADMIN
```http
POST https://schoolero.onrender.com/api/auth/register
Content-Type: application/json

{
  "name": "Super Admin",
  "email": "admin@system.com",
  "password": "admin123",
  "role": "SUPER_ADMIN"
}
```
✅ First user created

---

### Test 5: Login
```http
POST https://schoolero.onrender.com/api/auth/login
Content-Type: application/json

{
  "email": "admin@system.com",
  "password": "admin123"
}
```
✅ **Save the `token` from response**

---

### Test 6: Get Current User (Protected Endpoint)
```http
GET https://schoolero.onrender.com/api/auth/me
Authorization: Bearer <paste_token_here>
```
✅ Should return your user details

---

### Test 7: Create a Principal User
```http
POST https://schoolero.onrender.com/api/users
Authorization: Bearer <paste_token_here>
Content-Type: application/json

{
  "name": "School Principal",
  "email": "principal@test.com",
  "password": "principal123",
  "role": "PRINCIPAL",
  "schoolId": "<paste_school_id_here>"
}
```
✅ Principal user created

---

### Test 8: List All Users
```http
GET https://schoolero.onrender.com/api/users
Authorization: Bearer <paste_token_here>
```
✅ Should see both users (admin and principal)

---

## 6️⃣ Test School Isolation

### Login as Principal
```http
POST https://schoolero.onrender.com/api/auth/login
Content-Type: application/json

{
  "email": "principal@test.com",
  "password": "principal123"
}
```
✅ Get principal's token

### Try to Create User for DIFFERENT School
```http
POST https://schoolero.onrender.com/api/users
Authorization: Bearer <principal_token>
Content-Type: application/json

{
  "name": "Another Teacher",
  "email": "teacher@other.com",
  "password": "teacher123",
  "role": "TEACHER",
  "schoolId": "000000000000000000000000"  # Different school ID
}
```
❌ **Should be DENIED** - "Cannot access other school's data"

---

## 7️⃣ Using Postman Collection

Instead of manual testing:

1. Import the collection:
   - File: `School_ERP_Phase1.postman_collection.json`
   - Location: `backend/` folder

2. The collection will:
   - Auto-save `school_id` after creating school
   - Auto-save `token` after login
   - Use variables in subsequent requests

3. Run requests in order from top to bottom

---

## 8️⃣ Verify Database

```bash
# Connect to MongoDB
mongosh

# Switch to database
use school_erp

# Check collections
show collections

# View roles (should see 6 roles)
db.roles.find()

# View schools
db.schools.find()

# View users
db.users.find()
```

---

## 9️⃣ Common Issues & Solutions

### Issue: "MongoDB Connection Error"
**Solution:** 
- Ensure MongoDB is running
- Check `MONGODB_URI` in `.env`
- Default: `mongodb://localhost:27017/school_erp`

### Issue: "Invalid token"
**Solution:**
- Token expires after 7 days (configurable)
- Login again to get new token
- Ensure token format: `Bearer <token>`

### Issue: "Access denied"
**Solution:**
- Check user role
- Verify school isolation
- Ensure user is active

### Issue: "Port already in use"
**Solution:**
- Change `PORT` in `.env`
- Or stop other process using port 5000

---

## 🎯 Success Checklist

After completing all tests, verify:

- ✅ Server starts without errors
- ✅ MongoDB connects successfully
- ✅ Can create school
- ✅ Can create academic session
- ✅ Can register user
- ✅ Login returns valid token
- ✅ Protected endpoints require token
- ✅ School isolation works
- ✅ Role hierarchy enforced
- ✅ Audit logs created in database

---

## 📚 Next Steps

Once Phase-1 is tested and working:

1. Review the code structure
2. Understand security middleware flow
3. Check audit logs in database
4. Ready for Phase-2 (Business modules)

---

## 📞 Quick Reference

| Item | Value |
|------|-------|
| Server URL (Production) | https://schoolero.onrender.com |
| API Base (Production) | https://schoolero.onrender.com/api |
| Server URL (Local) | http://localhost:5000 |
| API Base (Local) | http://localhost:5000/api |
| Database | school_erp |
| Default Port | 5000 |
| JWT Expiry | 7 days |

---

## 🔐 Default Test Credentials

After following the guide, you'll have:

**SUPER_ADMIN:**
- Email: admin@system.com
- Password: admin123

**PRINCIPAL:**
- Email: principal@test.com
- Password: principal123

⚠️ **Change these in production!**

---

## 📖 Full Documentation

For complete details, see:
- `README.md` - Full API documentation
- `IMPLEMENTATION_SUMMARY.md` - Technical details
- Postman Collection - Interactive testing

---

**Estimated Time:** 10-15 minutes to complete all tests

**Status:** Ready to use! 🎉
