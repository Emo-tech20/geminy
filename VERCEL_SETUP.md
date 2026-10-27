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
