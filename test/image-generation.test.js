import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { test } from 'node:test';
import imageRoutes from '../src/routes/images.js';
import { verifyAuth } from '../src/auth/middleware.js';
import {
  generateImage,
  getImageGenerationInfo,
  isImageGenerationConfigured
} from '../src/services/imageGenerationService.js';

const USER_ID = 'authenticated-user';
const OTHER_USER_ID = 'another-user';
const ENV_KEYS = [
  'IMAGE_GENERATION_PROVIDER',
  'CLOUDFLARE_ACCOUNT_ID',
  'CLOUDFLARE_API_TOKEN'
];
const TEST_ACCOUNT_ID = 'test-cloudflare-account-id';
const TEST_API_TOKEN = 'test-cloudflare-api-token';
const FIXTURES = {
  'image/jpeg': Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD5/ooooA//2Q==', 'base64'),
  'image/png': Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAANSURBVBhXY2BgYGAAAAAFAAGKM+MAAAAAAElFTkSuQmCC', 'base64'),
  'image/webp': Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64')
};

function isolateImageEnvironment(t, values = {}) {
  const previous = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]));
  t.after(() => {
    for (const key of ENV_KEYS) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });

  for (const key of ENV_KEYS) delete process.env[key];
  if (values.provider) process.env.IMAGE_GENERATION_PROVIDER = values.provider;
  if (values.accountId) process.env.CLOUDFLARE_ACCOUNT_ID = values.accountId;
  if (values.apiToken) process.env.CLOUDFLARE_API_TOKEN = values.apiToken;
}

function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers }
  });
}

function makeQuery(state, table, operation, value) {
  assert.equal(table, 'generated_images');
  const filters = [];
  let selectedColumns = '';
  let limit = Infinity;
  const query = {
    eq(column, expected) {
      filters.push([column, expected]);
      return this;
    },
    order() {
      return this;
    },
    limit(count) {
      limit = count;
      return this;
    },
    select(columns) {
      selectedColumns = columns;
      state.selectedColumns.push(columns);
      return this;
    },
    single() {
      return Promise.resolve(run()[0] || null).then(data => ({
        data,
        error: data ? null : { message: 'not found' }
      }));
    },
    then(resolve, reject) {
      const result = run();
      return Promise.resolve(operation === 'select' ? { data: result, error: null } : result)
        .then(resolve, reject);
    }
  };

  function run() {
    const matches = row => filters.every(([key, expected]) => row[key] === expected);
    if (operation === 'update') {
      const rows = state.rows.filter(matches);
      for (const row of rows) Object.assign(row, value);
      return { data: rows, error: state.updateError };
    }
    if (operation === 'delete') {
      if (state.deleteError) return { data: null, error: state.deleteError };
      state.rows = state.rows.filter(row => !matches(row));
      return { data: null, error: null };
    }
    if (operation === 'select') {
      const rows = state.rows.filter(matches).slice(0, limit);
      return rows.map(row => {
        if (!selectedColumns) return row;
        const keys = selectedColumns.split(',').map(key => key.trim());
        return Object.fromEntries(keys.map(key => [key, row[key]]));
      });
    }
    throw new Error(`Unsupported fake query operation: ${operation}`);
  }

  return query;
}

