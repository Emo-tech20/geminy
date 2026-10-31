import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import settingsRoutes from '../src/routes/settings.js';
import { verifyAuth } from '../src/auth/middleware.js';

const USER_ID = 'settings-test-user';
const OTHER_USER_ID = 'another-settings-user';
const TOKEN = 'valid-settings-session';
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
const AVATAR_FIXTURES = [
  ['image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0x00])],
  ['image/png', PNG],
  ['image/webp', Buffer.from('RIFF0000WEBP', 'ascii')]
];

function createSupabase({
  profile = null,
  updateError = null,
  uploadError = null,
  signedUrlError = null,
  removeError = null
} = {}) {
  const state = {
    profile: profile && { ...profile },
    updates: [],
    uploads: [],
    removals: [],
    signedUrls: [],
    profileFilters: [],
    updateError,
    uploadError,
    signedUrlError,
    removeError
  };

  const client = {
    auth: {
      getUser: async token => token === TOKEN
        ? {
          data: {
            user: {
              id: USER_ID,
              email: 'current@example.com',
              created_at: '2024-01-02T03:04:05.000Z',
              user_metadata: { full_name: 'Initial Name' }
            }
          },
          error: null
        }
        : { data: { user: null }, error: new Error('Invalid token') }
    },
    from(table) {
      assert.equal(table, 'profiles');
      return {
        upsert: async values => {
          if (!state.profile) state.profile = { ...values };
          return { error: null };
        },
        select(columns) {
          return createQuery(state, 'select', null, columns);
        },
        update(values) {
          state.updates.push(values);
          return createQuery(state, 'update', values, null);
        }
      };
    },
    storage: {
      from(bucket) {
        assert.equal(bucket, 'profile-avatars');
        return {
          upload: async (path, bytes, options) => {
            state.uploads.push({ path, bytes: Buffer.from(bytes), options });
            return state.uploadError
              ? { data: null, error: state.uploadError }
              : { data: { path }, error: null };
          },
          createSignedUrl: async (path, expiresIn) => {
            state.signedUrls.push({ path, expiresIn });
            return state.signedUrlError
              ? { data: null, error: state.signedUrlError }
              : { data: { signedUrl: `https://storage.example/${path}?expires=${expiresIn}` }, error: null };
          },
          remove: async paths => {
            state.removals.push(...paths);
            return { data: null, error: state.removeError };
          }
        };
      }
    }
  };

  return { client, state };
}

function createQuery(state, operation, values, columns) {
  const filters = [];
  let selectedColumns = columns;
  const query = {
    eq(column, value) {
      filters.push([column, value]);
      state.profileFilters.push([column, value]);
      return this;
    },
    select(nextColumns) {
      selectedColumns = nextColumns;
      return this;
    },
    single() {
      return Promise.resolve(execute()).then(result => {
        const row = Array.isArray(result.data) ? result.data[0] : result.data;
        return { data: row || null, error: row ? result.error : result.error || { message: 'not found' } };
      });
    },
    then(resolve, reject) {
      return Promise.resolve(execute()).then(resolve, reject);
    }
  };

  function project(row) {
    if (!selectedColumns) return row;
    return Object.fromEntries(selectedColumns.split(',').map(key => {
      const field = key.trim();
      return [field, row[field]];
    }));
  }

  function execute() {
    const matches = state.profile && filters.every(([key, value]) => state.profile[key] === value);
    if (operation === 'update') {
      if (state.updateError) return { data: null, error: state.updateError };
      if (!matches) return { data: null, error: null };
      Object.assign(state.profile, values);
      return {
        data: selectedColumns ? project(state.profile) : [state.profile],
        error: null
      };
    }
    return {
      data: matches ? [project(state.profile)] : [],
      error: null
    };
  }

  return query;
}

async function startSettingsApp(t, supabase, overrides = {}) {
  const app = express();
  app.use(express.json());
  app.locals.supabase = supabase.client;
  app.locals.createUserSupabaseClient = () => supabase.client;
  Object.assign(app.locals, overrides);
  app.use('/api/settings', verifyAuth, settingsRoutes);

  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}/api/settings`;
}

function request(url, { method = 'GET', token = TOKEN, body, contentType = 'application/json' } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Connection: 'close',
        ...(body ? { 'Content-Type': contentType } : {})
      }
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        const bytes = Buffer.concat(chunks);
        resolve({
          status: response.statusCode,
          body: bytes.length ? JSON.parse(bytes.toString('utf8')) : null
        });
      });
    });
    request.on('error', reject);
    if (body) request.write(body);
    request.end();
  });
}

function profile(overrides = {}) {
  return {
    id: USER_ID,
    display_name: 'Existing Name',
    avatar_path: null,
    pending_email: null,
    created_at: '2024-01-02T03:04:05.000Z',
    updated_at: '2024-01-02T03:04:05.000Z',
    ...overrides
  };
}

test('profile retrieval initializes and reads only the authenticated user profile', async t => {
  const supabase = createSupabase({ profile: profile() });
  const baseUrl = await startSettingsApp(t, supabase);
  const response = await request(`${baseUrl}/profile`);

  assert.equal(response.status, 200);
  assert.equal(response.body.profile.displayName, 'Existing Name');
  assert.equal(response.body.profile.email, 'current@example.com');
  assert.equal(response.body.profile.accountCreatedAt, '2024-01-02T03:04:05.000Z');
  assert.equal(supabase.state.profileFilters[0][1], USER_ID);
});

test('profile edits are scoped to the authenticated user and report persistence errors', async t => {
  const supabase = createSupabase({ profile: profile() });
  const baseUrl = await startSettingsApp(t, supabase);
  const response = await request(`${baseUrl}/profile`, {
    method: 'PUT',
    body: JSON.stringify({ displayName: 'New Name', id: OTHER_USER_ID })
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.displayName, 'New Name');
  assert.equal(supabase.state.profile.id, USER_ID);
  assert.ok(supabase.state.profileFilters.some(([column, value]) => column === 'id' && value === USER_ID));

  const failedClient = createSupabase({ profile: profile(), updateError: new Error('db failure') });
  const failedUrl = await startSettingsApp(t, failedClient);
  const failed = await request(`${failedUrl}/profile`, {
    method: 'PUT',
    body: JSON.stringify({ displayName: 'Cannot Save' })
  });
  assert.equal(failed.status, 500);
  assert.match(failed.body.error, /Could not save/);
});

test('avatar upload accepts supported image signatures and saves under the authenticated user path', async t => {
  const supabase = createSupabase({ profile: profile() });
  const baseUrl = await startSettingsApp(t, supabase);
  for (const [contentType, bytes] of AVATAR_FIXTURES) {
    const response = await request(`${baseUrl}/profile/avatar`, {
      method: 'POST',
      body: bytes,
      contentType
    });
    assert.equal(response.status, 200);
    assert.match(response.body.avatarUrl, /^https:\/\/storage\.example\//);
  }
  assert.equal(supabase.state.uploads.length, AVATAR_FIXTURES.length);
  for (const [index, [contentType]] of AVATAR_FIXTURES.entries()) {
    assert.match(supabase.state.uploads[index].path, new RegExp(`^${USER_ID}/`));
    assert.equal(supabase.state.uploads[index].options.contentType, contentType);
  }

  const invalid = await request(`${baseUrl}/profile/avatar`, {
    method: 'POST',
    body: Buffer.from('not an image'),
    contentType: 'image/png'
  });
  assert.equal(invalid.status, 400);
});

test('avatar replacement removes the old image and avatar removal enforces ownership', async t => {
  const oldPath = `${USER_ID}/old.png`;
  const supabase = createSupabase({ profile: profile({ avatar_path: oldPath }) });
  const baseUrl = await startSettingsApp(t, supabase);
  const replaced = await request(`${baseUrl}/profile/avatar`, {
    method: 'POST',
    body: PNG,
    contentType: 'image/png'
  });
  assert.equal(replaced.status, 200);
  assert.deepEqual(supabase.state.removals, [oldPath]);

  supabase.state.profile.avatar_path = `${OTHER_USER_ID}/private.png`;
  const forbidden = await request(`${baseUrl}/profile/avatar`, { method: 'DELETE' });
  assert.equal(forbidden.status, 403);
  assert.equal(supabase.state.removals.includes(`${OTHER_USER_ID}/private.png`), false);
});

test('avatar removal clears the authenticated user profile and storage object', async t => {
  const avatarPath = `${USER_ID}/avatar.png`;
  const supabase = createSupabase({ profile: profile({ avatar_path: avatarPath }) });
  const baseUrl = await startSettingsApp(t, supabase);
  const response = await request(`${baseUrl}/profile/avatar`, { method: 'DELETE' });

  assert.equal(response.status, 200);
  assert.equal(response.body.avatarUrl, null);
  assert.equal(supabase.state.profile.avatar_path, null);
  assert.deepEqual(supabase.state.removals, [avatarPath]);
});

test('avatar storage failures are not reported as successful persistence', async t => {
  const supabase = createSupabase({ profile: profile(), uploadError: new Error('storage failure') });
  const baseUrl = await startSettingsApp(t, supabase);
  const response = await request(`${baseUrl}/profile/avatar`, {
    method: 'POST',
    body: PNG,
    contentType: 'image/png'
  });
  assert.equal(response.status, 500);
  assert.equal(response.body.success, undefined);
});

test('email changes request Supabase verification and persist pending status', async t => {
  const supabase = createSupabase({ profile: profile() });
  const authChanges = [];
  const baseUrl = await startSettingsApp(t, supabase, {
    updateAuthenticatedUser: async (_token, changes) => {
      authChanges.push(changes);
      return { ok: true, status: 200 };
    }
  });
  const response = await request(`${baseUrl}/email`, {
    method: 'POST',
    body: JSON.stringify({ email: 'next@example.com' })
  });

  assert.equal(response.status, 200);
  assert.deepEqual(authChanges, [{ email: 'next@example.com' }]);
  assert.equal(supabase.state.profile.pending_email, 'next@example.com');
  assert.match(response.body.message, /verification/i);
});

test('password changes validate confirmation and never persist password data', async t => {
  const supabase = createSupabase({ profile: profile() });
  const authChanges = [];
  const baseUrl = await startSettingsApp(t, supabase, {
    updateAuthenticatedUser: async (_token, changes) => {
      authChanges.push(changes);
      return { ok: true, status: 200 };
    }
  });
  const invalid = await request(`${baseUrl}/password`, {
    method: 'PUT',
    body: JSON.stringify({ password: 'password-123', confirmPassword: 'different' })
  });
  assert.equal(invalid.status, 400);

  const valid = await request(`${baseUrl}/password`, {
    method: 'PUT',
    body: JSON.stringify({ password: 'password-123', confirmPassword: 'password-123' })
  });
  assert.equal(valid.status, 200);
  assert.deepEqual(authChanges, [{ password: 'password-123' }]);
  assert.equal(JSON.stringify(supabase.state.profile).includes('password-123'), false);
});

test('invalid authentication and sign-out are handled through the existing session', async t => {
  const supabase = createSupabase({ profile: profile() });
  const signedOut = [];
  const baseUrl = await startSettingsApp(t, supabase, {
    signOutSupabaseUser: async token => {
      signedOut.push(token);
      return { ok: true };
    }
  });
  const unauthorized = await request(`${baseUrl}/profile`, { token: 'bad-token' });
  assert.equal(unauthorized.status, 401);

  const response = await request(`${baseUrl}/signout`, { method: 'POST' });
  assert.equal(response.status, 200);
  assert.deepEqual(signedOut, [TOKEN]);
});

test('theme persistence and responsive Settings navigation are wired into the existing UI', async () => {
  const appSource = await readFile(new URL('../public/js/app.js', import.meta.url), 'utf8');
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const css = await readFile(new URL('../public/css/styles.css', import.meta.url), 'utf8');
  assert.match(appSource, /localStorage\.setItem\('theme', theme\)/);
  assert.match(html, /data-action="show-settings"/);
  assert.match(html, /class="settings-current-nav" aria-current="page"/);
  assert.match(html, /class="sidebar-toggle" data-action="toggle-sidebar"/);
  assert.match(css, /@media \(max-width: 600px\)/);
  assert.match(html, /id="settings-template"/);
});
