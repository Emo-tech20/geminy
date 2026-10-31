import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { test } from 'node:test';
import { verifyAuth } from '../src/auth/middleware.js';
import chatRoutes from '../src/routes/chat.js';
import {
  clearOpenRouterModelCache,
  getModelFamily,
  getOpenRouterModels,
  sendMessage,
  validateOpenRouterModel
} from '../src/services/openrouterService.js';

const USER_ID = 'chat-test-user';
const CATALOG = [
  { id: 'openai/model-fixture', name: 'GPT fixture', context_length: 1000 },
  { id: 'google/model-fixture', name: 'Gemini fixture', context_length: 1000 },
  { id: 'anthropic/model-fixture', name: 'Claude fixture', context_length: 1000 },
  { id: 'x-ai/model-fixture', name: 'Grok fixture', context_length: 1000 },
  { id: 'other/model-fixture', name: 'Unsupported fixture', context_length: 1000 }
];

function isolateOpenRouterEnvironment(t, { apiKey = 'test-openrouter-key', model = '' } = {}) {
  const previous = {
    apiKey: process.env.OPENROUTER_API_KEY,
    model: process.env.OPENROUTER_MODEL
  };
  t.after(() => {
    if (previous.apiKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previous.apiKey;
    if (previous.model === undefined) delete process.env.OPENROUTER_MODEL;
    else process.env.OPENROUTER_MODEL = previous.model;
    clearOpenRouterModelCache();
  });

  if (apiKey) process.env.OPENROUTER_API_KEY = apiKey;
  else delete process.env.OPENROUTER_API_KEY;
  if (model) process.env.OPENROUTER_MODEL = model;
  else delete process.env.OPENROUTER_MODEL;
  clearOpenRouterModelCache();
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), { status });
}

function mockOpenRouter(t, { completionStatus = 200, completionBody } = {}) {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith('/models')) {
      return jsonResponse({ data: CATALOG });
    }
    if (String(url).endsWith('/chat/completions')) {
      return jsonResponse(completionBody || {
        model: 'openai/model-fixture',
        choices: [{ message: { content: 'A real-looking but mocked response.' } }]
      }, completionStatus);
    }
    throw new Error(`Unexpected mock URL: ${url}`);
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  return calls;
}

test('model families are derived from provider catalogue IDs', () => {
  assert.equal(getModelFamily('openai/model-fixture'), 'GPT');
  assert.equal(getModelFamily('google/model-fixture'), 'Gemini');
  assert.equal(getModelFamily('anthropic/model-fixture'), 'Claude');
  assert.equal(getModelFamily('x-ai/model-fixture'), 'Grok');
  assert.equal(getModelFamily('unlisted/model-fixture'), null);
});

test('catalogue only exposes supported model families and caches successful results', async t => {
  isolateOpenRouterEnvironment(t, { model: 'google/model-fixture' });
  const calls = mockOpenRouter(t);

  const first = await getOpenRouterModels();
  const second = await getOpenRouterModels();
  assert.equal(first.success, true);
  assert.deepEqual(first.models.map(model => model.family), ['Claude', 'Gemini', 'GPT', 'Grok']);
  assert.equal(first.models.some(model => model.id === 'other/model-fixture'), false);
  assert.equal(first.defaultModel, 'google/model-fixture');
  assert.equal(second.success, true);
  assert.equal(calls.filter(call => call.url.endsWith('/models')).length, 1);
});

test('catalogue failures fall back to the last cached list without breaking selection', async t => {
  isolateOpenRouterEnvironment(t);
  const originalFetch = globalThis.fetch;
  let unavailable = false;
  globalThis.fetch = async url => String(url).endsWith('/models')
    ? unavailable
      ? jsonResponse({ error: 'temporarily unavailable' }, 503)
      : jsonResponse({ data: CATALOG })
    : jsonResponse({});
  t.after(() => { globalThis.fetch = originalFetch; });

  const fresh = await getOpenRouterModels();
  unavailable = true;
  const stale = await getOpenRouterModels({ forceRefresh: true });
  const selected = await validateOpenRouterModel('google/model-fixture');
  assert.equal(fresh.catalogStale, false);
  assert.equal(stale.success, true);
  assert.equal(stale.catalogStale, true);
  assert.match(stale.warning, /cached models/i);
  assert.equal(selected.success, true);
});

