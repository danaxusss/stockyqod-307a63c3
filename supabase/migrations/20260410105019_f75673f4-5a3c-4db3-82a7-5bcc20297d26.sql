
-- 1. Create technical_sheets table
CREATE TABLE public.technical_sheets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  manufacturer TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  file_url TEXT NOT NULL DEFAULT '',
  file_size BIGINT NOT NULL DEFAULT 0,
  file_type TEXT NOT NULL DEFAULT 'application/pdf',
  view_count INTEGER NOT NULL DEFAULT 0,
  download_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.technical_sheets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow read technical_sheets" ON public.technical_sheets FOR SELECT USING (true);
CREATE POLICY "Allow insert technical_sheets" ON public.technical_sheets FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow update technical_sheets" ON public.technical_sheets FOR UPDATE USING (true);
CREATE POLICY "Allow delete technical_sheets" ON public.technical_sheets FOR DELETE USING (true);

CREATE TRIGGER update_technical_sheets_updated_at
  BEFORE UPDATE ON public.technical_sheets
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Create junction table for many-to-many product linking
CREATE TABLE public.technical_sheet_products (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sheet_id UUID NOT NULL REFERENCES public.technical_sheets(id) ON DELETE CASCADE,
  product_barcode TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(sheet_id, product_barcode)
);

ALTER TABLE public.technical_sheet_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow read technical_sheet_products" ON public.technical_sheet_products FOR SELECT USING (true);
CREATE POLICY "Allow insert technical_sheet_products" ON public.technical_sheet_products FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow update technical_sheet_products" ON public.technical_sheet_products FOR UPDATE USING (true);
CREATE POLICY "Allow delete technical_sheet_products" ON public.technical_sheet_products FOR DELETE USING (true);

-- Index for fast lookups by product barcode
CREATE INDEX idx_tsp_product_barcode ON public.technical_sheet_products(product_barcode);
CREATE INDEX idx_tsp_sheet_id ON public.technical_sheet_products(sheet_id);

-- 3. Create share links table
CREATE TABLE public.sheet_share_links (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  title TEXT,
  sheet_ids UUID[] NOT NULL DEFAULT '{}',
  expires_at TIMESTAMP WITH TIME ZONE,
  view_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.sheet_share_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow read sheet_share_links" ON public.sheet_share_links FOR SELECT USING (true);
CREATE POLICY "Allow insert sheet_share_links" ON public.sheet_share_links FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow update sheet_share_links" ON public.sheet_share_links FOR UPDATE USING (true);
CREATE POLICY "Allow delete sheet_share_links" ON public.sheet_share_links FOR DELETE USING (true);

CREATE INDEX idx_share_links_token ON public.sheet_share_links(token);

-- 4. Create new storage bucket for technical sheets
INSERT INTO storage.buckets (id, name, public)
VALUES ('technical-sheets', 'technical-sheets', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Public read technical-sheets"
ON storage.objects FOR SELECT
USING (bucket_id = 'technical-sheets');

CREATE POLICY "Public upload technical-sheets"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'technical-sheets');

CREATE POLICY "Public update technical-sheets"
ON storage.objects FOR UPDATE
USING (bucket_id = 'technical-sheets');

CREATE POLICY "Public delete technical-sheets"
ON storage.objects FOR DELETE
USING (bucket_id = 'technical-sheets');

-- 5. Migrate existing product techsheet URLs into the new system
INSERT INTO public.technical_sheets (id, title, file_url, manufacturer, category)
SELECT
  gen_random_uuid(),
  p.name,
  p.techsheet,
  p.brand,
  ''
FROM public.products p
WHERE p.techsheet IS NOT NULL AND p.techsheet != '';

-- Create junction entries for the migrated sheets
INSERT INTO public.technical_sheet_products (sheet_id, product_barcode)
SELECT ts.id, p.barcode
FROM public.technical_sheets ts
JOIN public.products p ON p.techsheet = ts.file_url AND p.name = ts.title
WHERE p.techsheet IS NOT NULL AND p.techsheet != '';
