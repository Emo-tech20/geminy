import express from 'express';

const router = express.Router();

// Sign up
router.post('/signup', async (req, res) => {
  try {
    const { email, password, fullName } = req.body;
    const supabase = req.app.locals.supabase;

    if (!supabase) {
      return res.status(503).json({ error: 'Authentication service not configured' });
    }

    // Validate required fields
    if (!email || !password || !fullName) {
      return res.status(400).json({ error: 'Email, password, and full name are required' });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Validate password length
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long' });
    }

    // Create user with Supabase Auth
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName
        }
      }
    });

    if (error) {
      // Don't expose whether email exists
      if (error.message.includes('already registered')) {
        return res.status(400).json({ error: 'This email is already registered' });
      }
      return res.status(400).json({ error: 'Sign up failed. Please try again.' });
    }

    res.status(201).json({
      message: 'Sign up successful. Please check your email to verify your account.',
      user: {
        id: data.user?.id,
        email: data.user?.email
      }
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
      return res.status(401).json({ error: 'Invalid email or password' });
    }

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
