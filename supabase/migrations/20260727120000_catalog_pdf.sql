-- ============================================================================
-- Catalogue PDF (integration of the standalone catalogue-pm tool)
-- Families + catalogue metadata on products. Products are global (PK barcode),
-- so catalog_families is global too.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.catalog_families (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS catalog_family_id UUID REFERENCES public.catalog_families(id) ON DELETE SET NULL;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS catalog_sort INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS catalog_hidden BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS catalog_image TEXT;  -- storage path in product-photos bucket

CREATE INDEX IF NOT EXISTS idx_products_catalog_family ON public.products(catalog_family_id);

ALTER TABLE public.catalog_families ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all catalog_families" ON public.catalog_families FOR ALL USING (true) WITH CHECK (true);

CREATE TRIGGER update_catalog_families_updated_at BEFORE UPDATE ON public.catalog_families
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
