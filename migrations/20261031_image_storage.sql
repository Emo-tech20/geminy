-- Move new image bytes to a private Storage bucket without deleting legacy history.
ALTER TABLE public.generated_images
  ADD COLUMN IF NOT EXISTS storage_path TEXT,
  ADD COLUMN IF NOT EXISTS image_mime_type TEXT,
  ADD COLUMN IF NOT EXISTS image_size_bytes BIGINT;

ALTER TABLE public.generated_images
  ALTER COLUMN image_url DROP NOT NULL,
  ALTER COLUMN provider SET DEFAULT 'cloudflare-workers-ai',
  ALTER COLUMN model SET DEFAULT '@cf/black-forest-labs/flux-1-schnell';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'generated_images_storage_or_legacy_url'
      AND conrelid = 'public.generated_images'::regclass
  ) THEN
    ALTER TABLE public.generated_images
      ADD CONSTRAINT generated_images_storage_or_legacy_url
      CHECK (storage_path IS NOT NULL OR image_url IS NOT NULL) NOT VALID;
  END IF;
END;
$$;

ALTER TABLE public.generated_images
  VALIDATE CONSTRAINT generated_images_storage_or_legacy_url;

GRANT UPDATE ON public.generated_images TO authenticated;

DROP POLICY IF EXISTS "Users can update their generated images" ON public.generated_images;
CREATE POLICY "Users can update their generated images"
  ON public.generated_images FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'generated-images',
  'generated-images',
  FALSE,
  20971520,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET public = FALSE,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Users can view their generated image files" ON storage.objects;
CREATE POLICY "Users can view their generated image files"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'generated-images'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::TEXT
  );

DROP POLICY IF EXISTS "Users can upload their generated image files" ON storage.objects;
CREATE POLICY "Users can upload their generated image files"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'generated-images'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::TEXT
  );

DROP POLICY IF EXISTS "Users can delete their generated image files" ON storage.objects;
CREATE POLICY "Users can delete their generated image files"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'generated-images'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::TEXT
  );