test('missing OpenRouter credentials fail without provider requests', async t => {
  isolateOpenRouterEnvironment(t, { apiKey: '' });
  const calls = mockOpenRouter(t);
  const result = await getOpenRouterModels();
  assert.equal(result.success, false);
  assert.equal(result.code, 'missing_credentials');
  assert.equal(calls.length, 0);
});

test('unsupported selected model is rejected without sending a completion', async t => {
  isolateOpenRouterEnvironment(t);
  const calls = mockOpenRouter(t);
  const result = await sendMessage([], 'Hello', { model: 'other/model-fixture' });
  assert.equal(result.success, false);
  assert.equal(result.code, 'unsupported_model');
  assert.equal(calls.some(call => call.url.endsWith('/chat/completions')), false);
});

test('selected model and conversation history are sent to OpenRouter exactly', async t => {
  isolateOpenRouterEnvironment(t);
  const calls = mockOpenRouter(t);
  const history = [
    { role: 'user', content: 'Earlier question' },
    { role: 'assistant', content: 'Earlier answer' },
    { role: 'user', content: 'An earlier unanswered request' }
  ];

  const result = await sendMessage(history, 'Current question', { model: 'google/model-fixture' });
  const completionCall = calls.find(call => call.url.endsWith('/chat/completions'));
  const body = JSON.parse(completionCall.options.body);
  assert.equal(result.success, true);
  assert.equal(result.model, 'openai/model-fixture');
  assert.equal(result.requestedModel, 'google/model-fixture');
  assert.equal(body.model, 'google/model-fixture');
  assert.deepEqual(body.messages.map(message => message.content), [
    'Earlier question',
    'Earlier answer',
    'An earlier unanswered request',
    'Current question'
  ]);
  assert.equal(completionCall.options.headers.Authorization, 'Bearer test-openrouter-key');
});

test('provider errors return clear status-specific failures', async t => {
  isolateOpenRouterEnvironment(t);
  mockOpenRouter(t, { completionStatus: 429, completionBody: { error: { message: 'busy' } } });
  const result = await sendMessage([], 'Hello', { model: 'openai/model-fixture' });
  assert.equal(result.success, false);
  assert.equal(result.code, 'rate_limited');
  assert.match(result.error, /rate limit/i);
});

test('timeout aborts the pending OpenRouter completion request', async t => {
  isolateOpenRouterEnvironment(t);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/models')) return jsonResponse({ data: CATALOG });
    return new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        reject(new DOMException('Aborted', 'AbortError'));
      }, { once: true });
    });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const started = Date.now();
  const result = await sendMessage([], 'Hello', {
    model: 'openai/model-fixture',
    timeoutMs: 10
  });
  assert.equal(result.success, false);
  assert.equal(result.code, 'timeout');
  assert.ok(Date.now() - started < 1000);
});

test('caller cancellation aborts the provider request and returns canceled', async t => {
  isolateOpenRouterEnvironment(t);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/models')) return jsonResponse({ data: CATALOG });
    return new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        reject(new DOMException('Aborted', 'AbortError'));
      }, { once: true });
    });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const controller = new AbortController();
  const request = sendMessage([], 'Hello', {
    model: 'openai/model-fixture',
    signal: controller.signal
  });
  setTimeout(() => controller.abort(), 10);
  const result = await request;
  assert.equal(result.success, false);
  assert.equal(result.code, 'cancelled');
});

