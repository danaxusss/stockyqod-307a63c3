-- Kiosk showcase ("vitrine"): an attract loop of the company's products and
-- services shown while the kiosk is idle, with a call to action into the
-- catalogue, plus a Google review page with a QR code.

ALTER TABLE public.kiosk_profiles
  ADD COLUMN IF NOT EXISTS showcase_enabled boolean NOT NULL DEFAULT false,
  -- Seconds of inactivity on the welcome screen before the showcase starts.
  ADD COLUMN IF NOT EXISTS showcase_idle_seconds integer NOT NULL DEFAULT 45,
  -- Seconds each slide stays on screen.
  ADD COLUMN IF NOT EXISTS showcase_slide_seconds integer NOT NULL DEFAULT 8,
  -- Include the built-in Cuisimat Groupe presentation (videos and photos shipped with the app).
  ADD COLUMN IF NOT EXISTS showcase_builtin boolean NOT NULL DEFAULT true,
  -- Extra slides: [{ id, media_url, media_type: 'image' | 'video', kicker, title, text }].
  ADD COLUMN IF NOT EXISTS showcase_slides jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Google "leave a review" link shown as a QR code; no review page without it.
  ADD COLUMN IF NOT EXISTS google_review_url text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.kiosk_profiles'::regclass
      AND conname = 'kiosk_profiles_showcase_idle_seconds_check'
  ) THEN
    ALTER TABLE public.kiosk_profiles
      ADD CONSTRAINT kiosk_profiles_showcase_idle_seconds_check
      CHECK (showcase_idle_seconds BETWEEN 10 AND 600);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.kiosk_profiles'::regclass
      AND conname = 'kiosk_profiles_showcase_slide_seconds_check'
  ) THEN
    ALTER TABLE public.kiosk_profiles
      ADD CONSTRAINT kiosk_profiles_showcase_slide_seconds_check
      CHECK (showcase_slide_seconds BETWEEN 4 AND 30);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.kiosk_profiles'::regclass
      AND conname = 'kiosk_profiles_showcase_slides_check'
  ) THEN
    ALTER TABLE public.kiosk_profiles
      ADD CONSTRAINT kiosk_profiles_showcase_slides_check
      CHECK (jsonb_typeof(showcase_slides) = 'array' AND jsonb_array_length(showcase_slides) <= 20);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.kiosk_profiles'::regclass
      AND conname = 'kiosk_profiles_google_review_url_check'
  ) THEN
    ALTER TABLE public.kiosk_profiles
      ADD CONSTRAINT kiosk_profiles_google_review_url_check
      CHECK (google_review_url IS NULL OR (google_review_url ~ '^https://' AND length(google_review_url) <= 500));
  END IF;
END;
$$;
