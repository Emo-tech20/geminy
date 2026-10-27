# Nova AI - Intelligent Assistant Web Application

A polished, responsive AI assistant web application built with HTML5, CSS3, vanilla JavaScript, Node.js/Express, and Supabase. Users can register, sign in, ask questions, and receive genuine AI-generated answers in a secure, feature-rich chat interface.

## Features

- **User Authentication**: Secure sign-up, sign-in, and password reset using Supabase Auth
- **AI Chat Interface**: Real-time chat with persistent conversation history
- **Conversation Management**: Create, rename, delete, and organize conversations
- **Dark/Light Theme**: Automatic theme support with user preference persistence
- **Responsive Design**: Mobile-first design that works on all devices
- **Security Features**: 
  - Row-level security policies on database
  - Request validation and sanitization
  - Rate limiting on authentication and chat endpoints
  - Secure token handling with refresh mechanism
  - Never exposes API keys or secrets to the frontend
- **Accessibility**: Semantic HTML, keyboard navigation, ARIA labels, and focus management

## Tech Stack

- **Frontend**: HTML5, CSS3, Vanilla JavaScript (ES6+)
- **Backend**: Node.js with Express.js
- **Authentication**: Supabase Auth
- **Database**: Supabase (PostgreSQL)
- **AI Provider**: Google Gemini API (via @google/generative-ai SDK)
- **Deployment Ready**: CORS, Helmet security middleware, environment-based configuration

## Prerequisites

Before you begin, ensure you have:

