import { randomUUID } from 'node:crypto';
import express from 'express';
import {
  generateImage,
  getImageGenerationInfo,
  validateImageBytes
} from '../services/imageGenerationService.js';

const router = express.Router();
const STORAGE_BUCKET = 'generated-images';
const SIGNED_URL_TTL_SECONDS = 60 * 60;

const generationStatusCodes = {
  missing_credentials: 503,
  provider_not_supported: 503,
  provider_unavailable: 503,
  invalid_credentials: 502,
  permission_denied: 502,
  usage_limited: 402,
  rate_limited: 429,
  timeout: 504,
  invalid_prompt: 400,
  invalid_image: 502,
  image_too_large: 502,
  invalid_response: 502
};

function getStorageClient(req) {
  return req.app.locals.supabaseAdmin || req.app.locals.supabaseStorage;
}

function getImagePath(userId, extension) {
  return `${userId}/${randomUUID()}.${extension}`;
}

async function uploadImage(storageClient, userId, bytes, mimeType, extension) {
  const imagePath = getImagePath(userId, extension);
  const { error } = await storageClient.storage
    .from(STORAGE_BUCKET)
    .upload(imagePath, bytes, {
      contentType: mimeType,
      cacheControl: '3600',
      upsert: false
    });

  if (error) {
    throw new Error('Storage upload failed.');
  }
  return imagePath;
}

async function removeStoredImage(storageClient, imagePath) {
  const { error } = await storageClient.storage.from(STORAGE_BUCKET).remove([imagePath]);
  if (error) throw new Error('Storage cleanup failed.');
}

async function createSignedImageUrl(storageClient, imagePath) {
  const { data, error } = await storageClient.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(imagePath, SIGNED_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) {
    throw new Error('Could not create an image URL.');
  }
  return data.signedUrl;
}

function decodeLegacyDataUri(imageUrl) {
  if (typeof imageUrl !== 'string') return null;
  const match = imageUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match) return null;
  const bytes = Buffer.from(match[2], 'base64');
  const image = validateImageBytes(bytes);
  if (!image || image.mimeType !== match[1]) return null;
  return { bytes, ...image };
}

