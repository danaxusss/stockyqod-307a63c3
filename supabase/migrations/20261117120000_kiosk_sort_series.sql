-- Kiosk: sort options and product series.
-- 1. products.series: a product line inside a brand (e.g. 600, 700, 900),
--    set in Stocky on the product page or in bulk on the products list.
-- 2. kiosk_product_search: optional p_series filter and p_sort
--    ('relevance', 'price_asc', 'price_desc', 'name', 'available', 'newest');
--    price sorts are ignored by kiosks that hide prices.
-- 3. kiosk_product_brand_series: the series each brand has on a kiosk.
-- Run in the Supabase SQL editor, then redeploy the "kiosk" edge function.

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS series text;

CREATE INDEX IF NOT EXISTS idx_products_brand_series
  ON public.products(brand, series)
  WHERE series IS NOT NULL;

-- The signature changes: drop the previous version so calls without the new
-- parameters cannot be ambiguous.
DROP FUNCTION IF EXISTS public.kiosk_product_search(uuid, text, text, text, boolean, integer, integer, boolean, uuid);

CREATE OR REPLACE FUNCTION public.kiosk_product_search(
  p_profile_id uuid,
  p_search text DEFAULT '',
  p_category text DEFAULT NULL,
  p_brand text DEFAULT NULL,
  p_only_available boolean DEFAULT false,
  p_offset integer DEFAULT 0,
  p_limit integer DEFAULT 48,
  p_featured_only boolean DEFAULT false,
  p_sector uuid DEFAULT NULL,
  p_series text DEFAULT NULL,
  p_sort text DEFAULT 'relevance'
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
  v_series text := nullif(btrim(coalesce(p_series, '')), '');
  v_sort text := coalesce(nullif(btrim(p_sort), ''), 'relevance');
BEGIN
  SELECT * INTO v_profile
  FROM public.kiosk_profiles
  WHERE id = p_profile_id AND enabled;
  IF NOT FOUND THEN RAISE EXCEPTION 'Kiosk unavailable'; END IF;

  IF v_category IS NOT NULL
    AND v_category NOT IN ('utensils', 'furniture', 'equipment', 'decoration', 'raw_materials') THEN
    RAISE EXCEPTION 'Invalid kiosk category';
  END IF;

  IF v_sort NOT IN ('relevance', 'price_asc', 'price_desc', 'name', 'available', 'newest') THEN
    v_sort := 'relevance';
  END IF;
  -- Sorting by price would reveal the order of prices a kiosk does not show.
  IF v_sort IN ('price_asc', 'price_desc') AND NOT v_profile.show_prices THEN
    v_sort := 'relevance';
  END IF;

  RETURN QUERY
  WITH eligible AS (
    SELECT
      p.barcode,
      p.name,
      p.brand,
      p.image,
      p.kiosk_category,
      p.created_at,
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
      AND (v_series IS NULL OR btrim(p.series) = v_series)
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
    -- The chosen sort first; the usual order then breaks ties.
    CASE WHEN v_sort = 'price_asc' THEN e.internal_price END ASC NULLS LAST,
    CASE WHEN v_sort = 'price_desc' THEN e.internal_price END DESC NULLS LAST,
    CASE WHEN v_sort = 'name' THEN lower(e.name) END ASC,
    CASE WHEN v_sort = 'available' THEN e.available END DESC,
    CASE WHEN v_sort = 'newest' THEN e.created_at END DESC NULLS LAST,
    e.featured_order NULLS LAST,
    e.kiosk_category NULLS LAST,
    e.brand,
    e.name,
    e.barcode
  OFFSET v_offset LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.kiosk_product_search(uuid, text, text, text, boolean, integer, integer, boolean, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kiosk_product_search(uuid, text, text, text, boolean, integer, integer, boolean, uuid, text, text)
  TO service_role;

-- Series offered under each brand: only series with a product this kiosk can show.
CREATE OR REPLACE FUNCTION public.kiosk_product_brand_series(p_profile_id uuid)
RETURNS TABLE(brand text, series text)
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
  SELECT DISTINCT p.brand, btrim(p.series)
  FROM public.products p
  LEFT JOIN LATERAL (
    SELECT coalesce(sum(
      CASE WHEN e.value ~ '^-?[0-9]+([.][0-9]+)?$' THEN e.value::numeric ELSE 0 END
    ), 0) AS total_stock
    FROM jsonb_each_text(coalesce(p.stock_levels, '{}'::jsonb)) e
  ) stock ON true
  WHERE btrim(coalesce(p.series, '')) <> ''
    AND btrim(coalesce(p.brand, '')) <> ''
    AND (coalesce(cardinality(v_profile.visible_brands), 0) = 0 OR p.brand = ANY(v_profile.visible_brands))
    AND (v_profile.show_out_of_stock OR stock.total_stock > 0)
  ORDER BY 1, 2;
END;
$$;

REVOKE ALL ON FUNCTION public.kiosk_product_brand_series(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kiosk_product_brand_series(uuid) TO service_role;
