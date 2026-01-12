# 🚀 Render Deployment Instructions

## Quick Deployment Guide for School ERP Backend

**Live URL (after deployment):** `https://your-app-name.onrender.com`

---

## ✅ Prerequisites

- [x] GitHub account
- [x] Render account (free tier)
- [x] MongoDB Atlas connection string
- [x] Code ready in this repository

---

## Step 1: Push to GitHub ✅

```bash
# Navigate to backend folder
cd "E:\SCHOOL PROJECT\schoolerp\backend"

# Initialize git (if not already done)
git init

# Add all files
git add .

# Commit
git commit -m "Phase-1: School ERP Backend - Ready for Render Deployment"

# Add remote
git remote add origin https://github.com/jasim8799/schoolERO.git

# Push to main branch
git branch -M main
git push -u origin main
```

---

## Step 2: Create Render Web Service 🌐

### 2.1 Go to Render Dashboard
1. Visit: https://dashboard.render.com
2. Sign in with GitHub

### 2.2 Create New Web Service
1. Click **"New +"** button (top right)
2. Select **"Web Service"**
3. Click **"Connect a repository"**
4. Select: `jasim8799/schoolERO`
5. Click **"Connect"**

### 2.3 Configure Service

**Name:** `school-erp-backend` (or your choice)

**Region:** Singapore / Frankfurt / Oregon (choose closest)

**Branch:** `main`

**Root Directory:** Leave empty (or `backend` if in subfolder)

**Runtime:** `Node`

**Build Command:**
```bash
npm install
```

**Start Command:**
```bash
node server.js
```

**Instance Type:** `Free` (for testing)

---

## Step 3: Add Environment Variables 🔐

Click **"Advanced"** → **"Add Environment Variable"**

Add these **EXACTLY** as shown:

| Key | Value |
|-----|-------|
| `NODE_ENV` | `production` |
| `PORT` | `5000` |
| `MONGODB_URI` | `mongodb+srv://mdjasimm107_db_user:7DiB1g4tLlJOVK4Z@cluster0.vrpx99r.mongodb.net/school_erp?retryWrites=true&w=majority&appName=Cluster0` |
| `JWT_SECRET` | `school_erp_super_secret_jwt_key_2026_phase1_secure` |
| `JWT_EXPIRES_IN` | `7d` |
| `CORS_ORIGIN` | `*` |

**⚠️ Important:** 
- Do NOT include quotes around values
- Copy-paste to avoid typos
- JWT_SECRET should be strong in production

---

## Step 4: Deploy! 🚀

1. Scroll down and click **"Create Web Service"**
2. Wait for deployment (5-10 minutes first time)
3. Watch the **Logs** tab

### ✅ Expected Logs:
```
Installing dependencies...
Running build command: npm install
Detected Node.js version: 18.x
Starting server...
✅ MongoDB Connected: ac-5luyics-shard-00-02.vrpx99r.mongodb.net
[SUCCESS] Role created: SUPER_ADMIN
[SUCCESS] Role created: PRINCIPAL
... (all 6 roles)
[INFO] ✅ Roles seeded successfully
[SUCCESS] 🚀 Server running on port 5000
```

### ❌ If Build Fails:
- Check Node version compatibility
- Verify `package.json` exists
- Check build logs for specific error
- Ensure all dependencies in `package.json`

---

## Step 5: Get Your Live URL 🌍

After deployment succeeds:

1. Copy your Render URL from top of dashboard
2. Format: `https://school-erp-backend-XXXX.onrender.com`
3. Save this URL for testing

---

## Step 6: Test Health Endpoint ✅

### Browser Test:
```
https://your-app.onrender.com/health
```

**Expected Response:**
```json
{
  "status": "OK",
  "message": "School ERP Backend is running"
}
```

### cURL Test:
```bash
curl https://your-app.onrender.com/health
```

---

## Step 7: Update Postman Collection 📮

### 7.1 Update Base URL
1. Open Postman
2. Go to Environment Variables
3. Update `base_url`:
   ```
   https://your-app.onrender.com/api
   ```

### 7.2 Run Full Test Suite

Execute all 15 tests in order (from TESTING_GUIDE.md):

1. ✅ Health Check
2. ✅ Create School
3. ✅ Create Academic Session
4. ✅ Register SUPER_ADMIN
5. ✅ Login SUPER_ADMIN
6. ✅ Get Current User
7. ✅ Create PRINCIPAL
8. ✅ Login PRINCIPAL
9. ✅ Create OPERATOR
10. ✅ Create TEACHER
11. ✅ List Users (School-Filtered)
12. ✅ School Isolation Test (MUST BLOCK)
13. ✅ Update User
14. ✅ Get Active Session
15. ✅ Verify Audit Logs

**All 15 tests MUST pass on live URL!**

---

## Step 8: Verify Critical Features 🔒