function getLegacyRemoteUrl(imageUrl) {
  if (typeof imageUrl !== 'string' || imageUrl.startsWith('data:')) return null;
  try {
    const url = new URL(imageUrl);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

async function resolveHistoryImage(storageClient, supabase, image, userId) {
  if (image.storage_path) {
    if (!image.storage_path.startsWith(`${userId}/`)) {
      return { imageUrl: null, imageUnavailable: true, imageMimeType: image.image_mime_type || null };
    }
    return {
      imageUrl: await createSignedImageUrl(storageClient, image.storage_path),
      imageUnavailable: false,
      imageMimeType: image.image_mime_type || null
    };
  }

  const { data: legacyRecord, error: legacyFetchError } = await supabase
    .from('generated_images')
    .select('image_url')
    .eq('id', image.id)
    .eq('user_id', userId)
    .single();
  if (legacyFetchError || !legacyRecord) {
    return { imageUrl: null, imageUnavailable: true, imageMimeType: null };
  }

  const legacyImage = decodeLegacyDataUri(legacyRecord.image_url);
  if (legacyImage) {
    let uploadedPath;
    try {
      uploadedPath = await uploadImage(
        storageClient,
        userId,
        legacyImage.bytes,
        legacyImage.mimeType,
        legacyImage.extension
      );
      const { error } = await supabase
        .from('generated_images')
        .update({
          storage_path: uploadedPath,
          image_url: null,
          image_mime_type: legacyImage.mimeType,
          image_size_bytes: legacyImage.bytes.length
        })
        .eq('id', image.id)
        .eq('user_id', userId);

      if (error) throw new Error('Legacy history update failed.');
      return {
        imageUrl: await createSignedImageUrl(storageClient, uploadedPath),
        imageUnavailable: false,
        imageMimeType: legacyImage.mimeType
      };
    } catch {
      if (uploadedPath) {
        try {
          await removeStoredImage(storageClient, uploadedPath);
        } catch {
          console.error('[Images] Legacy image cleanup failed.');
        }
      }
      console.error('[Images] A legacy image could not be moved to private storage.');
      return { imageUrl: null, imageUnavailable: true, imageMimeType: null };
    }
  }

  const remoteUrl = getLegacyRemoteUrl(legacyRecord.image_url);
  return {
    imageUrl: remoteUrl,
    imageUnavailable: !remoteUrl,
    imageMimeType: null
  };
}

/**
 * Generate an image from a prompt
 * POST /api/images/generate
 */
router.post('/generate', async (req, res) => {
  let uploadedPath;
  let storageClient;

  try {
    const { prompt } = req.body || {};
    const supabase = req.app.locals.supabaseAdmin || req.app.locals.supabase;
    storageClient = getStorageClient(req);
    const userId = req.user.id;

    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'Image prompt is required' });
    }

    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      return res.status(400).json({ error: 'Image prompt cannot be empty' });
    }
    if (trimmedPrompt.length > 1000) {
      return res.status(400).json({ error: 'Image prompt too long (max 1000 characters)' });
    }

    const status = getImageGenerationInfo();
    if (!status.demoMode && status.configured && (!supabase || !storageClient)) {
      return res.status(503).json({
        success: false,
        error: 'Image storage is not configured; generation was not started.'
      });
    }

    const generationResult = await generateImage(trimmedPrompt);
    if (!generationResult.success) {
      return res.status(generationStatusCodes[generationResult.code] || 502).json({
        success: false,
        error: generationResult.error,
        code: generationResult.code
      });
    }

    if (generationResult.demo) {
      return res.json({
        success: true,
        demoMode: true,
        saved: false,
        imageUrl: generationResult.imageUrl,
        prompt: trimmedPrompt,
        provider: generationResult.provider,
        model: generationResult.model,
        generatedAt: generationResult.generatedAt
      });
    }

    if (!supabase || !storageClient) {
      return res.status(503).json({
        success: false,
        error: 'Image storage is not configured; the generated image was not saved.',
        generated: true,
        saved: false
      });
    }

    uploadedPath = await uploadImage(
      storageClient,
      userId,
      generationResult.imageBytes,
      generationResult.imageMimeType,
      generationResult.imageExtension
    );
    const imageUrl = await createSignedImageUrl(storageClient, uploadedPath);

    const { data: savedImage, error: dbError } = await supabase
      .from('generated_images')
      .insert({
        user_id: userId,
        prompt: trimmedPrompt,
        image_url: null,
        storage_path: uploadedPath,
        image_mime_type: generationResult.imageMimeType,
        image_size_bytes: generationResult.imageBytes.length,
        provider: generationResult.provider,
        model: generationResult.model,
        created_at: generationResult.generatedAt
      })
      .select('id')
      .single();

    if (dbError) {
      console.error('[Images] Failed to save generated image metadata.');
      await removeStoredImage(storageClient, uploadedPath);
      uploadedPath = null;
      return res.status(500).json({
        success: false,
        error: 'Image generated, but it could not be saved to your history.',
        generated: true,
        saved: false
      });
    }

    res.json({
      success: true,
      demoMode: false,
      saved: true,
      imageId: savedImage.id,
      imageUrl,
      prompt: trimmedPrompt,
      provider: generationResult.provider,
      model: generationResult.model,
      generatedAt: generationResult.generatedAt
    });
  } catch (error) {
    if (uploadedPath && storageClient) {
      try {
        await removeStoredImage(storageClient, uploadedPath);
      } catch {
        console.error('[Images] Failed to clean up an incomplete image upload.');
      }
    }
    console.error('[Images] Image generation or persistence failed.');
    res.status(500).json({
      success: false,
      error: uploadedPath
        ? 'Image generated, but it could not be saved to your history.'
        : 'Failed to generate or store image.'
    });
  }
});

/**
 * Get image generation history for the authenticated user
 * GET /api/images/history
 */
router.get('/history', async (req, res) => {
  try {
    const supabase = req.app.locals.supabaseAdmin || req.app.locals.supabase;
    const storageClient = getStorageClient(req);
    const userId = req.user.id;

    if (!supabase || !storageClient) {
      return res.status(503).json({ error: 'Image storage service is not configured' });
    }

    const { data: images, error: dbError } = await supabase
      .from('generated_images')
      .select('id,prompt,storage_path,image_mime_type,provider,model,created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (dbError) {
      console.error('[Images] History fetch failed.');
      return res.status(500).json({ error: 'Failed to fetch image history' });
    }

    const history = [];
    for (const image of images || []) {
      try {
        const resolved = await resolveHistoryImage(storageClient, supabase, image, userId);
        history.push({
          id: image.id,
          prompt: image.prompt,
          imageUrl: resolved.imageUrl,
          imageUnavailable: resolved.imageUnavailable,
          imageMimeType: resolved.imageMimeType,
          provider: image.provider,
          model: image.model,
          created_at: image.created_at
        });
      } catch {
        console.error('[Images] Failed to create a signed history URL.');
        return res.status(500).json({ error: 'Failed to fetch image history' });
      }
    }

    res.json({ success: true, images: history, count: history.length });
  } catch {
    res.status(500).json({ error: 'Failed to fetch image history' });
  }
});