function createSupabase({
  insertError = null,
  uploadError = null,
  signedUrlError = null,
  removeError = null,
  rows = [],
  deleteError = null,
  updateError = null
} = {}) {
  const state = {
    rows: rows.map(row => ({ ...row })),
    inserts: [],
    uploads: [],
    removed: [],
    signed: [],
    selectedColumns: [],
    filters: [],
    insertError,
    uploadError,
    signedUrlError,
    removeError,
    deleteError,
    updateError
  };
  const client = {
    auth: {
      getUser: async token => token === 'valid-session'
        ? { data: { user: { id: USER_ID } }, error: null }
        : { data: { user: null }, error: new Error('Invalid token') }
    },
    from(table) {
      return {
        insert: row => {
          state.inserts.push(row);
          if (state.insertError) {
            return {
              select: () => ({ single: async () => ({ data: null, error: state.insertError }) })
            };
          }
          const insertedRow = { id: `image-${state.rows.length + 1}`, ...row };
          state.rows.push(insertedRow);
          return {
            select: () => ({ single: async () => ({ data: { id: insertedRow.id }, error: null }) })
          };
        },
        select(columns) {
          state.filters.push([]);
          const query = makeQuery(state, table, 'select');
          const originalEq = query.eq;
          query.eq = (column, expected) => {
            state.filters[state.filters.length - 1].push([column, expected]);
            return originalEq.call(query, column, expected);
          };
          return query.select(columns);
        },
        update(values) {
          return makeQuery(state, table, 'update', values);
        },
        delete() {
          return makeQuery(state, table, 'delete');
        }
      };
    },
    storage: {
      from(bucket) {
        assert.equal(bucket, 'generated-images');
        return {
          upload: async (path, bytes, options) => {
            state.uploads.push({ path, bytes: Buffer.from(bytes), options });
            if (state.uploadError) return { error: state.uploadError };
            return { data: { path }, error: null };
          },
          createSignedUrl: async (path, expiresIn) => {
            state.signed.push({ path, expiresIn });
            if (state.signedUrlError) return { data: null, error: state.signedUrlError };
            return { data: { signedUrl: `https://storage.example/${path}?expires=${expiresIn}` }, error: null };
          },
          download: async path => {
            const uploaded = state.uploads.find(item => item.path === path);
            if (!uploaded) return { data: null, error: { message: 'not found' } };
            const blob = new Blob([uploaded.bytes], { type: uploaded.options.contentType });
            return { data: blob, error: null };
          },
          remove: async paths => {
            state.removed.push(...paths);
            return { data: null, error: state.removeError };
          }
        };
      }
    }
  };

  return { state, client };
}

