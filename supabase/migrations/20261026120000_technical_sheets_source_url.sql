-- Technical sheets found on the web keep the address they were downloaded
-- from, so linking the same document to another product reuses the stored
-- copy instead of uploading it again.

ALTER TABLE public.technical_sheets
  ADD COLUMN IF NOT EXISTS source_url text;

CREATE INDEX IF NOT EXISTS idx_technical_sheets_source_url
  ON public.technical_sheets (source_url)
  WHERE source_url IS NOT NULL;