- **Node.js** 18+ and npm installed ([Download here](https://nodejs.org/))
- **Supabase** account ([Sign up free](https://supabase.com))
- **Google Gemini API credentials** ([Get API key](https://ai.google.dev))

## Quick Start

### 1. Clone or Download the Project

```bash
cd geminy
```

### 2. Install Dependencies

```bash
npm install
```

### 2.5. Get Google Gemini API Key

1. Go to [Google AI Studio](https://ai.google.dev)
2. Click on "Get API Key" button
3. Create a new API key or use an existing one
4. Copy the API key
5. Keep it safe - you'll add it to `.env` in the next step

The integration uses the official [@google/generative-ai](https://www.npmjs.com/package/@google/generative-ai) SDK with the **gemini-1.5-flash** model, which is:
- Fast and cost-effective
- Supports real-time conversations
- Works with message history for context
- Currently maintained and production-ready

### 3. Set Up Environment Variables

Copy the example configuration and fill in your credentials:

```bash
# Windows
copy .env.example .env

# macOS/Linux
cp .env.example .env
```

Edit `.env` with your actual credentials:

```env
# Server
PORT=3000
CLIENT_URL=http://localhost:3000
NODE_ENV=development

# Supabase - Get these from your Supabase project settings
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key-from-supabase
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Google Gemini API - Get from https://ai.google.dev
GEMINI_API_KEY=your-gemini-api-key-here
```

### 4. Set Up Supabase Database

1. Go to your [Supabase project](https://supabase.com/dashboard)
2. Navigate to **SQL Editor**
3. Click **New Query**
4. Copy the entire content of `database-setup.sql` and paste it
5. Click **Run**

This creates:
- `conversations` table with user foreign key
- `messages` table linked to conversations
- Row-level security (RLS) policies ensuring users can only access their own data
- Indexes for better query performance
- Auto-update timestamp trigger

**Important**: Ensure RLS policies are enabled on both tables for security.

### 5. Configure Supabase Auth

1. In Supabase, go to **Authentication** → **Providers**
2. Ensure **Email** provider is enabled
3. Configure email templates if desired
4. Note your `SUPABASE_URL` and `SUPABASE_ANON_KEY` from Settings → API

### 6. Start the Server

```bash
npm start
```

For development with auto-reload:

```bash
npm run dev
```

The application will be available at `http://localhost:3000`

## Testing

Run the test suite:

```bash
npm test
```

Tests verify:
- Email and password validation
- Request validation (field requirements, length limits)
- Authentication error handling
- Security measures (XSS prevention, input trimming)
- Rate limiting
- User ownership checks

## Usage

### Landing Page
- See app overview and features
- Access sign-up and sign-in buttons
- Theme toggle in top-right corner

### Sign Up
- Enter full name, email, and password
- Password must be at least 8 characters
- Check "Accept Terms and Privacy Policy"
- Receive email confirmation link

### Sign In
- Enter email and password
- Option to reset forgotten password
- Session persists until sign out

### Chat
- **New Chat**: Click the "New Chat" button to start a conversation
- **Ask Questions**: Type in the composer and press Enter (or click Send)
- **Keyboard Shortcuts**: 
  - `Enter` to send
  - `Shift+Enter` for a new line
- **Manage Conversations**:
  - Click a conversation to load it
  - Hover over a conversation and click the pencil icon to rename
  - Hover over a conversation and click the trash icon to delete
- **Message Actions**:
  - Hover over AI responses to see "Copy" button
  - Copy answers to your clipboard
- **Theme**: Click the theme toggle (sun/moon icon) in the account menu

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Server port (default: 3000) |
| `CLIENT_URL` | Yes | Frontend origin for CORS (e.g., http://localhost:3000) |
| `NODE_ENV` | No | Environment: development or production |
| `SUPABASE_URL` | Yes | Your Supabase project URL |
| `SUPABASE_ANON_KEY` | Yes | Supabase anonymous API key |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase service role key for backend operations |
| `GEMINI_API_KEY` | Yes | Your Google Gemini API key (get from [Google AI Studio](https://ai.google.dev)) |

## API Endpoints

All endpoints except auth require the `Authorization: Bearer <token>` header.

### Authentication

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/auth/signup` | POST | Register a new user |
| `/api/auth/signin` | POST | Sign in with email/password |
| `/api/auth/refresh` | POST | Refresh access token |
| `/api/auth/forgot-password` | POST | Request password reset |
| `/api/auth/user` | GET | Verify and get current user |

### Chat

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/chat/conversations` | GET | Get all conversations for user |
| `/api/chat/conversations` | POST | Create a new conversation |
| `/api/chat/conversations/:id` | PUT | Update conversation title |
| `/api/chat/conversations/:id` | DELETE | Delete a conversation |
| `/api/chat/conversations/:id/messages` | GET | Get messages in a conversation |
| `/api/chat/conversations/:id/messages` | POST | Send a message and get AI response |

## Architecture

### Frontend
- **SPA (Single Page Application)**: Single index.html with template-based page rendering
- **CSS Modules**: Organized with CSS custom properties for theming
- **Vanilla JavaScript**: No frameworks, lightweight and performant
- **LocalStorage**: Persists authentication tokens and user theme preference

### Backend
- **Express.js**: Lightweight HTTP server
- **Middleware**:
  - `helmet`: Security headers
  - `cors`: Cross-origin requests
  - `express-rate-limit`: Request rate limiting
  - Custom auth middleware for token verification
- **API Structure**: RESTful endpoints grouped by feature
- **Error Handling**: Consistent error responses without exposing internals

### Database
- **Supabase (PostgreSQL)**:
  - Row-Level Security (RLS) policies for multi-tenant isolation
  - Indexes for query performance
  - Foreign keys for referential integrity
  - Automatic timestamp management

## Security Considerations

✅ **Implemented**
- Passwords are hashed and managed by Supabase Auth
- API keys never stored or logged
- Request validation and sanitization
- SQL injection prevention via parameterized queries (Supabase SDK)
- XSS prevention by escaping user content
- CSRF protection via token-based auth
- CORS configured for specific origin
- Rate limiting on sensitive endpoints
- Row-level security enforces data isolation
- Secure session handling with refresh tokens
- User ownership checks on all protected resources

⚠️ **Production Checklist**
- [ ] Set `NODE_ENV=production`
- [ ] Use HTTPS in production (`CLIENT_URL` must be https)
- [ ] Enable email verification in Supabase
- [ ] Review Supabase RLS policies before deploying
- [ ] Rotate API keys periodically
- [ ] Monitor server logs for suspicious activity
- [ ] Set up proper error logging (avoid logging secrets)
- [ ] Use environment secrets manager (AWS Secrets Manager, Azure Key Vault, etc.)

## Troubleshooting

### "Supabase not configured" error
- Verify `SUPABASE_URL` and `SUPABASE_ANON_KEY` are set in `.env`
- Check that your Supabase project is active
- Restart the server after changing environment variables

### "Gemini API not configured" error
- Ensure `GEMINI_API_KEY` is set in `.env`
- Verify your API key is valid (get from [Google AI Studio](https://ai.google.dev))
- Check that the key hasn't been revoked
- Restart the server after adding the key

### "Gemini API authentication failed"
- Verify the API key is correct (no extra spaces or characters)
- Check API key hasn't expired in Google AI Studio
- Verify the project has the Generative AI API enabled
- Try generating a new API key if the current one isn't working

### Chat shows "blocked by safety filters"
- Google Gemini API has safety filters that may block certain content
- Try rewording your question
- Avoid harmful, explicit, or inappropriate content
- This is a protective measure and cannot be disabled

## File Structure

```
geminy/
├── server.js                 # Express server entry point
├── package.json              # Dependencies and scripts
├── .env.example              # Environment variables template
├── .gitignore                # Git ignore rules
├── database-setup.sql        # Supabase database schema
├── README.md                 # This file
│
├── public/                   # Static files (served to clients)
│   ├── index.html            # Main HTML with all templates
│   ├── js/
│   │   └── app.js            # Frontend application logic
│   └── css/
│       └── styles.css        # All styling and responsive design
│
├── src/
│   ├── routes/
│   │   ├── auth.js           # Authentication endpoints
│   │   └── chat.js           # Chat and conversation endpoints
│   ├── auth/
│   │   └── middleware.js     # JWT verification middleware
│   └── services/
│       ├── aiService.js      # AI provider integration
│       └── dbService.js      # Database operations
│
└── test/
    └── auth.test.js          # Validation and security tests
```

## Google Gemini API Setup

### Get Your API Key

1. Visit [Google AI Studio](https://ai.google.dev)
2. Click on **"Get API Key"** or **"API Keys"** in the top navigation
3. Click **"Create API Key"** (or select an existing one)
4. Copy the generated API key
5. Add it to your `.env` file as `GEMINI_API_KEY`

### Supported Model

This integration uses **gemini-1.5-flash**, which is:
- ✅ Fast and efficient for real-time chat
- ✅ Cost-effective
- ✅ Supports multi-turn conversations with context
- ✅ Actively maintained by Google
- ✅ Production-ready

### How It Works

The backend integration:
1. Receives user messages from the frontend via authenticated API
2. Maintains conversation history (last 20 messages)
3. Sends messages to Google Gemini API using the official [@google/generative-ai](https://www.npmjs.com/package/@google/generative-ai) SDK
4. Returns AI responses to the frontend
5. Stores all messages in Supabase for persistence

### Rate Limits

Google Gemini API has rate limits:
- Free tier: 60 requests per minute
- Premium tier: Higher limits available with billing

The backend enforces additional rate limiting:
- 10 requests per minute per user for chat messages
- 5 requests per 15 minutes per IP for authentication

### Troubleshooting Gemini

**Q: I get "API key not found" error**
- Make sure `GEMINI_API_KEY` is in your `.env` file
- Verify the key is copied correctly with no extra spaces
- Restart the server after updating `.env`

**Q: Messages are blocked by safety filters**
- Google Gemini has built-in safety measures
- Try rewording your message
- Avoid harmful, explicit, or inappropriate requests

**Q: Rate limit exceeded**
- Wait a moment before sending the next message
- Check if you're sending too many requests rapidly

**Q: "Request timeout"**
- Gemini API took too long to respond (30 second timeout)
- Try again with a shorter message
- Check your internet connection

## Deployment

### Vercel (Recommended for simplicity)

1. Push your code to GitHub
2. Go to [Vercel](https://vercel.com) and sign in
3. Click "New Project" and select your repository
4. Set environment variables in project settings
5. Deploy

**Note**: Vercel has serverless functions with 10-second timeout. For longer AI responses, use a different platform.

### Heroku

1. Install [Heroku CLI](https://devcenter.heroku.com/articles/heroku-cli)
2. `heroku create your-app-name`
3. Set environment variables: `heroku config:set VAR_NAME=value`
4. Push to Heroku: `git push heroku main`

### Self-Hosted (VPS/Dedicated Server)

1. Install Node.js on your server
2. Clone your repository
3. Set environment variables
4. Install dependencies: `npm install`
5. Run with a process manager like PM2: `pm2 start server.js`
6. Use Nginx as a reverse proxy for SSL/TLS

## Performance Optimization

- **Message Context**: Limited to last 20 messages to manage token usage
- **Request Timeout**: 30 seconds for AI API calls
- **Database Indexes**: Optimized queries with proper indexing
- **Rate Limiting**: Prevents abuse and ensures fair use
- **Lazy Loading**: Conversations loaded on demand

## Contributing

This is a spec-driven implementation. For issues or improvements, please document the changes clearly and test thoroughly.

## License

This project is provided as-is for educational and development purposes.

## Support

For issues with:
- **Supabase**: https://supabase.com/docs
- **OpenAI API**: https://platform.openai.com/docs
- **Node.js/Express**: https://expressjs.com
- **General Web Development**: https://developer.mozilla.org

## What's NOT Included (Yet)

- Image uploads or file sharing
- Conversation sharing or collaboration
- Advanced analytics
- Custom model selection UI
- API rate limit dashboards
- Email notifications
- Multi-language support

These can be added as future enhancements.

---

**Built with ❤️ for developers who want a powerful AI chat experience**
