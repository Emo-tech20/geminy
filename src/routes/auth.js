import express from 'express';

const router = express.Router();

// Sign up
router.post('/signup', async (req, res) => {
  try {
    const { email, password, fullName } = req.body;
    const supabase = req.app.locals.supabase;

    console.log('[Signup] Request received for email:', email?.substring(0, 3) + '***');

    if (!supabase) {
      console.error('Supabase not configured');
      return res.status(503).json({ error: 'Authentication service not configured' });
    }

    // Validate required fields
    if (!email || !password || !fullName) {
      return res.status(400).json({ error: 'Email, password, and full name are required' });
    }

    // Validate email format
    const emailRegex = /^[a-zA-Z0-9._+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Validate password length
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long' });
    }

    // Create user with Supabase Auth
    console.log('[Signup] Calling Supabase signUp...');
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName
        }
      }
    });

    console.log('[Signup] Supabase response received:', {
      hasError: !!error,
      hasData: !!data,
      hasUser: !!data?.user,
      hasSession: !!data?.session,
      errorMessage: error?.message,
      errorStatus: error?.status,
      errorCode: error?.code
    });

    if (error) {
      console.error('[Signup] Supabase error:', error.message, `(status: ${error.status}, code: ${error.code})`);

      // Handle rate limiting from Supabase (upstream - cannot be bypassed)
      // Note: Supabase rate limits persist even with email confirmation disabled
      // Wait time: typically 1 hour, or use different email domains for testing
      if (error.status === 429 || error.code === 'over_email_send_rate_limit' || error.message.includes('rate limit')) {
        return res.status(429).json({
          error: 'Too many signup attempts. Please wait a while before trying again.',
          source: 'supabase'
        });
      }

      // Handle specific error cases
      if (error.message.includes('already registered') || error.message.includes('already been registered')) {
        return res.status(400).json({ error: 'This email is already registered' });
      }

      if (error.message.includes('password') || error.message.includes('Password')) {
        return res.status(400).json({ error: error.message });
      }

      if (error.message.includes('email') || error.message.includes('Email')) {
        return res.status(400).json({ error: 'Invalid email address' });
      }

      // Generic error
      return res.status(400).json({ error: 'Sign up failed. Please try again.' });
    }

    // Log signup success details (without sensitive data)
    console.log('[Signup] Success:', {
      userId: data.user?.id,
      hasSession: !!data.session,
      emailConfirmed: data.user?.email_confirmed_at ? 'yes' : 'no',
      identitiesCount: data.user?.identities?.length || 0
    });

    res.status(201).json({
      message: data.user?.identities?.length === 0
        ? 'Sign up successful. Please check your email to verify your account.'
        : 'Sign up successful!',
      user: {
        id: data.user?.id,
        email: data.user?.email,
        emailConfirmed: !!data.user?.email_confirmed_at
      },
      session: data.session ? {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token
      } : null,
      requiresEmailVerification: !data.session
    });
  } catch (error) {
    console.error('Sign up error:', error.message);
    res.status(500).json({ error: 'Sign up failed. Please try again.' });
  }
});

// Sign in
router.post('/signin', async (req, res) => {
  try {
    const { email, password } = req.body;
    const supabase = req.app.locals.supabase;

    console.log('[Signin] Request received for email:', email?.substring(0, 3) + '***');

    if (!supabase) {
      return res.status(503).json({ error: 'Authentication service not configured' });
    }

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      console.error('[Signin] Supabase error:', error.message, `(status: ${error.status}, code: ${error.code})`);

      // Check for specific error cases
      if (error.message.includes('Email not confirmed')) {
        return res.status(401).json({
          error: 'Please verify your email before signing in. Check your inbox for a confirmation link.',
          code: 'email_not_confirmed'
        });
      }

      return res.status(401).json({ error: 'Invalid email or password' });
    }

    console.log('[Signin] Success for user:', data.user?.id);

    res.json({
      message: 'Sign in successful',
      user: {
        id: data.user?.id,
        email: data.user?.email
      },
      session: {
        access_token: data.session?.access_token,
        refresh_token: data.session?.refresh_token
      }
    });
  } catch (error) {
    console.error('Sign in error:', error.message);
    res.status(500).json({ error: 'Sign in failed. Please try again.' });
  }
});

// Refresh token
router.post('/refresh', async (req, res) => {
  try {
    const { refresh_token } = req.body;
    const supabase = req.app.locals.supabase;

    if (!supabase) {
      return res.status(503).json({ error: 'Authentication service not configured' });
    }

    if (!refresh_token) {
      return res.status(400).json({ error: 'Refresh token is required' });
    }

    const { data, error } = await supabase.auth.refreshSession({
      refresh_token
    });

    if (error) {
      return res.status(401).json({ error: 'Failed to refresh session' });
    }

    res.json({
      session: {
        access_token: data.session?.access_token,
        refresh_token: data.session?.refresh_token
      }
    });
  } catch (error) {
    console.error('Refresh error:', error.message);
    res.status(500).json({ error: 'Failed to refresh session' });
  }
});

// Password reset request
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    const supabase = req.app.locals.supabase;
    const redirectUrl = `${process.env.CLIENT_URL}/reset-password`;

    if (!supabase) {
      return res.status(503).json({ error: 'Authentication service not configured' });
    }

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: redirectUrl
    });

    if (error) {
      console.error('Password reset error:', error.message);
    }

    // Always return success to prevent email enumeration
    res.json({ message: 'If an account exists with that email, a password reset link has been sent.' });
  } catch (error) {
    console.error('Forgot password error:', error.message);
    res.status(500).json({ error: 'Failed to process password reset request' });
  }
});

// Verify user session
router.get('/user', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const supabase = req.app.locals.supabase;

    if (!supabase) {
      return res.status(503).json({ error: 'Authentication service not configured' });
    }

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const token = authHeader.substring(7);
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    res.json({ user });
  } catch (error) {
    console.error('Get user error:', error.message);
    res.status(500).json({ error: 'Failed to verify user' });
  }
});

export default router;
