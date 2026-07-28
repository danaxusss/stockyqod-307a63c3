-- ============================================================================
-- Catalogue (v2) — standalone product list, INDEPENDENT from Stocky products.
--
-- Replaces the first integration, which hung catalogue metadata off the shared
-- public.products table. The catalogue now owns its own products so prices and
-- designations can evolve without touching Stocky's inventory/quotes data.
-- ============================================================================

-- ── 1. Undo the previous (coupled) integration ──────────────────────────────
ALTER TABLE public.products DROP COLUMN IF EXISTS catalog_family_id;
ALTER TABLE public.products DROP COLUMN IF EXISTS catalog_sort;
ALTER TABLE public.products DROP COLUMN IF EXISTS catalog_hidden;
ALTER TABLE public.products DROP COLUMN IF EXISTS catalog_image;
DROP INDEX IF EXISTS public.idx_products_catalog_family;
DROP TABLE IF EXISTS public.catalog_families CASCADE;

-- ── 2. Catalogue families (per company) ─────────────────────────────────────
CREATE TABLE public.catalog_families (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);

-- ── 3. Catalogue products — the catalogue's OWN list ────────────────────────
CREATE TABLE public.catalog_products (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  family_id UUID REFERENCES public.catalog_families(id) ON DELETE SET NULL,
  ref TEXT NOT NULL,
  designation TEXT NOT NULL DEFAULT '',
  price NUMERIC,                                  -- Prix TTC
  price_pro NUMERIC,                              -- Prix Pro (fallback: price)
  image TEXT,                                     -- bundled filename OR storage path
  hidden BOOLEAN NOT NULL DEFAULT false,          -- excluded from the PDF
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, ref)
);

CREATE INDEX idx_catalog_products_company ON public.catalog_products(company_id);
CREATE INDEX idx_catalog_products_family ON public.catalog_products(family_id);
CREATE INDEX idx_catalog_products_ref ON public.catalog_products(company_id, ref);

-- ── 4. RLS (permissive; app scopes by company_id, mirrors the rest of Stocky) ─
ALTER TABLE public.catalog_families ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all catalog_families" ON public.catalog_families FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all catalog_products" ON public.catalog_products FOR ALL USING (true) WITH CHECK (true);

CREATE TRIGGER update_catalog_families_updated_at BEFORE UPDATE ON public.catalog_families
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_catalog_products_updated_at BEFORE UPDATE ON public.catalog_products
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
