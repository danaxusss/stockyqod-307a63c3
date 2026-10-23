-- Business sectors (restaurant, café, hôtel…) as a second way to browse
-- products, in Stocky and on the kiosk. A product can belong to several
-- sectors; the list itself is managed from the product list.

CREATE TABLE IF NOT EXISTS public.business_sectors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  -- Optional kiosk translations; the French name is used when empty.
  name_en text,
  name_ar text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS business_sectors_name_key
  ON public.business_sectors (lower(btrim(name)));

-- Same access model as public.products: the app talks to the database with
-- the anon key and enforces roles in the UI.
ALTER TABLE public.business_sectors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow read business sectors" ON public.business_sectors;
CREATE POLICY "Allow read business sectors" ON public.business_sectors FOR SELECT USING (true);
DROP POLICY IF EXISTS "Allow insert business sectors" ON public.business_sectors;
CREATE POLICY "Allow insert business sectors" ON public.business_sectors FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS "Allow update business sectors" ON public.business_sectors;
CREATE POLICY "Allow update business sectors" ON public.business_sectors FOR UPDATE USING (true);

INSERT INTO public.business_sectors (name, name_en, name_ar, sort_order) VALUES
  ('Restaurant', 'Restaurant', 'مطعم', 10),
  ('Café', 'Café', 'مقهى', 20),
  ('Hôtel', 'Hotel', 'فندق', 30),
  ('Pâtisserie', 'Pastry shop', 'حلويات', 40),
  ('Boucherie', 'Butcher shop', 'جزارة', 50)
