const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const REQUEST_TIMEOUT = 30000;
const MODEL_CACHE_TTL = 5 * 60 * 1000;
const MODEL_FAMILIES = {
  openai: 'GPT',
  google: 'Gemini',
  anthropic: 'Claude',
  'x-ai': 'Grok'
};

let cachedModels = null;
let modelCacheExpiresAt = 0;

function getStaleModelResult() {
  if (!cachedModels?.length) {
    return null;
  }
  modelCacheExpiresAt = Date.now() + 30000;
  return {
    success: true,
    models: cachedModels,
    defaultModel: getDefaultModelId(),
    catalogStale: true,
    warning: 'OpenRouter catalogue is temporarily unavailable; showing the most recently cached models.'
  };
}

export function getModelFamily(modelId) {
  if (typeof modelId !== 'string') {
    return null;
  }
  const publisher = modelId.split('/')[0].toLowerCase();
  return MODEL_FAMILIES[publisher] || null;
}

function getDefaultModelId() {
  return process.env.OPENROUTER_MODEL?.trim() || null;
}

function createTimeoutSignal(externalSignal, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', onAbort, { once: true });
    }
  }

  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timeoutId);
      externalSignal?.removeEventListener('abort', onAbort);
    }
  };
}

async function requestJson(url, options = {}, timeoutMs = REQUEST_TIMEOUT) {
  const timeout = createTimeoutSignal(options.signal, timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: timeout.signal });
    const data = await response.json().catch(() => null);
    return { response, data };
  } finally {
    timeout.cleanup();
  }
}

function parseCatalog(data) {
  if (!Array.isArray(data?.data)) {
    throw new Error('OpenRouter returned an invalid model catalogue.');
  }

  return data.data
    .map(model => {
      const family = getModelFamily(model?.id);
      if (!family || typeof model.name !== 'string') {
        return null;
      }

      return {
        id: model.id,
        name: model.name,
        family,
        contextLength: Number.isFinite(model.context_length) ? model.context_length : null,
        description: typeof model.description === 'string' ? model.description : ''
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.family.localeCompare(right.family) || left.name.localeCompare(right.name));
}

export async function getOpenRouterModels({ forceRefresh = false } = {}) {
  if (!process.env.OPENROUTER_API_KEY) {
    return {
      success: false,
      code: 'missing_credentials',
      error: 'OpenRouter is not configured. Set OPENROUTER_API_KEY on the server.'
    };
  }
  if (!forceRefresh && cachedModels && Date.now() < modelCacheExpiresAt) {
    return {
      success: true,
      models: cachedModels,
      defaultModel: getDefaultModelId(),
      catalogStale: false
    };
  }

  try {
    const { response, data } = await requestJson(`${OPENROUTER_BASE_URL}/models`, {
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'HTTP-Referer': process.env.OPENROUTER_HTTP_REFERER || 'http://localhost:3000',
        'X-Title': 'EMOVA AI'
      }
    });

    if (!response.ok) {
      const staleModels = getStaleModelResult();
      if (staleModels) return staleModels;
      return {
        success: false,
        code: response.status === 429 ? 'rate_limited' : 'catalog_unavailable',
        error: response.status === 429
          ? 'OpenRouter rate limit reached while loading models. Try again shortly.'
          : 'Unable to load available models from OpenRouter.'
      };
    }

    const models = parseCatalog(data);
    cachedModels = models;
    modelCacheExpiresAt = Date.now() + MODEL_CACHE_TTL;
    return { success: true, models, defaultModel: getDefaultModelId(), catalogStale: false };
  } catch (error) {
    const staleModels = getStaleModelResult();
    if (staleModels) return staleModels;
    return {
      success: false,
      code: error.name === 'AbortError' ? 'timeout' : 'catalog_unavailable',
      error: error.name === 'AbortError'
        ? 'OpenRouter model catalogue request timed out.'
        : 'Unable to connect to the OpenRouter model catalogue.'
    };
  }
}

export async function validateOpenRouterModel(modelId) {
  if (typeof modelId !== 'string' || !modelId.trim()) {
    return {
      success: false,
      code: 'model_required',
      error: 'Select a model before sending your message.'
    };
  }

  const catalog = await getOpenRouterModels();
  if (!catalog.success) {
    return catalog;
  }

  const model = catalog.models.find(candidate => candidate.id === modelId);
  if (!model) {
    return {
      success: false,
      code: 'unsupported_model',
      error: 'That model is not currently available in the OpenRouter catalogue. Refresh the model list and select another model.'
    };
  }
  return { success: true, model };
}

function getProviderError(status, data) {
  const providerMessage = data?.error?.message;
  const details = typeof providerMessage === 'string' ? providerMessage : '';
  if (status === 401 || status === 403) {
    return { code: 'provider_authentication', error: 'OpenRouter rejected its server credentials.' };
  }
  if (status === 402) {
    return { code: 'provider_payment_required', error: 'OpenRouter requires an available balance or billing configuration.' };
  }
  if (status === 404) {
    return {
      code: 'model_unavailable',
      error: details || 'OpenRouter could not route the selected model. Choose another available model.'
    };
  }
  if (status === 429) {
    return { code: 'rate_limited', error: 'OpenRouter rate limit reached. Try again shortly.' };
  }
  if (status >= 500) {
    return { code: 'provider_unavailable', error: 'OpenRouter is temporarily unavailable. Try again shortly.' };
  }
  return {
    code: 'provider_error',
    error: details || `OpenRouter rejected the request (HTTP ${status}).`
  };
}

function extractAssistantText(data) {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === 'string') {
    return content.trim();
  }
  if (Array.isArray(content)) {
    return content
      .filter(part => part?.type === 'text' && typeof part.text === 'string')
      .map(part => part.text)
      .join('')
      .trim();
  }
  return '';
}

