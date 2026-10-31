const CLOUDFLARE_API_URL = 'https://api.cloudflare.com/client/v4';
const CLOUDFLARE_MODEL = '@cf/black-forest-labs/flux-1-schnell';
const REQUEST_TIMEOUT = 120000;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_JSON_RESPONSE_BYTES = Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 128 * 1024;

function getConfiguration() {
  const provider = (process.env.IMAGE_GENERATION_PROVIDER || 'cloudflare').trim().toLowerCase();
  const accountId = (process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
  const apiToken = (process.env.CLOUDFLARE_API_TOKEN || '').trim();
  const demoMode = provider === 'mock';

  return {
    provider,
    accountId,
    apiToken,
    demoMode,
    credentialsConfigured: provider === 'cloudflare' && Boolean(accountId && apiToken),
    configured: provider === 'cloudflare' && Boolean(accountId && apiToken)
  };
}

function failure(code, error) {
  return { success: false, code, error };
}

export function validateImageBytes(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) {
    return null;
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mimeType: 'image/jpeg', extension: 'jpg' };
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return { mimeType: 'image/png', extension: 'png' };
  }
  if (
    bytes.length >= 12 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return { mimeType: 'image/webp', extension: 'webp' };
  }
  return null;
}

async function readLimitedBody(response, limit) {
  if (!response.body) {
    return { bytes: Buffer.alloc(0), tooLarge: false };
  }

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > limit) {
        await reader.cancel();
        return { bytes: null, tooLarge: true };
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }

  return { bytes: Buffer.concat(chunks, totalBytes), tooLarge: false };
}

async function getCloudflareImage(response) {
  const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (contentType.startsWith('image/')) {
    const body = await readLimitedBody(response, MAX_IMAGE_BYTES);
    if (body.tooLarge) return failure('image_too_large', 'Cloudflare returned an image that exceeds the size limit.');
    const image = validateImageBytes(body.bytes);
    return image
      ? { success: true, imageBytes: body.bytes, ...image }
      : failure('invalid_image', 'Cloudflare returned empty or invalid image data.');
  }

  if (!contentType.includes('json')) {
    return failure('invalid_response', 'Cloudflare returned an unsupported image response.');
  }

  const body = await readLimitedBody(response, MAX_JSON_RESPONSE_BYTES);
  if (body.tooLarge) return failure('image_too_large', 'Cloudflare returned an image response that exceeds the size limit.');
  if (!body.bytes.length) return failure('invalid_response', 'Cloudflare returned an empty image response.');

  let payload;
  try {
    payload = JSON.parse(body.bytes.toString('utf8'));
  } catch {
    return failure('invalid_response', 'Cloudflare returned an invalid image response.');
  }

  if (payload?.success === false) {
    return failure('provider_error', 'Cloudflare Workers AI could not generate the requested image.');
  }

  const encodedImage = payload?.result?.image ?? payload?.image;
  if (
    typeof encodedImage !== 'string' ||
    !encodedImage.length ||
    encodedImage.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encodedImage)
  ) {
    return failure('invalid_image', 'Cloudflare did not return valid encoded image data.');
  }

  const imageBytes = Buffer.from(encodedImage, 'base64');
  const image = validateImageBytes(imageBytes);
  return image
    ? { success: true, imageBytes, ...image }
    : failure('invalid_image', 'Cloudflare returned empty or invalid image data.');
}

function getProviderFailure(status) {
  if (status === 401) {
    return failure('invalid_credentials', 'Cloudflare rejected the configured Workers AI credentials.');
  }
  if (status === 403) {
    return failure('permission_denied', 'The Cloudflare token lacks permission to run Workers AI models.');
  }
  if (status === 402) {
    return failure('usage_limited', 'Cloudflare Workers AI reported an account usage or billing limit.');
  }
  if (status === 429) {
    return failure('rate_limited', 'Cloudflare Workers AI rate limit reached. Try again later.');
  }
  if (status >= 500) {
    return failure('provider_unavailable', 'Cloudflare Workers AI is temporarily unavailable.');
  }
  return failure('provider_error', `Cloudflare Workers AI rejected the request (HTTP ${status}).`);
}

function generateDemoImage(prompt) {
  const escapedPrompt = prompt
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
    .slice(0, 100);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="768"><rect width="100%" height="100%" fill="#e5e7eb"/><text x="50%" y="48%" text-anchor="middle" font-family="sans-serif" font-size="28" fill="#374151">DEMO MODE</text><text x="50%" y="55%" text-anchor="middle" font-family="sans-serif" font-size="16" fill="#374151">${escapedPrompt}</text></svg>`;

  return {
    success: true,
    imageUrl: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
    provider: 'mock',
    model: 'demo-placeholder',
    prompt,
    generatedAt: new Date().toISOString(),
    demo: true
  };
}

async function generateWithCloudflare(prompt, configuration, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(
      `${CLOUDFLARE_API_URL}/accounts/${encodeURIComponent(configuration.accountId)}/ai/run/${CLOUDFLARE_MODEL}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${configuration.apiToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json, image/*'
        },
        body: JSON.stringify({ prompt }),
        signal: controller.signal
      }
    );

    if (!response.ok) {
      return getProviderFailure(response.status);
    }

    const image = await getCloudflareImage(response);
    if (!image.success) {
      return image;
    }

    return {
      success: true,
      imageBytes: image.imageBytes,
      imageMimeType: image.mimeType,
      imageExtension: image.extension,
      provider: 'cloudflare-workers-ai',
      model: CLOUDFLARE_MODEL,
      prompt,
      generatedAt: new Date().toISOString(),
      demo: false
    };
  } catch (error) {
    if (controller.signal.aborted || error.name === 'AbortError') {
      return failure('timeout', 'Cloudflare Workers AI image generation timed out.');
    }
    return failure('provider_unavailable', 'Unable to connect to Cloudflare Workers AI.');
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function generateImage(prompt, options = {}) {
  if (typeof prompt !== 'string' || !prompt.trim()) {
    return failure('invalid_prompt', 'Image prompt must be a non-empty string.');
  }
  if (prompt.length > 1000) {
    return failure('invalid_prompt', 'Image prompt too long (max 1000 characters).');
  }

  const configuration = getConfiguration();
  if (configuration.demoMode) {
    return generateDemoImage(prompt.trim());
  }
  if (configuration.provider !== 'cloudflare') {
    return failure('provider_not_supported', `Image provider "${configuration.provider}" is not supported.`);
  }
  if (!configuration.credentialsConfigured) {
    return failure(
      'missing_credentials',
      'Cloudflare Workers AI is not configured. Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN.'
    );
  }

  const requestedTimeout = Number(options.timeoutMs);
  const timeoutMs = Number.isFinite(requestedTimeout) && requestedTimeout > 0
    ? Math.min(requestedTimeout, REQUEST_TIMEOUT)
    : REQUEST_TIMEOUT;
  return generateWithCloudflare(prompt.trim(), configuration, timeoutMs);
}

export function getImageGenerationInfo() {
  const { provider, credentialsConfigured, configured, demoMode } = getConfiguration();
  return {
    provider,
    providerSelected: provider,
    model: provider === 'cloudflare' ? CLOUDFLARE_MODEL : null,
    credentialsConfigured,
    providerAvailability: 'unknown',
    demoMode,
    configured
  };
}

export function isImageGenerationConfigured() {
  return getImageGenerationInfo().configured;
}