ON CONFLICT DO NOTHING;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS sector_ids uuid[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_products_sector_ids
  ON public.products USING gin (sector_ids);

-- Deleting a sector also removes it from every product, in one transaction.
CREATE OR REPLACE FUNCTION public.delete_business_sector(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.products
  SET sector_ids = array_remove(sector_ids, p_id)
  WHERE p_id = ANY(sector_ids);
  DELETE FROM public.business_sectors WHERE id = p_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_business_sector(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_business_sector(uuid) TO anon, authenticated, service_role;

-- Kiosk catalogue: add the sector filter. The signature changes, so the
-- earlier versions are dropped (an overload left behind would make calls
-- without p_sector ambiguous); CREATE OR REPLACE keeps a re-run safe.
DROP FUNCTION IF EXISTS public.kiosk_product_search(uuid, text, text, text, boolean, integer, integer);
DROP FUNCTION IF EXISTS public.kiosk_product_search(uuid, text, text, text, boolean, integer, integer, boolean);

CREATE OR REPLACE FUNCTION public.kiosk_product_search(
  p_profile_id uuid,
  p_search text DEFAULT '',
  p_category text DEFAULT NULL,
  p_brand text DEFAULT NULL,
  p_only_available boolean DEFAULT false,
  p_offset integer DEFAULT 0,
  p_limit integer DEFAULT 48,
  p_featured_only boolean DEFAULT false,
  p_sector uuid DEFAULT NULL
)
RETURNS TABLE(
  barcode text,
  name text,
  brand text,
  image text,
  kiosk_category text,
  display_price numeric,
  available boolean,
  featured boolean,
  total_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile public.kiosk_profiles%ROWTYPE;
  v_search text := btrim(coalesce(p_search, ''));
  v_category text := nullif(btrim(coalesce(p_category, '')), '');
  v_brand text := nullif(btrim(coalesce(p_brand, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 48), 1), 72);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
BEGIN
  SELECT * INTO v_profile
  FROM public.kiosk_profiles
  WHERE id = p_profile_id AND enabled;
  IF NOT FOUND THEN RAISE EXCEPTION 'Kiosk unavailable'; END IF;

  IF v_category IS NOT NULL
    AND v_category NOT IN ('utensils', 'furniture', 'equipment') THEN
    RAISE EXCEPTION 'Invalid kiosk category';
  END IF;

  RETURN QUERY
  WITH eligible AS (
    SELECT
      p.barcode,
      p.name,
      p.brand,
      p.image,
      p.kiosk_category,
      CASE v_profile.price_mode WHEN 'reseller' THEN p.reseller_price ELSE p.price END AS internal_price,
      stock.total_stock > 0 AS available,
      array_position(v_profile.featured_barcodes, p.barcode) AS featured_order
    FROM public.products p
    LEFT JOIN LATERAL (
      SELECT coalesce(sum(
        CASE WHEN e.value ~ '^-?[0-9]+([.][0-9]+)?$' THEN e.value::numeric ELSE 0 END
      ), 0) AS total_stock
      FROM jsonb_each_text(coalesce(p.stock_levels, '{}'::jsonb)) e
    ) stock ON true
    WHERE (coalesce(cardinality(v_profile.visible_brands), 0) = 0 OR p.brand = ANY(v_profile.visible_brands))
      AND (v_brand IS NULL OR p.brand = v_brand)
      AND (v_category IS NULL OR p.kiosk_category = v_category)
      AND (p_sector IS NULL OR p_sector = ANY(p.sector_ids))
      AND (v_profile.show_out_of_stock OR stock.total_stock > 0)
      AND (NOT coalesce(p_only_available, false) OR stock.total_stock > 0)
      AND (NOT coalesce(p_featured_only, false) OR p.barcode = ANY(v_profile.featured_barcodes))
      AND (
        v_search = '' OR
        p.barcode ILIKE '%' || v_search || '%' OR
        p.name ILIKE '%' || v_search || '%' OR
        p.brand ILIKE '%' || v_search || '%'
      )
  )
  SELECT
    e.barcode,
    e.name,
    e.brand,
    e.image,
    e.kiosk_category,
    CASE WHEN v_profile.show_prices THEN e.internal_price ELSE NULL END,
    e.available,
    e.featured_order IS NOT NULL,
    count(*) OVER ()
  FROM eligible e
  ORDER BY
    e.featured_order NULLS LAST,
    e.kiosk_category NULLS LAST,
    e.brand,
    e.name,
    e.barcode
  OFFSET v_offset LIMIT v_limit;
END;
$$;

-- Sectors offered as kiosk filters: only those with at least one product the
-- kiosk can show.
CREATE OR REPLACE FUNCTION public.kiosk_product_sectors(p_profile_id uuid)
RETURNS TABLE(id uuid, name text, name_en text, name_ar text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile public.kiosk_profiles%ROWTYPE;
BEGIN
  SELECT * INTO v_profile
  FROM public.kiosk_profiles
  WHERE kiosk_profiles.id = p_profile_id AND enabled;
  IF NOT FOUND THEN RAISE EXCEPTION 'Kiosk unavailable'; END IF;

  RETURN QUERY
  SELECT s.id, s.name, s.name_en, s.name_ar
  FROM public.business_sectors s
  WHERE EXISTS (
    SELECT 1
    FROM public.products p
    LEFT JOIN LATERAL (
      SELECT coalesce(sum(
        CASE WHEN e.value ~ '^-?[0-9]+([.][0-9]+)?$' THEN e.value::numeric ELSE 0 END
      ), 0) AS total_stock
      FROM jsonb_each_text(coalesce(p.stock_levels, '{}'::jsonb)) e
    ) stock ON true
    WHERE s.id = ANY(p.sector_ids)
      AND (coalesce(cardinality(v_profile.visible_brands), 0) = 0 OR p.brand = ANY(v_profile.visible_brands))
      AND (v_profile.show_out_of_stock OR stock.total_stock > 0)
  )
  ORDER BY s.sort_order, s.name;
END;
$$;

REVOKE ALL ON FUNCTION public.kiosk_product_search(uuid, text, text, text, boolean, integer, integer, boolean, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kiosk_product_search(uuid, text, text, text, boolean, integer, integer, boolean, uuid)
  TO service_role;

REVOKE ALL ON FUNCTION public.kiosk_product_sectors(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kiosk_product_sectors(uuid) TO service_role;