router.get('/:imageId/download', async (req, res) => {
  try {
    const supabase = req.app.locals.supabaseAdmin || req.app.locals.supabase;
    const storageClient = getStorageClient(req);
    const userId = req.user.id;

    if (!supabase || !storageClient) {
      return res.status(503).json({ error: 'Image storage service is not configured' });
    }

    const { data: image, error } = await supabase
      .from('generated_images')
      .select('id,user_id,storage_path,image_mime_type')
      .eq('id', req.params.imageId)
      .eq('user_id', userId)
      .single();
    if (error || !image || image.user_id !== userId) {
      return res.status(404).json({ error: 'Image not found' });
    }
    if (!image.storage_path || !image.storage_path.startsWith(`${userId}/`)) {
      return res.status(404).json({ error: 'Stored image not found' });
    }

    const { data: file, error: downloadError } = await storageClient.storage
      .from(STORAGE_BUCKET)
      .download(image.storage_path);
    if (downloadError || !file) {
      return res.status(404).json({ error: 'Stored image not found' });
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const verifiedImage = validateImageBytes(bytes);
    if (!verifiedImage || verifiedImage.mimeType !== image.image_mime_type) {
      return res.status(502).json({ error: 'Stored image data is invalid' });
    }

    res.set({
      'Content-Type': verifiedImage.mimeType,
      'Content-Length': String(bytes.length),
      'Content-Disposition': `attachment; filename="generated-${image.id}.${verifiedImage.extension}`,
      'Cache-Control': 'private, no-store'
    });
    res.send(bytes);
  } catch {
    res.status(500).json({ error: 'Failed to download image' });
  }
});

/**
 * Delete a generated image and its stored object
 * DELETE /api/images/:imageId
 */
router.delete('/:imageId', async (req, res) => {
  try {
    const { imageId } = req.params;
    const supabase = req.app.locals.supabaseAdmin || req.app.locals.supabase;
    const storageClient = getStorageClient(req);
    const userId = req.user.id;

    if (!supabase || !storageClient) {
      return res.status(503).json({ error: 'Image storage service is not configured' });
    }

    const { data: image, error: fetchError } = await supabase
      .from('generated_images')
      .select('id,user_id,storage_path')
      .eq('id', imageId)
      .eq('user_id', userId)
      .single();

    if (fetchError || !image || image.user_id !== userId) {
      return res.status(404).json({ error: 'Image not found' });
    }
    if (image.storage_path && !image.storage_path.startsWith(`${userId}/`)) {
      console.error('[Images] Refused to delete an image outside the owner storage path.');
      return res.status(500).json({ error: 'Image storage path is invalid' });
    }

    if (image.storage_path) {
      try {
        await removeStoredImage(storageClient, image.storage_path);
      } catch {
        console.error('[Images] Storage deletion failed; history entry was preserved.');
        return res.status(500).json({ error: 'Could not remove the stored image; history entry was preserved.' });
      }
    }

    const { error: deleteError } = await supabase
      .from('generated_images')
      .delete()
      .eq('id', imageId)
      .eq('user_id', userId);

    if (deleteError) {
      console.error('[Images] Image history deletion failed after storage removal.');
      return res.status(500).json({
        success: false,
        error: 'Stored image was removed, but the history entry could not be deleted.'
      });
    }

    res.json({ success: true, message: 'Image deleted' });
  } catch {
    res.status(500).json({ error: 'Failed to delete image' });
  }
});

/**
 * Get image generation service status
 * GET /api/images/status
 */
router.get('/status', (req, res) => {
  const status = getImageGenerationInfo();
  res.json({
    success: true,
    ...status,
    message: status.demoMode
      ? 'Image generation is running in explicit demo mode.'
      : status.configured
        ? 'Cloudflare Workers AI credentials are configured; provider availability has not been checked.'
        : 'Cloudflare Workers AI credentials are not configured.'
  });
});

export default router;