function createSupabase({ assistantInsertFails = false } = {}) {
  const state = {
    conversation: { id: 'conversation-1', user_id: USER_ID, title: 'New Chat' },
    messages: [],
    nextId: 1
  };

  function query(table) {
    const operation = { type: 'select', filters: {}, payload: null };
    const builder = {
      select() {
        return builder;
      },
      insert(payload) {
        operation.type = 'insert';
        operation.payload = payload;
        return builder;
      },
      update(payload) {
        operation.type = 'update';
        operation.payload = payload;
        return builder;
      },
      delete() {
        operation.type = 'delete';
        return builder;
      },
      eq(key, value) {
        operation.filters[key] = value;
        return builder;
      },
      order() {
        return builder;
      },
      limit() {
        return builder;
      },
      async single() {
        return execute();
      },
      then(resolve, reject) {
        return execute().then(resolve, reject);
      }
    };

    async function execute() {
      if (table === 'conversations' && operation.type === 'select') {
        return {
          data: operation.filters.id === state.conversation.id ? state.conversation : null,
          error: null
        };
      }
      if (table === 'messages' && operation.type === 'select') {
        return {
          data: state.messages.filter(message =>
            message.conversation_id === operation.filters.conversation_id
          ),
          error: null
        };
      }
      if (table === 'messages' && operation.type === 'insert') {
        if (assistantInsertFails && operation.payload.role === 'assistant') {
          return { data: null, error: new Error('simulated assistant insert failure') };
        }
        const inserted = { id: `message-${state.nextId++}`, ...operation.payload };
        state.messages.push(inserted);
        return { data: inserted, error: null };
      }
      if (table === 'messages' && operation.type === 'delete') {
        state.messages = state.messages.filter(message =>
          message.id !== operation.filters.id || message.user_id !== operation.filters.user_id
        );
        return { data: null, error: null };
      }
      if (table === 'conversations' && operation.type === 'update') {
        Object.assign(state.conversation, operation.payload);
        return { data: state.conversation, error: null };
      }
      throw new Error(`Unexpected database query: ${table} ${operation.type}`);
    }
    return builder;
  }

  return {
    state,
    client: {
      auth: {
        getUser: async token => token === 'valid-session'
          ? { data: { user: { id: USER_ID } }, error: null }
          : { data: { user: null }, error: new Error('Invalid token') }
      },
      from: query
    }
  };
}

async function startChatApp(t, supabase) {
  const app = express();
  app.use(express.json());
  app.locals.supabase = supabase.client;
  app.locals.supabaseAdmin = supabase.client;
  app.use('/api/chat', verifyAuth, chatRoutes);
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}/api/chat`;
}

function httpJson(url, { method = 'GET', body } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(url, {
      method,
      headers: {
        Authorization: 'Bearer valid-session',
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

test('mocked chat route persists only successful provider turns and reports the model', async t => {
  isolateOpenRouterEnvironment(t);
  const calls = mockOpenRouter(t);
  const supabase = createSupabase();
  const baseUrl = await startChatApp(t, supabase);

  const response = await httpJson(`${baseUrl}/conversations/conversation-1/messages`, {
    method: 'POST',
    body: { message: 'Hello', model: 'google/model-fixture' }
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.model, 'openai/model-fixture');
  assert.equal(supabase.state.messages.length, 2);
  assert.deepEqual(supabase.state.messages.map(message => message.role), ['user', 'assistant']);
  assert.equal(JSON.parse(calls.find(call => call.url.endsWith('/chat/completions')).options.body).model,
    'google/model-fixture');
});

test('mocked chat route does not persist unanswered messages after provider failure', async t => {
  isolateOpenRouterEnvironment(t);
  mockOpenRouter(t, { completionStatus: 503, completionBody: { error: { message: 'unavailable' } } });
  const supabase = createSupabase();
  const baseUrl = await startChatApp(t, supabase);

  const response = await httpJson(`${baseUrl}/conversations/conversation-1/messages`, {
    method: 'POST',
    body: { message: 'Hello', model: 'openai/model-fixture' }
  });
  assert.equal(response.status, 503);
  assert.equal(response.body.success, false);
  assert.equal(response.body.code, 'provider_unavailable');
  assert.equal(supabase.state.messages.length, 0);
});

test('mocked chat route rolls back the user row if assistant persistence fails', async t => {
  isolateOpenRouterEnvironment(t);
  mockOpenRouter(t);
  const supabase = createSupabase({ assistantInsertFails: true });
  const baseUrl = await startChatApp(t, supabase);

  const response = await httpJson(`${baseUrl}/conversations/conversation-1/messages`, {
    method: 'POST',
    body: { message: 'Hello', model: 'openai/model-fixture' }
  });
  assert.equal(response.status, 500);
  assert.equal(response.body.code, 'message_persistence_failed');
  assert.equal(supabase.state.messages.length, 0);
});

test('mocked chat route rejects invalid authentication', async t => {
  isolateOpenRouterEnvironment(t);
  const supabase = createSupabase();
  const baseUrl = await startChatApp(t, supabase);
  const response = await new Promise((resolve, reject) => {
    const request = http.request(`${baseUrl}/models`, {
      headers: { Authorization: 'Bearer invalid-session', Connection: 'close' }
    }, result => {
      let data = '';
      result.on('data', chunk => { data += chunk; });
      result.on('end', () => resolve({ status: result.statusCode, body: JSON.parse(data) }));
    });
    request.on('error', reject);
    request.end();
  });
  assert.equal(response.status, 401);
});
