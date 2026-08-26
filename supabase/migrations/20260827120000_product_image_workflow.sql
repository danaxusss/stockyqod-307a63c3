-- Product primary-image workflow used by Stocky, catalogue generation and quotes.
-- This makes the gallery setup deployable through migration history instead of
-- relying on the legacy one-off supabase/patch.sql file.

CREATE TABLE IF NOT EXISTS public.product_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT '',
  storage_path text NOT NULL,
  file_name text NOT NULL,
  file_size integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text
);

CREATE TABLE IF NOT EXISTS public.product_photo_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  photo_id uuid NOT NULL REFERENCES public.product_photos(id) ON DELETE CASCADE,
  barcode text NOT NULL,
  product_name text NOT NULL DEFAULT '',
  UNIQUE(photo_id, barcode)
);

CREATE INDEX IF NOT EXISTS idx_product_photos_storage_path
  ON public.product_photos(storage_path);
CREATE INDEX IF NOT EXISTS idx_product_photo_products_barcode
  ON public.product_photo_products(barcode);

ALTER TABLE public.product_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_photo_products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "product_photos_all" ON public.product_photos;
CREATE POLICY "product_photos_all"
  ON public.product_photos FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "product_photo_products_all" ON public.product_photo_products;
CREATE POLICY "product_photo_products_all"
  ON public.product_photo_products FOR ALL USING (true) WITH CHECK (true);

INSERT INTO storage.buckets (id, name, public)
VALUES ('product-photos', 'product-photos', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "photos_upload" ON storage.objects;
DROP POLICY IF EXISTS "photos_read" ON storage.objects;
DROP POLICY IF EXISTS "photos_update" ON storage.objects;
DROP POLICY IF EXISTS "photos_delete" ON storage.objects;

CREATE POLICY "photos_upload" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'product-photos');
CREATE POLICY "photos_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'product-photos');
CREATE POLICY "photos_update" ON storage.objects
  FOR UPDATE USING (bucket_id = 'product-photos') WITH CHECK (bucket_id = 'product-photos');
CREATE POLICY "photos_delete" ON storage.objects
  FOR DELETE USING (bucket_id = 'product-photos');
