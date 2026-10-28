import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import rateLimit from 'express-rate-limit';
import { verifyAuth } from './src/auth/middleware.js';
import authRoutes from './src/routes/auth.js';
import chatRoutes from './src/routes/chat.js';
import { isAIConfigured } from './src/services/aiService.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:3000';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Supabase client
let supabase = null;
try {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
    supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY
    );
  }
} catch (error) {
  console.error('Failed to initialize Supabase:', error.message);
}

// Make supabase available to routes
app.locals.supabase = supabase;

// Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
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
  max: 5, // limit each IP to 5 requests per windowMs
  message: 'Too many authentication attempts, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

const chatLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 10, // limit each user to 10 requests per minute
  keyGenerator: (req) => req.user?.id || req.ip,
  message: 'Too many chat requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Routes
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/chat', verifyAuth, chatLimiter, chatRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    supabaseConfigured: !!supabase,
    aiConfigured: isAIConfigured(),
    aiProvider: 'Google Gemini',
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

// Start server
app.listen(PORT, () => {
  console.log(`Nova AI server running on http://localhost:${PORT}`);
  console.log(`Supabase configured: ${!!supabase}`);
  console.log(`Google Gemini AI configured: ${isAIConfigured()}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

export default app;
