import { randomUUID } from 'node:crypto';
import express from 'express';

const router = express.Router();
const AVATAR_BUCKET = 'profile-avatars';
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const PROFILE_COLUMNS = 'id,display_name,avatar_path,pending_email,created_at,updated_at';

function getUserClient(req) {
  return req.app.locals.createUserSupabaseClient?.(req.accessToken) || null;
}

function getAvatarInfo(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > MAX_AVATAR_BYTES) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { contentType: 'image/jpeg', extension: 'jpg' };
  }
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { contentType: 'image/png', extension: 'png' };
  }
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    return { contentType: 'image/webp', extension: 'webp' };
  }
  return null;
}

async function ensureProfile(req, client) {
  const userId = req.user.id;
  const { error: insertError } = await client
    .from('profiles')
    .upsert({
      id: userId,
      display_name: String(req.user.user_metadata?.full_name || '').trim().slice(0, 80)
    }, {
      onConflict: 'id',
      ignoreDuplicates: true
    });
  if (insertError) throw new Error('Profile could not be initialized.');

  const { data, error } = await client
    .from('profiles')
    .select(PROFILE_COLUMNS)
    .eq('id', userId)
    .single();
  if (error || !data) throw new Error('Profile could not be loaded.');
  return data;
}

async function signedAvatarUrl(client, userId, avatarPath) {
  if (!avatarPath) return null;
  if (!avatarPath.startsWith(`${userId}/`)) {
    throw new Error('Avatar path does not belong to this user.');
  }
  const { data, error } = await client.storage
    .from(AVATAR_BUCKET)
    .createSignedUrl(avatarPath, 60 * 60);
  if (error || !data?.signedUrl) throw new Error('Profile picture could not be loaded.');
  return data.signedUrl;
}

