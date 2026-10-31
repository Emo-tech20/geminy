import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import rateLimit from 'express-rate-limit';
import { verifyAuth } from './src/auth/middleware.js';
import authRoutes from './src/routes/auth.js';
import chatRoutes from './src/routes/chat.js';
import imageRoutes from './src/routes/images.js';
import settingsRoutes from './src/routes/settings.js';
import { isAIConfigured } from './src/services/aiService.js';
import { getImageGenerationInfo } from './src/services/imageGenerationService.js';

// Load environment variables FIRST before initializing services
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:3000';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Supabase client
let supabase = null;
let supabaseAdmin = null;

try {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
    // Regular client for auth verification
    supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY
    );
  }

  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    // Admin client for database operations (bypasses RLS)
    supabaseAdmin = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );
  }
} catch (error) {
  console.error('Failed to initialize Supabase:', error.message);
}

// Make supabase available to routes
app.locals.supabase = supabase;
app.locals.supabaseAdmin = supabaseAdmin;
app.locals.createUserSupabaseClient = (accessToken) => {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    return null;
  }
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    global: {
      headers: { Authorization: `Bearer ${accessToken}` }
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
};

// Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      imgSrc: ["'self'", "data:", "https:"],
      fontSrc: ["'self'", "https://fonts.googleapis.com", "https://fonts.gstatic.com"],
      connectSrc: ["'self'"],
      frameSrc: ["'none'"],
      formAction: ["'self'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"]
    }
  }
}));
app.use(cors({
  origin: CLIENT_URL,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiters
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'production' ? 5 : 100, // 5 for prod, 100 for dev
  message: 'Too many authentication attempts, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    console.log(`[Rate Limiter] Auth endpoint blocked. IP: ${req.ip}, Path: ${req.path}`);
    res.status(429).json({
      error: 'Too many authentication attempts, please try again later.',
      source: 'express-rate-limiter'
    });
  }
});

console.log(`[Rate Limiter Config] Auth: max=${process.env.NODE_ENV === 'production' ? 5 : 100} requests per 15min (NODE_ENV: ${process.env.NODE_ENV || 'undefined'})`);

const chatLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: process.env.NODE_ENV === 'production' ? 10 : 100, // 10 for prod, 100 for dev
  keyGenerator: (req) => req.user?.id || req.ip,
  message: 'Too many chat requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Routes
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/chat', verifyAuth, chatLimiter, chatRoutes);
app.use('/api/images', verifyAuth, imageRoutes);
app.use('/api/settings', verifyAuth, settingsRoutes);

// Health check
app.get('/api/health', (req, res) => {
  const imageGeneration = getImageGenerationInfo();
  res.json({
    status: 'ok',
    supabaseConfigured: !!supabase,
    aiConfigured: isAIConfigured(),
    aiProvider: 'OpenRouter',
    imageGenerationConfigured: imageGeneration.configured,
    imageGenerationProvider: imageGeneration.providerSelected,
    imageGeneration,
    timestamp: new Date().toISOString()
  });
});

// Serve index.html for SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);

  // Don't expose internal details
  const statusCode = err.statusCode || 500;
  const message = statusCode === 500
    ? 'An unexpected error occurred. Please try again later.'
    : err.message || 'An error occurred';

  res.status(statusCode).json({
    error: message,
    ...(process.env.NODE_ENV === 'development' && { details: err.message })
  });
});

// Error handling for uncaught exceptions and unhandled rejections
process.on('uncaughtException', (error) => {
  console.error('[FATAL] Uncaught Exception:', error.message);
  console.error(error.stack);
  // Don't exit - let the process continue
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] Unhandled Rejection at:', promise);
  console.error('Reason:', reason);
  // Don't exit - let the process continue
});

// Start server with graceful shutdown handling
const server = app.listen(PORT, () => {
  console.log(`Nova AI server running on http://localhost:${PORT}`);
  console.log(`Supabase configured: ${!!supabase}`);
  console.log(`OpenRouter AI configured: ${isAIConfigured()}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Handle graceful shutdown
const handleShutdown = (signal) => {
  console.log(`\n[Server] Received ${signal}, closing server...`);
  server.close(() => {
    console.log('[Server] Closed cleanly');
    process.exit(0);
  });

  // Force close after 10 seconds
  setTimeout(() => {
    console.error('[Server] Force closing after timeout');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));

export default app;
