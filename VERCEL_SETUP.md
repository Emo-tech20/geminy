# Vercel Deployment Setup Guide

## Environment Variables Required

Add these environment variables to your Vercel project settings. **Never commit `.env` to GitHub.**

### Server Configuration

| Variable | Local Value | Production Value | Required | Description |
|----------|-------------|------------------|----------|-------------|
| `CLIENT_URL` | `http://localhost:3000` | `https://your-app.vercel.app` | ✅ Yes | Frontend URL for CORS. Update with your actual Vercel URL after first deployment. |
| `NODE_ENV` | `development` | `production` | ✅ Yes | Runtime environment (Vercel sets to production automatically) |

### Supabase Configuration

Get these from your Supabase project dashboard:

| Variable | Location | Required | Example |
|----------|----------|----------|---------|
| `SUPABASE_URL` | Settings → API → Project URL | ✅ Yes | `https://abcdefgh.supabase.co` |
| `SUPABASE_ANON_KEY` | Settings → API → Project API keys (anon/public) | ✅ Yes | `eyJhbGc...` (long string) |
| `SUPABASE_SERVICE_ROLE_KEY` | Settings → API → Project API keys (service_role) | ✅ Yes | `eyJhbGc...` (long string, SECRET) |
| `SUPABASE_JWKS_URL` | Settings → API → Project URL/.well-known/jwks.json | ✅ Yes | `https://abcdefgh.supabase.co/auth/v1/.well-known/jwks.json` |

### Google Gemini AI Configuration