async function updateAuthenticatedUser(req, changes) {
  const customUpdater = req.app.locals.updateAuthenticatedUser;
  if (customUpdater) return customUpdater(req.accessToken, changes);

  const baseUrl = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!baseUrl || !anonKey) {
    return { ok: false, status: 503, data: null };
  }

  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/auth/v1/user`, {
    method: 'PUT',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${req.accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(changes)
  });
  const data = await response.json().catch(() => null);
  return { ok: response.ok, status: response.status, data };
}

function authFailureResponse(res, result, operation) {
  if (result.status === 401) {
    return res.status(401).json({ error: 'Your session expired. Sign in again and retry.' });
  }
  if (result.status === 429) {
    return res.status(429).json({ error: 'Too many requests. Please wait and try again.' });
  }
  const message = operation === 'email'
    ? 'Supabase could not start the email change. Check the address and try again.'
    : 'Supabase could not update your password. Sign in again and retry.';
  return res.status(result.status >= 500 ? 502 : 400).json({ error: message });
}

router.get('/profile', async (req, res) => {
  try {
    const client = getUserClient(req);
    if (!client) return res.status(503).json({ error: 'Profile service is not configured.' });

    const profile = await ensureProfile(req, client);
    if (profile.pending_email && req.user.email === profile.pending_email) {
      const { error } = await client
        .from('profiles')
        .update({ pending_email: null })
        .eq('id', req.user.id);
      if (!error) profile.pending_email = null;
    }

    const avatarUrl = await signedAvatarUrl(client, req.user.id, profile.avatar_path);
    res.json({
      success: true,
      profile: {
        displayName: profile.display_name || '',
        email: req.user.email || '',
        pendingEmail: profile.pending_email || null,
        accountCreatedAt: req.user.created_at || null,
        avatarUrl
      }
    });
  } catch {
    res.status(500).json({ error: 'Could not load your profile.' });
  }
});

router.put('/profile', async (req, res) => {
  const displayName = typeof req.body?.displayName === 'string'
    ? req.body.displayName.trim()
    : '';
  if (!displayName || displayName.length > 80) {
    return res.status(400).json({ error: 'Display name must be between 1 and 80 characters.' });
  }

  try {
    const client = getUserClient(req);
    if (!client) return res.status(503).json({ error: 'Profile service is not configured.' });
    const { data, error } = await client
      .from('profiles')
      .update({ display_name: displayName })
      .eq('id', req.user.id)
      .select(PROFILE_COLUMNS)
      .single();
    if (error || !data) return res.status(500).json({ error: 'Could not save your profile.' });

    res.json({ success: true, displayName: data.display_name });
  } catch {
    res.status(500).json({ error: 'Could not save your profile.' });
  }
});

router.post(
  '/profile/avatar',
  express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: MAX_AVATAR_BYTES }),
  async (req, res) => {
    let uploadedPath;
    try {
      const client = getUserClient(req);
      if (!client) return res.status(503).json({ error: 'Profile storage is not configured.' });
      const contentType = req.get('content-type')?.split(';')[0].trim().toLowerCase();
      const avatar = getAvatarInfo(req.body);
      if (!avatar || avatar.contentType !== contentType) {
        return res.status(400).json({ error: 'Choose a valid JPEG, PNG, or WebP image up to 5 MB.' });
      }

      const profile = await ensureProfile(req, client);
      uploadedPath = `${req.user.id}/${randomUUID()}.${avatar.extension}`;
      const { error: uploadError } = await client.storage
        .from(AVATAR_BUCKET)
        .upload(uploadedPath, req.body, {
          contentType: avatar.contentType,
          cacheControl: '3600',
          upsert: false
        });
      if (uploadError) return res.status(500).json({ error: 'Could not upload your profile picture.' });

      const { error: updateError } = await client
        .from('profiles')
        .update({ avatar_path: uploadedPath })
        .eq('id', req.user.id);
      if (updateError) {
        await client.storage.from(AVATAR_BUCKET).remove([uploadedPath]);
        uploadedPath = null;
        return res.status(500).json({ error: 'Could not save your profile picture.' });
      }

      if (profile.avatar_path && profile.avatar_path.startsWith(`${req.user.id}/`)) {
        const { error: removeError } = await client.storage
          .from(AVATAR_BUCKET)
          .remove([profile.avatar_path]);
        if (removeError) console.error('[Settings] Replaced profile picture cleanup failed.');
      }

      const avatarUrl = await signedAvatarUrl(client, req.user.id, uploadedPath);
      res.json({ success: true, avatarUrl });
    } catch {
      if (uploadedPath) {
        try {
          const client = getUserClient(req);
          await client?.storage.from(AVATAR_BUCKET).remove([uploadedPath]);
        } catch {
          console.error('[Settings] Profile picture cleanup failed.');
        }
      }
      res.status(500).json({ error: 'Could not save your profile picture.' });
    }
  }
);

router.delete('/profile/avatar', async (req, res) => {
  try {
    const client = getUserClient(req);
    if (!client) return res.status(503).json({ error: 'Profile storage is not configured.' });
    const profile = await ensureProfile(req, client);
    if (!profile.avatar_path) return res.json({ success: true, avatarUrl: null });
    if (!profile.avatar_path.startsWith(`${req.user.id}/`)) {
      return res.status(403).json({ error: 'Profile picture ownership check failed.' });
    }

    const { error: updateError } = await client
      .from('profiles')
      .update({ avatar_path: null })
      .eq('id', req.user.id);
    if (updateError) return res.status(500).json({ error: 'Could not remove your profile picture.' });

    const { error: removeError } = await client.storage
      .from(AVATAR_BUCKET)
      .remove([profile.avatar_path]);
    if (removeError) {
      return res.status(500).json({
        success: false,
        error: 'Profile picture was detached, but storage cleanup failed.'
      });
    }
    res.json({ success: true, avatarUrl: null });
  } catch {
    res.status(500).json({ error: 'Could not remove your profile picture.' });
  }
});

router.post('/email', async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (!/^[a-zA-Z0-9._+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email)) {
    return res.status(400).json({ error: 'Enter a valid email address.' });
  }
  if (email === String(req.user.email || '').toLowerCase()) {
    return res.status(400).json({ error: 'That is already your current email address.' });
  }

  try {
    const client = getUserClient(req);
    if (!client) return res.status(503).json({ error: 'Profile service is not configured.' });
    await ensureProfile(req, client);

    const result = await updateAuthenticatedUser(req, { email });
    if (!result.ok) return authFailureResponse(res, result, 'email');
    const { data, error } = await client
      .from('profiles')
      .update({ pending_email: email })
      .eq('id', req.user.id)
      .select('id')
      .single();
    if (error || !data) {
      return res.status(500).json({
        success: false,
        error: 'Verification was requested, but pending email status could not be saved.'
      });
    }
    res.json({
      success: true,
      pendingEmail: email,
      message: 'Check your new email address for Supabase verification instructions.'
    });
  } catch {
    res.status(500).json({ error: 'Could not request an email address change.' });
  }
});

router.put('/password', async (req, res) => {
  const password = req.body?.password;
  const confirmPassword = req.body?.confirmPassword;
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
    return res.status(400).json({ error: 'Password must be between 8 and 128 characters.' });
  }
  if (password !== confirmPassword) {
    return res.status(400).json({ error: 'Passwords do not match.' });
  }

  try {
    const result = await updateAuthenticatedUser(req, { password });
    if (!result.ok) return authFailureResponse(res, result, 'password');
    res.json({ success: true, message: 'Your password has been updated.' });
  } catch {
    res.status(500).json({ error: 'Could not update your password.' });
  }
});

router.post('/signout', async (req, res) => {
  try {
    const customSignOut = req.app.locals.signOutSupabaseUser;
    if (customSignOut) {
      const result = await customSignOut(req.accessToken);
      if (!result.ok) return res.status(502).json({ error: 'Could not end the Supabase session.' });
      return res.json({ success: true });
    }

    const baseUrl = process.env.SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY;
    if (!baseUrl || !anonKey) return res.status(503).json({ error: 'Authentication service is not configured.' });
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/auth/v1/logout`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${req.accessToken}`
      }
    });
    if (!response.ok) return res.status(502).json({ error: 'Could not end the Supabase session.' });
    res.json({ success: true });
  } catch {
    res.status(502).json({ error: 'Could not end the Supabase session.' });
  }
});

router.use((error, req, res, next) => {
  if (error?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Profile pictures must be 5 MB or smaller.' });
  }
  if (error?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid profile picture request.' });
  }
  return next(error);
});

export default router;
