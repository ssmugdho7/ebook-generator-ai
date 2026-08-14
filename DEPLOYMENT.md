# CI/CD & Free Deployment Guide

Step-by-step guide to deploy the AI Ebook Generator for free using Vercel (frontend) and Railway (backend).

---

## Architecture

```
┌─────────────────┐         ┌─────────────────┐
│   Vercel        │         │   Railway       │
│   (Frontend)    │────────▶│   (Backend)     │
│                 │  HTTPS  │                 │
│   Next.js       │         │   FastAPI       │
│   React         │         │   Python        │
└─────────────────┘         └─────────────────┘
                                    │
                                    ▼
                            ┌─────────────────┐
                            │   Google        │
                            │   Gemini API    │
                            └─────────────────┘
```

---

## Prerequisites

1. **GitHub Account** — Code must be pushed to GitHub
2. **Vercel Account** — Free tier (https://vercel.com)
3. **Railway Account** — Free $5/month credit (https://railway.app)
4. **Google Gemini API Keys** — Get from https://aistudio.google.com/apikey

---

## Step 1: Push Code to GitHub

```bash
cd /path/to/ebook-writer
git init
git add -A
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/ebook-generator-ai.git
git push -u origin main
```

---

## Step 2: Deploy Backend on Railway

### 2.1 Create Railway Project

1. Go to **https://railway.app**
2. Click **"Login"** → Sign in with GitHub
3. Click **"New Project"**
4. Select **"Deploy from GitHub repo"**
5. Select **ebook-generator-ai** repository
6. Railway will auto-detect Python and create a service

### 2.2 Configure Build Settings

1. Click on the service → Go to **"Settings"** tab
2. Scroll to **"Build"** section
3. Set **Build Command:**
   ```
   cd backend && pip install -r requirements.txt
   ```
4. Set **Start Command:**
   ```
   cd backend && uvicorn main:app --host 0.0.0.0 --port $PORT
   ```

### 2.3 Add Environment Variables

1. Go to **"Variables"** tab
2. Click **"New Variable"**
3. Add:

| Variable | Value |
|----------|-------|
| `GEMINI_API_KEYS` | `key1,key2,key3,key4` (comma-separated) |

> **Note:** Get your Gemini API keys from https://aistudio.google.com/apikey
> You can use a single key, but multiple keys enable rotation when one hits rate limits.

### 2.4 Deploy

1. Click **"Deploy"** (or it auto-deploys on variable changes)
2. Wait for build to complete (~2-3 minutes)
3. Go to **"Settings"** → **"Networking"** → **"Public Networking"**
4. Copy the generated URL (e.g., `https://your-app.up.railway.app`)

### 2.5 Verify Backend

```bash
# Test health endpoint
curl https://your-app.up.railway.app/api/health

# Test key status
curl https://your-app.up.railway.app/api/key-status
```

---

## Step 3: Deploy Frontend on Vercel

### 3.1 Import Repository

1. Go to **https://vercel.com**
2. Click **"Add New..."** → **"Project"**
3. Select **ebook-generator-ai** repository
4. Click **"Import"**

### 3.2 Configure Project

1. **Framework Preset:** Next.js (auto-detected)
2. **Root Directory:** `./` (leave default)
3. **Build Command:** `npm run build` (auto-detected)
4. **Output Directory:** `.next` (auto-detected)

### 3.3 Add Environment Variables

1. Expand **"Environment Variables"** section
2. Add:

| Variable | Value |
|----------|-------|
| `NEXT_PUBLIC_API_URL` | `https://your-app.up.railway.app` |

> **Important:** Use the Railway URL from Step 2.4. No trailing slash.

### 3.4 Deploy

1. Click **"Deploy"**
2. Wait for build to complete (~1-2 minutes)
3. Once deployed, click **"Visit"** to open your app

---

## Step 4: Verify Deployment

1. Open your Vercel URL (e.g., `https://ebook-generator-ai.vercel.app`)
2. Paste some content (or click "Load Sample")
3. Select a template and page count
4. Click **"Generate"**
5. Verify:
   - PDF downloads successfully
   - Preview loads correctly
   - Cover generator opens and renders covers
6. Test with a fitness topic → should show health icons, no code blocks
7. Test with a coding topic → should show tech icons, include code blocks

---

## CI/CD Pipeline

### Automatic Deployments

**Vercel (Frontend):**
- Every push to `main` triggers automatic deployment
- Preview deployments created for pull requests
- Branch deployments available for `feature/*` branches

**Railway (Backend):**
- Every push to `main` triggers automatic deployment
- Environment variable changes trigger re-deployment
- Manual deploys available from dashboard

### Deployment Flow

```
git push origin main
        │
        ├──▶ Vercel: Auto-deploy frontend (~1-2 min)
        │
        └──▶ Railway: Auto-deploy backend (~2-3 min)
                    │
                    └──▶ Health check passes
```

### Rollback

**Vercel:**
1. Go to project → "Deployments" tab
2. Find previous working deployment
3. Click "..." → "Promote to Production"

**Railway:**
1. Go to service → "Deployments" tab
2. Find previous working deployment
3. Click "Redeploy"

---

## Troubleshooting

### Backend won't start

**Check logs:**
1. Railway dashboard → Click service → "Logs" tab
2. Look for import errors or missing dependencies

**Common fixes:**
- Ensure `requirements.txt` exists in `backend/` directory
- Check Python version compatibility (3.9+)
- Verify all environment variables are set

### Frontend can't connect to backend

**Check:**
1. `NEXT_PUBLIC_API_URL` is set correctly in Vercel
2. Backend URL is accessible (open in browser)
3. CORS is configured (already set to allow all origins)

**Test backend directly:**
```bash
curl -X POST https://your-app.up.railway.app/api/health
```

### PDF generation fails

**Common causes:**
- Gemini API key quota exceeded
- Playwright/Chromium not installed (Railway handles this automatically)
- Content too long for target page count

**Fixes:**
- Check API key status: `curl /api/key-status`
- Reduce content length or increase target pages
- Add more API keys for rotation

### Cover generation fails

**Common causes:**
- Missing icons (silently dropped)
- Invalid color palette
- SVG rendering errors

**Fixes:**
- Check browser console for errors
- Try a different cover style
- Verify topic detection is working (health topics → health icons)

---

## Cost Breakdown

| Service | Free Tier | Limits |
|---------|-----------|--------|
| **Vercel** | Hobby plan | 100GB bandwidth/month, 100 hours serverless function execution |
| **Railway** | $5/month credit | ~500 hours/month for small app |
| **Google Gemini** | Free tier | 20 requests/day (with 4 keys = 80 requests/day) |

**Total: $0/month** (within free tier limits)

---

## Scaling Beyond Free Tier

When you outgrow free tiers:

**Vercel ($20/month):**
- 1TB bandwidth
- Unlimited serverless execution
- Custom domains
- Analytics

**Railway ($5-20/month):**
- More compute hours
- Persistent storage
- Custom domains
- Priority support

**Gemini API (Pay-as-you-go):**
- Higher rate limits
- More models available
- Priority support

---

## Security Notes

- API keys are stored as environment variables (never in code)
- CORS is configured to allow all origins (restrict in production if needed)
- No user authentication (add if needed for your use case)
- HTTPS enforced by both Vercel and Railway

---

## Local Development

```bash
# Backend
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
export GEMINI_API_KEYS="your-key-here"
uvicorn main:app --reload --port 8000

# Frontend (separate terminal)
npm install
export NEXT_PUBLIC_API_URL=http://localhost:8000
npm run dev
```

Open http://localhost:3000