async function startImageApp(t, supabase) {
  const app = express();
  app.use(express.json());
  app.locals.supabase = supabase.client;
  app.locals.supabaseAdmin = supabase.client;
  app.use('/api/images', verifyAuth, imageRoutes);

  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}/api/images`;
}

function requestJson(url, { method = 'GET', token = 'valid-session', body } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Connection: 'close',
        ...(body ? { 'Content-Type': 'application/json' } : {})
      }
    }, response => {
      let data = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { data += chunk; });
      response.on('end', () => resolve({
        status: response.statusCode,
        body: JSON.parse(data)
      }));
    });
    request.on('error', reject);
    if (body) request.write(JSON.stringify(body));
    request.end();
  });
}

function configureProvider(t) {
  isolateImageEnvironment(t, {
    provider: 'cloudflare',
    accountId: TEST_ACCOUNT_ID,
    apiToken: TEST_API_TOKEN
  });
}

test('missing Cloudflare credentials fail without contacting the provider', async t => {
  isolateImageEnvironment(t, { provider: 'cloudflare' });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('Provider must not be called without credentials');
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await generateImage('A quiet mountain lake');
  assert.equal(result.success, false);
  assert.equal(result.code, 'missing_credentials');
  assert.match(result.error, /CLOUDFLARE_ACCOUNT_ID/);
  assert.equal(getImageGenerationInfo().credentialsConfigured, false);
  assert.equal(isImageGenerationConfigured(), false);
});

test('Cloudflare configuration reports status without exposing credentials', t => {
  configureProvider(t);
  const info = getImageGenerationInfo();

  assert.equal(info.providerSelected, 'cloudflare');
  assert.equal(info.model, '@cf/black-forest-labs/flux-1-schnell');
  assert.equal(info.credentialsConfigured, true);
  assert.equal(info.providerAvailability, 'unknown');
  assert.equal(info.demoMode, false);
  assert.equal(info.configured, true);
  assert.equal(JSON.stringify(info).includes(TEST_ACCOUNT_ID), false);
  assert.equal(JSON.stringify(info).includes(TEST_API_TOKEN), false);
});

test('Cloudflare image generation accepts valid JPEG, PNG, and WebP signatures', async t => {
  configureProvider(t);
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  for (const [mimeType, bytes] of Object.entries(FIXTURES)) {
    globalThis.fetch = async () => jsonResponse({
      success: true,
      result: { image: bytes.toString('base64') }
    });
    const result = await generateImage('A quiet mountain lake');
    assert.equal(result.success, true);
    assert.equal(result.imageMimeType, mimeType);
    assert.deepEqual(result.imageBytes, bytes);
    assert.equal(result.demo, false);
  }
});

test('Cloudflare raw image responses are signature validated', async t => {
  configureProvider(t);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(FIXTURES['image/jpeg'], {
    status: 200,
    headers: { 'Content-Type': 'image/jpeg' }
  });
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await generateImage('A red bicycle');
  assert.equal(result.success, true);
  assert.deepEqual(result.imageBytes, FIXTURES['image/jpeg']);
});

test('empty, invalid, and oversized image responses are rejected', async t => {
  configureProvider(t);
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  for (const response of [
    new Response(Buffer.alloc(0), { headers: { 'Content-Type': 'image/jpeg' } }),
    new Response(Buffer.from('not an image'), { headers: { 'Content-Type': 'image/jpeg' } }),
    jsonResponse({ success: true, result: { image: Buffer.from('not-image').toString('base64') } }),
    jsonResponse({ success: true, result: { image: '' } })
  ]) {
    globalThis.fetch = async () => response;
    const result = await generateImage('A red bicycle');
    assert.equal(result.success, false);
    assert.equal(result.code, 'invalid_image');
  }

  let cancelled = false;
  globalThis.fetch = async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(20 * 1024 * 1024));
      controller.enqueue(new Uint8Array(1));
    },
    cancel() {
      cancelled = true;
    }
  }), { headers: { 'Content-Type': 'image/jpeg' } });
  const oversized = await generateImage('A red bicycle');
  assert.equal(oversized.success, false);
  assert.equal(oversized.code, 'image_too_large');
  assert.equal(cancelled, true);
});

test('Cloudflare authentication, permission, usage, rate, and server failures are sanitized', async t => {
  configureProvider(t);
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  for (const [status, code] of [
    [401, 'invalid_credentials'],
    [403, 'permission_denied'],
    [402, 'usage_limited'],
    [429, 'rate_limited'],
    [503, 'provider_unavailable']
  ]) {
    globalThis.fetch = async () => jsonResponse({ errors: [{ message: TEST_API_TOKEN }] }, status);
    const result = await generateImage('A red bicycle');
    assert.equal(result.success, false);
    assert.equal(result.code, code);
    assert.equal(result.error.includes(TEST_API_TOKEN), false);
  }
});

test('invalid prompt is rejected before contacting Cloudflare', async t => {
  configureProvider(t);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('Provider must not be called for invalid prompts');
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await generateImage('   ');
  assert.equal(result.success, false);
  assert.equal(result.code, 'invalid_prompt');
});

test('generation timeout aborts the Cloudflare request', async t => {
  configureProvider(t);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (_url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {
      once: true
    });
  });
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await generateImage('A red bicycle', { timeoutMs: 10 });
  assert.equal(result.success, false);
  assert.equal(result.code, 'timeout');
});

test('invalid authentication is rejected by the existing auth middleware', async t => {
  isolateImageEnvironment(t);
  const supabase = createSupabase();
  const baseUrl = await startImageApp(t, supabase);

  const response = await requestJson(`${baseUrl}/status`, { token: 'invalid-session' });
  assert.equal(response.status, 401);
  assert.match(response.body.error, /Invalid token/);
});

test('authenticated status endpoint reports Cloudflare configuration without secrets', async t => {
  configureProvider(t);
  const supabase = createSupabase();
  const baseUrl = await startImageApp(t, supabase);

  const response = await requestJson(`${baseUrl}/status`);
  assert.equal(response.status, 200);
  assert.equal(response.body.providerSelected, 'cloudflare');
  assert.equal(response.body.model, '@cf/black-forest-labs/flux-1-schnell');
  assert.equal(response.body.credentialsConfigured, true);
  assert.equal(JSON.stringify(response.body).includes(TEST_ACCOUNT_ID), false);
  assert.equal(JSON.stringify(response.body).includes(TEST_API_TOKEN), false);
});

test('authenticated generation uploads bytes and stores only owner-scoped metadata', async t => {
  configureProvider(t);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => jsonResponse({
    success: true,
    result: { image: FIXTURES['image/jpeg'].toString('base64') }
  });
  t.after(() => { globalThis.fetch = originalFetch; });

  const supabase = createSupabase();
  const baseUrl = await startImageApp(t, supabase);
  const response = await requestJson(`${baseUrl}/generate`, {
    method: 'POST',
    body: { prompt: 'A red bicycle' }
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.saved, true);
  assert.equal(response.body.provider, 'cloudflare-workers-ai');
  assert.equal(response.body.model, '@cf/black-forest-labs/flux-1-schnell');
  assert.equal(response.body.imageId, 'image-1');
  assert.match(response.body.imageUrl, /^https:\/\/storage\.example\/authenticated-user\//);
  assert.equal(supabase.state.uploads.length, 1);
  assert.equal(supabase.state.uploads[0].options.contentType, 'image/jpeg');
  assert.deepEqual(supabase.state.uploads[0].bytes, FIXTURES['image/jpeg']);
  assert.equal(supabase.state.inserts[0].user_id, USER_ID);
  assert.equal(supabase.state.inserts[0].image_url, null);
  assert.equal(supabase.state.inserts[0].storage_path, supabase.state.uploads[0].path);
  assert.equal(supabase.state.inserts[0].image_size_bytes, FIXTURES['image/jpeg'].length);
});

test('Cloudflare usage limits do not upload or persist an image', async t => {
  configureProvider(t);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => jsonResponse({ errors: [{ message: 'account limit' }] }, 402);
  t.after(() => { globalThis.fetch = originalFetch; });

  const supabase = createSupabase();
  const baseUrl = await startImageApp(t, supabase);
  const response = await requestJson(`${baseUrl}/generate`, {
    method: 'POST',
    body: { prompt: 'A red bicycle' }
  });

  assert.equal(response.status, 402);
  assert.equal(response.body.code, 'usage_limited');
  assert.equal(supabase.state.inserts.length, 0);
  assert.equal(supabase.state.uploads.length, 0);
});

test('storage upload failure is reported without a successful save response', async t => {
  configureProvider(t);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => jsonResponse({
    success: true,
    result: { image: FIXTURES['image/jpeg'].toString('base64') }
  });
  t.after(() => { globalThis.fetch = originalFetch; });

  const supabase = createSupabase({ uploadError: { message: 'private storage error' } });
  const baseUrl = await startImageApp(t, supabase);
  const response = await requestJson(`${baseUrl}/generate`, {
    method: 'POST',
    body: { prompt: 'A red bicycle' }
  });

  assert.equal(response.status, 500);
  assert.equal(response.body.success, false);
  assert.equal(response.body.saved, undefined);
  assert.equal(supabase.state.inserts.length, 0);
});

test('database persistence failure removes the uploaded object and reports failure', async t => {
  configureProvider(t);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => jsonResponse({
    success: true,
    result: { image: FIXTURES['image/jpeg'].toString('base64') }
  });
  t.after(() => { globalThis.fetch = originalFetch; });

  const supabase = createSupabase({ insertError: { message: 'database unavailable' } });
  const baseUrl = await startImageApp(t, supabase);
  const response = await requestJson(`${baseUrl}/generate`, {
    method: 'POST',
    body: { prompt: 'A red bicycle' }
  });

  assert.equal(response.status, 500);
  assert.equal(response.body.success, false);
  assert.equal(response.body.generated, true);
  assert.equal(response.body.saved, false);
  assert.deepEqual(supabase.state.removed, [supabase.state.uploads[0].path]);
});

test('history returns signed URLs and only user-scoped image metadata', async t => {
  configureProvider(t);
  const supabase = createSupabase({
    rows: [{
      id: 'history-image',
      user_id: USER_ID,
      prompt: 'A red bicycle',
      image_url: null,
      storage_path: `${USER_ID}/image.jpg`,
      image_mime_type: 'image/jpeg',
      provider: 'cloudflare-workers-ai',
      model: '@cf/black-forest-labs/flux-1-schnell',
      created_at: '2026-10-31T12:00:00.000Z'
    }]
  });
  const baseUrl = await startImageApp(t, supabase);
  const response = await requestJson(`${baseUrl}/history`);

  assert.equal(response.status, 200);
  assert.equal(response.body.count, 1);
  assert.equal(response.body.images[0].imageUrl, `https://storage.example/${USER_ID}/image.jpg?expires=3600`);
  assert.equal(response.body.images[0].storage_path, undefined);
  assert.equal(response.body.images[0].image_url, undefined);
  assert.ok(supabase.state.filters.some(filters =>
    filters.some(([column, value]) => column === 'user_id' && value === USER_ID)
  ));
  assert.equal(supabase.state.selectedColumns[0], 'id,prompt,storage_path,image_mime_type,provider,model,created_at');
  assert.equal(supabase.state.selectedColumns.length, 1);
});

