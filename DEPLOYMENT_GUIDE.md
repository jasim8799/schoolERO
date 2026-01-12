# Render Deployment Guide for School ERP Backend

## 🚀 Deploy to Render (Step-by-Step)

### Prerequisites
- ✅ GitHub account
- ✅ Render account (free tier works)
- ✅ MongoDB Atlas connection string

---

## Step 1: Push Code to GitHub

```bash
# Initialize git (if not already done)
cd backend
git init

# Add files
git add .

# Commit
git commit -m "Phase-1: School ERP Backend Complete"

# Create repository on GitHub
# Then push:
git remote add origin https://github.com/YOUR_USERNAME/school-erp-backend.git
git branch -M main
git push -u origin main
```

---

## Step 2: Create Web Service on Render

1. Go to https://render.com
2. Sign in / Sign up
3. Click **"New +"** → **"Web Service"**
4. Connect your GitHub repository
5. Select the repository: `school-erp-backend`

---

## Step 3: Configure Build Settings

### Basic Settings:
- **Name:** `school-erp-backend` (or your choice)
- **Region:** Choose closest to you
- **Branch:** `main`
- **Root Directory:** `backend` (if backend is in subfolder) or leave empty
- **Runtime:** `Node`

### Build Settings:
- **Build Command:** `npm install`
- **Start Command:** `node server.js`

---

## Step 4: Add Environment Variables

Click **"Advanced"** → **"Add Environment Variable"**

Add these variables:

| Key | Value |
|-----|-------|
| `NODE_ENV` | `production` |
| `PORT` | `5000` |
| `MONGODB_URI` | `mongodb+srv://mdjasimm107_db_user:7DiB1g4tLlJOVK4Z@cluster0.vrpx99r.mongodb.net/school_erp?retryWrites=true&w=majority&appName=Cluster0` |
| `JWT_SECRET` | `school_erp_super_secret_jwt_key_2026_phase1_secure` |
| `JWT_EXPIRES_IN` | `7d` |
| `CORS_ORIGIN` | `*` |

---

## Step 5: Deploy

1. Click **"Create Web Service"**
2. Wait for deployment (5-10 minutes first time)
3. Watch the logs for:
   - ✅ MongoDB Connected
   - ✅ Server running on port 5000

---

## Step 6: Get Your Live URL

After deployment completes:
- Your backend will be live at: `https://school-erp-backend-XXXX.onrender.com`
- Copy this URL for testing

---

## Step 7: Test Deployment

### Test Health Endpoint:
```
GET https://your-app.onrender.com/health
```

Expected Response:
```json
{
  "status": "OK",
  "message": "School ERP Backend is running"
}
```

---

## Common Issues & Solutions

### Issue 1: Build Failed
**Solution:** 
- Check `package.json` exists
- Verify `node_modules` is in `.gitignore`
- Check Node version compatibility

### Issue 2: MongoDB Connection Error
**Solution:**
- Verify MongoDB Atlas is accepting connections from all IPs (0.0.0.0/0)
- Check username/password in connection string
- Ensure database user has read/write permissions

### Issue 3: Server Won't Start
**Solution:**
- Check environment variables are set correctly
- Review Render logs for specific error
- Verify `server.js` path is correct

### Issue 4: CORS Errors
**Solution:**
- Update `CORS_ORIGIN` environment variable
- Or set to `*` for development

---

## MongoDB Atlas IP Whitelist

Important: MongoDB Atlas must allow Render's IP addresses

### Option 1: Allow All IPs (Development)
1. Go to MongoDB Atlas → Network Access
2. Click "Add IP Address"
3. Select "Allow Access from Anywhere" (0.0.0.0/0)
4. Confirm

### Option 2: Specific Render IPs (Production)
Render uses dynamic IPs, so "Allow from Anywhere" is recommended for Render deployments.

---

## Monitoring & Logs

### View Logs:
- Go to your Render dashboard
- Click on your service
- Click "Logs" tab
- Monitor real-time logs

### Check Health:
- Render provides automatic health checks
- Configure at: Settings → Health Check Path: `/health`

---

## Updating the Deployment

### Method 1: Auto-Deploy (Recommended)
- Push changes to GitHub main branch
- Render automatically detects and redeploys

### Method 2: Manual Deploy
- Go to Render dashboard
- Click "Manual Deploy" → "Deploy latest commit"

---

## Environment-Specific Settings

### Development (.env):
```
NODE_ENV=development
MONGODB_URI=mongodb://localhost:27017/school_erp
```

### Production (Render):
```
NODE_ENV=production
MONGODB_URI=mongodb+srv://... (Atlas URL)
```

---

## Free Tier Limitations

Render Free Tier:
- ✅ 750 hours/month
- ✅ Automatic HTTPS
- ⚠️ Spins down after 15 min inactivity
- ⚠️ Cold start (30-60 seconds)

**Note:** First request after inactivity may be slow.

---

## Custom Domain (Optional)

1. Go to Settings → Custom Domain
2. Add your domain
3. Update DNS records as shown
4. SSL certificate auto-generated

---

## Security Checklist

Before going live:
- ✅ Change JWT_SECRET to strong random string
- ✅ Set CORS_ORIGIN to your frontend domain
- ✅ Enable MongoDB Atlas Network Access whitelist
- ✅ Use environment variables (never hardcode secrets)
- ✅ Enable HTTPS (automatic on Render)
- ✅ Review and test all endpoints

---

## Deployment Checklist

- [ ] Code pushed to GitHub
- [ ] Render service created
- [ ] Environment variables added
- [ ] MongoDB Atlas IP whitelist configured
- [ ] Deployment successful
- [ ] Health check endpoint working
- [ ] Logs show no errors
- [ ] All APIs tested with Postman

---

## Your Deployment URLs

After deployment, update these:

**Backend URL:** `https://_____________________.onrender.com`

**API Base:** `https://_____________________.onrender.com/api`

**Health Check:** `https://_____________________.onrender.com/health`

---

## Support

If deployment fails:
1. Check Render logs
2. Verify environment variables
3. Test MongoDB connection string locally first
4. Review build command output

---

**Status:** Ready to deploy! 🚀

Follow steps above to get your backend live in ~10 minutes.