Get from [Google AI Studio](https://ai.google.dev/):

| Variable | Location | Required | Notes |
|----------|----------|----------|-------|
| `GEMINI_API_KEY` | Google Cloud Console → API keys | ✅ Yes | Never expose in frontend code. Keep SECRET. |

---

## Step-by-Step Setup

### 1. Get Supabase Credentials

1. Go to [Supabase Dashboard](https://supabase.com/dashboard)
2. Select your project
3. Click **Settings** (bottom left)
4. Go to **API**
5. Copy:
   - **Project URL** → `SUPABASE_URL`
   - **Project API keys → anon/public** → `SUPABASE_ANON_KEY`
   - **Project API keys → service_role** → `SUPABASE_SERVICE_ROLE_KEY`
   - Build JWKS URL: `{PROJECT_URL}/auth/v1/.well-known/jwks.json` → `SUPABASE_JWKS_URL`

### 2. Get Gemini API Key

1. Go to [Google AI Studio](https://ai.google.dev/)
2. Click **Get API Key**
3. Create new API key or use existing
4. Copy the key → `GEMINI_API_KEY`

### 3. Add to Vercel

1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Select your project (geminy)
3. Go to **Settings**
4. Click **Environment Variables**
5. Add each variable:
   - Name: (e.g., `SUPABASE_URL`)
   - Value: (paste the credential)
   - Environments: Select `Production`, `Preview`, and `Development`
6. Click **Save**

⚠️ **Important**: Add variables to ALL environments (Production, Preview, Development)

### 4. Update CLIENT_URL After First Deployment

After deploying to Vercel:
1. Your app URL will be like `https://geminy-abc123.vercel.app`
2. Go back to Vercel Settings → Environment Variables
3. Update `CLIENT_URL` to your actual Vercel URL
4. Redeploy

---

## Local Development

### Setup

```bash
# Clone repository
git clone https://github.com/Emo-tech20/geminy.git
cd geminy

# Install dependencies
npm install

# Create .env file (copy from .env.example and fill in your credentials)
cp .env.example .env
```

### Running Locally

```bash
# Start development server (with auto-reload)
npm run dev

# Or start production server
npm start
```

Access at: `http://localhost:3000`

### Environment Variables for Local Development

Create `.env` file with:
```env
PORT=3000
CLIENT_URL=http://localhost:3000
NODE_ENV=development

SUPABASE_URL=your-supabase-url
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SUPABASE_JWKS_URL=your-supabase-url/auth/v1/.well-known/jwks.json

GEMINI_API_KEY=your-gemini-api-key
```

---

## Vercel Deployment Configuration

The `vercel.json` file configures:
- **Routes**: All requests route to `/api/index.js`
- **Functions**: Express app runs as serverless function (1024MB memory, 30s timeout)
- **Build**: `npm install` runs during build

No additional configuration needed if `vercel.json` is present.

---

## Security Best Practices

✅ **DO:**
- Keep `.env` out of Git (it's in `.gitignore`)
- Store secrets only in Vercel Environment Variables
- Use separate keys for development and production if possible
- Rotate API keys periodically
- Keep service-role keys SECRET (never expose in frontend)

❌ **DON'T:**
- Commit `.env` to GitHub
- Hardcode credentials in code
- Expose `GEMINI_API_KEY` in frontend JavaScript
- Share environment variables in chat or email
- Use same keys across development, preview, and production

---

## Troubleshooting

### "Cannot find module '@google/generative-ai'"
**Solution**: Ensure `npm install` completed. Run `npm install` again.

### "Supabase not configured" error
**Solution**: 
- Check all `SUPABASE_*` variables are set in Vercel
- Verify values are copied correctly (no extra spaces)
- Restart the deployment

### "Gemini API not configured" error
**Solution**:
- Ensure `GEMINI_API_KEY` is set in Vercel
- Verify the key is valid in [Google AI Studio](https://ai.google.dev/)
- Check the key hasn't been revoked

### CORS errors in browser console
**Solution**:
- Update `CLIENT_URL` environment variable to match your Vercel URL
- Redeploy the application
- Clear browser cache

### Health endpoint returns wrong configuration status
**Solution**:
- Go to `https://your-app.vercel.app/api/health`
- Check which configurations are marked as false
- Add missing environment variables to Vercel
- Redeploy

---

## Testing

### Local Testing

```bash
# Run tests
npm test

# All 26 tests should pass
```

### Health Check

**Local:**
```bash
curl http://localhost:3000/api/health
```

**Production:**
```bash
curl https://your-app.vercel.app/api/health
```

Expected response:
```json
{
  "status": "ok",
  "supabaseConfigured": true,
  "aiConfigured": true,
  "aiProvider": "Google Gemini",
  "timestamp": "2024-10-27T..."
}
```

### Feature Testing

1. **Sign up**: Register new account
2. **Sign in**: Login with credentials
3. **Chat**: Send message to Gemini (requires real API key)
4. **Conversation history**: Check messages persist
5. **Logout**: Verify session ends

---

## Support

- Supabase Issues: [Supabase Docs](https://supabase.com/docs)
- Gemini API: [Google AI Studio Docs](https://ai.google.dev/)
- Vercel: [Vercel Docs](https://vercel.com/docs)

---

## Quick Reference

```bash
# Local development
npm install
npm run dev

# Local testing
npm test

# Health check
curl http://localhost:3000/api/health

# Production health check
curl https://your-app.vercel.app/api/health
```


---

## Deploying to Vercel

### Option A: Using Vercel Dashboard (Recommended for First-Time Setup)

1. **Go to Vercel Dashboard**
   - Visit https://vercel.com/dashboard
   - Click "Add New..." → "Project"

2. **Import from GitHub**
   - Select "Import Git Repository"
   - Paste: `https://github.com/Emo-tech20/geminy`
   - Click "Continue"

3. **Configure Project**
   - **Project Name**: `geminy` (or your preferred name)
   - **Framework**: Leave blank (Vercel auto-detects Express)
   - Click "Continue"

4. **Add Environment Variables**
   - You'll see "Configure Environment Variables"
   - Add each variable:
     - `CLIENT_URL` 
     - `NODE_ENV` → `production`
     - `SUPABASE_URL`
     - `SUPABASE_ANON_KEY`
     - `SUPABASE_SERVICE_ROLE_KEY`
     - `SUPABASE_JWKS_URL`
     - `GEMINI_API_KEY`
   - Click "Deploy"

5. **Wait for Deployment**
   - Vercel will build and deploy
   - You'll see a preview URL like: `https://geminy-abc123.vercel.app`

6. **Update CLIENT_URL**
   - After deployment succeeds:
   - Go to Settings → Environment Variables
   - Update `CLIENT_URL` to your actual deployment URL
   - Redeploy (click "Redeploy" or push a new commit)

### Option B: Using Vercel CLI

```bash
# If not logged in:
vercel login

# Deploy to production:
vercel --prod

# Deploy to preview (default):
vercel
```

### Option C: Connect GitHub for Auto-Deploy

1. **Create `.vercelignore`** (already created)
2. **Push to GitHub** (already done)
3. **Go to Vercel → Add Project → Connect Git**
4. **Select Repository**: `Emo-tech20/geminy`
5. **Configure Environment Variables**
6. **Click Deploy**
7. **Every push to main will auto-deploy**

---

## After Deployment

### 1. Update CLIENT_URL

After your first successful deployment:

1. Note your Vercel URL (e.g., `https://geminy-xyz.vercel.app`)
2. Go to Vercel Dashboard → Project Settings
3. Environment Variables
4. Update `CLIENT_URL` to your Vercel URL
5. Click "Save" and redeploy

### 2. Test Deployment

Visit your deployed app:
```
https://your-app.vercel.app/api/health
```

Expected response:
```json
{
  "status": "ok",
  "supabaseConfigured": true,
  "aiConfigured": true,
  "aiProvider": "Google Gemini",
  "timestamp": "..."
}
```

### 3. Test Features

- Visit `https://your-app.vercel.app`
- Sign up with email
- Sign in
- Send a chat message
- Verify response from Gemini

---

## Troubleshooting Deployment

### Build Fails with "Cannot find module"

**Solution**:
```bash
# Ensure all dependencies are in package.json
npm install package-name --save

# Commit and push
git add package.json package-lock.json
git commit -m "Add missing dependency"
git push origin main
```

### App deploys but shows "Cannot GET /"

**Solution**:
- Check that `/public/index.html` exists
- Verify `vercel.json` routes all traffic to `/api/index.js`
- Check Vercel build logs for errors

### "Supabase not configured" at `/api/health`

**Solution**:
- Go to Vercel Settings → Environment Variables
- Verify all `SUPABASE_*` variables are set
- Ensure no typos in variable names
- Redeploy

### "Gemini API not configured" at `/api/health`

**Solution**:
- Add `GEMINI_API_KEY` to Vercel Environment Variables
- Ensure key is valid in Google AI Studio
- Redeploy

### CORS errors in browser console

**Solution**:
- Update `CLIENT_URL` in Vercel Environment Variables
- Match it exactly to your app URL (including protocol and domain)
- Redeploy

### Deployment takes too long or times out

**Solution**:
- Check Vercel deployment logs
- Ensure `node_modules` is in `.vercelignore`
- Try redeploying

---

## Monitoring & Maintenance

### View Logs

**Production Logs:**
```
https://vercel.com/dashboard/[your-team]/geminy → Deployments → Select deployment → Logs
```

**Real-time Logs:**
```bash
vercel logs
```

### Environment Variables Management

Update variables anytime in:
- Vercel Dashboard → Project Settings → Environment Variables
- Changes take effect on next deployment

### Scale Configuration

Default settings in `vercel.json`:
- **Memory**: 1024 MB
- **Timeout**: 30 seconds
- **Regions**: Auto (Vercel chooses best region)

To increase limits, edit `vercel.json`:
```json
{
  "functions": {
    "api/index.js": {
      "memory": 3008,
      "maxDuration": 60
    }
  }
}
```

---

## Security Checklist

- ✅ `.env` is in `.gitignore` (never committed)
- ✅ `.vercelignore` excludes sensitive files
- ✅ Environment variables stored in Vercel (not code)
- ✅ `GEMINI_API_KEY` never exposed in frontend
- ✅ `SUPABASE_SERVICE_ROLE_KEY` kept secret
- ✅ CORS configured for your domain only
- ✅ Rate limiting enabled in backend
- ✅ Database RLS policies active