export async function sendMessage(conversationHistory, userMessage, options = {}) {
  if (!process.env.OPENROUTER_API_KEY) {
    return {
      success: false,
      code: 'missing_credentials',
      error: 'OpenRouter is not configured. Set OPENROUTER_API_KEY on the server.'
    };
  }
  if (typeof userMessage !== 'string' || !userMessage.trim()) {
    return { success: false, code: 'invalid_message', error: 'Message cannot be empty.' };
  }

  const selectedModel = await validateOpenRouterModel(options.model || getDefaultModelId());
  if (!selectedModel.success) {
    return selectedModel;
  }

  const history = Array.isArray(conversationHistory) ? conversationHistory : [];
  const messages = history.slice(-20).map(message => ({
    role: message.role === 'user' ? 'user' : 'assistant',
    content: message.content
  }));
  messages.push({ role: 'user', content: userMessage.trim() });
  const requestedTimeout = Number(options.timeoutMs);
  const timeoutMs = Number.isFinite(requestedTimeout) && requestedTimeout > 0
    ? Math.min(requestedTimeout, REQUEST_TIMEOUT)
    : REQUEST_TIMEOUT;

  try {
    const { response, data } = await requestJson(
      `${OPENROUTER_BASE_URL}/chat/completions`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': process.env.OPENROUTER_HTTP_REFERER || 'http://localhost:3000',
          'X-Title': 'EMOVA AI'
        },
        body: JSON.stringify({
          model: selectedModel.model.id,
          messages,
          temperature: 0.7,
          top_p: 0.9,
          max_tokens: 2000
        }),
        signal: options.signal
      },
      timeoutMs
    );

    if (!response.ok) {
      return { success: false, ...getProviderError(response.status, data) };
    }

    const message = extractAssistantText(data);
    if (!message) {
      return {
        success: false,
        code: 'empty_response',
        error: 'OpenRouter returned no assistant text. Try again or choose another model.'
      };
    }

    const actualModel = typeof data.model === 'string' && data.model
      ? data.model
      : selectedModel.model.id;

    return {
      success: true,
      message,
      model: actualModel,
      requestedModel: selectedModel.model.id,
      modelName: actualModel === selectedModel.model.id
        ? selectedModel.model.name
        : actualModel
    };
  } catch (error) {
    if (options.signal?.aborted) {
      return { success: false, code: 'cancelled', error: 'Response generation was stopped.' };
    }
    if (error.name === 'AbortError') {
      return { success: false, code: 'timeout', error: 'The AI request timed out. Please try again.' };
    }
    return {
      success: false,
      code: 'provider_unavailable',
      error: 'Unable to connect to OpenRouter. Check your connection and try again.'
    };
  }
}

export function isOpenRouterConfigured() {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

export function getOpenRouterModel() {
  return getDefaultModelId();
}

export function getOpenRouterInfo() {
  return {
    apiKeySet: isOpenRouterConfigured(),
    model: getDefaultModelId(),
    baseUrl: OPENROUTER_BASE_URL
  };
}

export function clearOpenRouterModelCache() {
  cachedModels = null;
  modelCacheExpiresAt = 0;
}