test('legacy Base64 history is moved to private storage without returning Base64', async t => {
  configureProvider(t);
  const legacyDataUri = `data:image/jpeg;base64,${FIXTURES['image/jpeg'].toString('base64')}`;
  const supabase = createSupabase({
    rows: [{
      id: 'legacy-image',
      user_id: USER_ID,
      prompt: 'An older image',
      image_url: legacyDataUri,
      storage_path: null,
      image_mime_type: null,
      provider: 'replicate',
      model: 'flux-pro',
      created_at: '2025-01-01T00:00:00.000Z'
    }]
  });
  const baseUrl = await startImageApp(t, supabase);
  const response = await requestJson(`${baseUrl}/history`);

  assert.equal(response.status, 200);
  assert.match(response.body.images[0].imageUrl, /^https:\/\/storage\.example\/authenticated-user\//);
  assert.equal(JSON.stringify(response.body).includes('data:image/'), false);
  assert.equal(supabase.state.rows[0].image_url, null);
  assert.match(supabase.state.rows[0].storage_path, /^authenticated-user\//);
  assert.deepEqual(supabase.state.uploads[0].bytes, FIXTURES['image/jpeg']);
  assert.ok(supabase.state.selectedColumns.includes('image_url'));
});

test('history does not sign or expose another user’s storage path', async t => {
  configureProvider(t);
  const supabase = createSupabase({
    rows: [{
      id: 'foreign-image',
      user_id: USER_ID,
      prompt: 'Not mine',
      image_url: null,
      storage_path: `${OTHER_USER_ID}/private.jpg`,
      image_mime_type: 'image/jpeg',
      provider: 'cloudflare-workers-ai',
      model: '@cf/black-forest-labs/flux-1-schnell',
      created_at: '2026-10-31T12:00:00.000Z'
    }]
  });
  const baseUrl = await startImageApp(t, supabase);
  const response = await requestJson(`${baseUrl}/history`);

  assert.equal(response.status, 200);
  assert.equal(response.body.images[0].imageUrl, null);
  assert.equal(response.body.images[0].imageUnavailable, true);
  assert.equal(supabase.state.signed.length, 0);
});

test('image deletion removes the owned database row and storage object', async t => {
  configureProvider(t);
  const supabase = createSupabase({
    rows: [{
      id: 'deletable-image',
      user_id: USER_ID,
      prompt: 'To delete',
      image_url: null,
      storage_path: `${USER_ID}/remove.jpg`
    }]
  });
  const baseUrl = await startImageApp(t, supabase);
  const response = await requestJson(`${baseUrl}/deletable-image`, { method: 'DELETE' });

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.deepEqual(supabase.state.removed, [`${USER_ID}/remove.jpg`]);
  assert.equal(supabase.state.rows.length, 0);
});

test('image deletion cannot access another user’s row', async t => {
  configureProvider(t);
  const supabase = createSupabase({
    rows: [{
      id: 'foreign-image',
      user_id: OTHER_USER_ID,
      prompt: 'Not mine',
      image_url: null,
      storage_path: `${OTHER_USER_ID}/private.jpg`
    }]
  });
  const baseUrl = await startImageApp(t, supabase);
  const response = await requestJson(`${baseUrl}/foreign-image`, { method: 'DELETE' });

  assert.equal(response.status, 404);
  assert.equal(supabase.state.removed.length, 0);
  assert.equal(supabase.state.rows.length, 1);
});

test('storage deletion failure preserves the history entry for retry', async t => {
  configureProvider(t);
  const supabase = createSupabase({
    removeError: { message: 'storage unavailable' },
    rows: [{
      id: 'retry-delete',
      user_id: USER_ID,
      prompt: 'Retry deletion',
      image_url: null,
      storage_path: `${USER_ID}/retry.jpg`
    }]
  });
  const baseUrl = await startImageApp(t, supabase);
  const response = await requestJson(`${baseUrl}/retry-delete`, { method: 'DELETE' });

  assert.equal(response.status, 500);
  assert.equal(response.body.error, 'Could not remove the stored image; history entry was preserved.');
  assert.equal(supabase.state.rows.length, 1);
});

test('image download returns bytes only for the authenticated owner', async t => {
  configureProvider(t);
  const supabase = createSupabase({
    rows: [{
      id: 'download-image',
      user_id: USER_ID,
      prompt: 'A red bicycle',
      image_url: null,
      storage_path: `${USER_ID}/download.jpg`,
      image_mime_type: 'image/jpeg'
    }]
  });
  supabase.state.uploads.push({
    path: `${USER_ID}/download.jpg`,
    bytes: FIXTURES['image/jpeg'],
    options: { contentType: 'image/jpeg' }
  });
  const baseUrl = await startImageApp(t, supabase);

  const request = await fetch(`${baseUrl}/download-image/download`, {
    headers: { Authorization: 'Bearer valid-session' }
  });
  assert.equal(request.status, 200);
  assert.equal(request.headers.get('content-type'), 'image/jpeg');
  assert.deepEqual(Buffer.from(await request.arrayBuffer()), FIXTURES['image/jpeg']);

  const denied = await fetch(`${baseUrl}/foreign-image/download`, {
    headers: { Authorization: 'Bearer valid-session' }
  });
  assert.equal(denied.status, 404);
});

test('explicit mock mode remains identified as demo and is not persisted', async t => {
  isolateImageEnvironment(t, { provider: 'mock' });
  const supabase = createSupabase();
  const baseUrl = await startImageApp(t, supabase);

  const status = await requestJson(`${baseUrl}/status`);
  assert.equal(status.status, 200);
  assert.equal(status.body.providerSelected, 'mock');
  assert.equal(status.body.demoMode, true);
  assert.equal(status.body.credentialsConfigured, false);

  const response = await requestJson(`${baseUrl}/generate`, {
    method: 'POST',
    body: { prompt: 'A red bicycle' }
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.demoMode, true);
  assert.equal(response.body.saved, false);
  assert.equal(response.body.provider, 'mock');
  assert.match(Buffer.from(response.body.imageUrl.split(',')[1], 'base64').toString(), /DEMO MODE/);
  assert.equal(supabase.state.inserts.length, 0);
});