### Test JWT Authentication:
```bash
# 1. Login
curl -X POST https://your-app.onrender.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@test.com","password":"Admin@123"}'

# 2. Use token for protected endpoint
curl -X GET https://your-app.onrender.com/api/auth/me \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

### Test School Isolation:
- Create 2 schools
- Try cross-school access
- Should return 403 Forbidden

### Test Role Hierarchy:
- PRINCIPAL cannot create PRINCIPAL
- Should return 403 Forbidden

---

## Step 9: Monitor Deployment 📊

### View Logs:
1. Go to Render Dashboard
2. Click on your service
3. Click **"Logs"** tab
4. Monitor real-time logs

### Check Health:
Render auto-checks: `/health` endpoint

### Set Custom Health Check (Optional):
- Settings → Health Check Path: `/health`

---

## Common Issues & Solutions 🔧

### Issue 1: "Build Failed"
**Solution:**
- Check Node version in `package.json`
- Verify all dependencies installed
- Review build logs

### Issue 2: "Application Failed to Respond"
**Solution:**
- Ensure server listens on `process.env.PORT`
- Check environment variables
- Verify MongoDB connection string

### Issue 3: "MongoDB Connection Timeout"
**Solution:**
- Go to MongoDB Atlas → Network Access
- Add IP: `0.0.0.0/0` (Allow from anywhere)
- Wait 2-3 minutes for propagation

### Issue 4: "CORS Error"
**Solution:**
- Set `CORS_ORIGIN=*` in environment variables
- Or specific frontend URL

### Issue 5: "Server Keeps Restarting"
**Solution:**
- Check logs for error messages
- Verify all environment variables set
- Ensure no syntax errors in code

---

## Free Tier Limitations ⚠️

**Render Free Tier:**
- ✅ 750 hours/month free
- ✅ Automatic HTTPS
- ⚠️ Spins down after 15 min inactivity
- ⚠️ Cold start delay (30-60 seconds)

**Note:** First request after idle may be slow.

---

## Update Deployment 🔄

### Method 1: Auto-Deploy (Recommended)
- Push changes to GitHub `main` branch
- Render automatically redeploys

### Method 2: Manual Deploy
- Render Dashboard → Manual Deploy → Deploy latest commit

---

## Environment-Specific URLs 🌐

### Local Development:
```
http://localhost:5000/api
```

### Production (Render):
```
https://school-erp-backend-XXXX.onrender.com/api
```

---

## Security Checklist 🔐

Before going public:

- [ ] Change JWT_SECRET to strong random string
- [ ] Set CORS_ORIGIN to your frontend domain
- [ ] Enable MongoDB Atlas IP whitelist
- [ ] Review all environment variables
- [ ] Test all security features
- [ ] Enable HTTPS (automatic on Render)
- [ ] Set up monitoring/alerts

---

## Deployment Checklist ✅

- [ ] Code pushed to GitHub
- [ ] Render service created
- [ ] Environment variables added
- [ ] MongoDB Atlas IP whitelist: 0.0.0.0/0
- [ ] Deployment successful
- [ ] Health endpoint returns 200 OK
- [ ] All 15 Postman tests pass
- [ ] No errors in Render logs
- [ ] JWT authentication works
- [ ] School isolation enforced
- [ ] Role hierarchy working
- [ ] Audit logs created

---

## Production URL Template 📝

After deployment, fill this in:

**Backend URL:** `https://________________________________.onrender.com`

**API Base:** `https://________________________________.onrender.com/api`

**Health Check:** `https://________________________________.onrender.com/health`

**Database:** `school_erp` on MongoDB Atlas ✅

**Status:** 🟢 Live

---

## Next Steps After Deployment 🎯

1. ✅ Verify all APIs working
2. ✅ Document production URL
3. ✅ Update frontend (if exists) with new URL
4. ✅ Set up monitoring
5. ✅ Tag repository: `phase-1-complete`
6. ✅ Lock Phase-1
7. ✅ Begin Phase-2 planning

---

## Support & Resources 📚

**Render Documentation:**
- https://render.com/docs

**MongoDB Atlas:**
- https://www.mongodb.com/docs/atlas/

**Project Documentation:**
- [README.md](README.md)
- [TESTING_GUIDE.md](TESTING_GUIDE.md)
- [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md)

---

## 🎉 Success Criteria

**Deployment is SUCCESSFUL when:**

✅ Build completes without errors  
✅ MongoDB connects successfully  
✅ Server starts on Render  
✅ Health endpoint responds 200 OK  
✅ All 15 Postman tests pass  
✅ JWT authentication works  
✅ School isolation enforced  
✅ No console errors in logs  

---

**Once deployed, your backend is LIVE! 🚀**

**Estimated Total Time:** 15-20 minutes

---

*Deployment Guide Version: 1.0*  
*Last Updated: January 12, 2026*  
*Status: Ready for Production*
