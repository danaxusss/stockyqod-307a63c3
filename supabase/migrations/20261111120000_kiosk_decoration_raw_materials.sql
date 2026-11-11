-- Two more kiosk product types: Décoration (vases, flower pots, planters,
-- parasols…) and Matière première (ingredients; coffee to follow).
-- Run in the Supabase SQL editor, then redeploy the "kiosk" edge function
-- (it filters on the same list).

ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_kiosk_category_check;
ALTER TABLE public.products
  ADD CONSTRAINT products_kiosk_category_check
  CHECK (kiosk_category IS NULL OR kiosk_category IN ('utensils', 'furniture', 'equipment', 'decoration', 'raw_materials'));

-- Same function as 20261024120000_business_sectors.sql, with the wider list.
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
    AND v_category NOT IN ('utensils', 'furniture', 'equipment', 'decoration', 'raw_materials') THEN
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

REVOKE ALL ON FUNCTION public.kiosk_product_search(uuid, text, text, text, boolean, integer, integer, boolean, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kiosk_product_search(uuid, text, text, text, boolean, integer, integer, boolean, uuid)
  TO service_role;

-- Products classified on 2026-11-11 that waited for these types. Codes that
-- do not exist (another database) are simply not matched.
UPDATE public.products SET kiosk_category = 'decoration' WHERE barcode IN (
  '405118',
  'B016',
  'CQD-501C',
  'CQF-307B',
  'CQF-311C',
  'CQF-314B',
  'HD0008144',
  'JF2210',
  'PARA-K',
  'PER01VZ00',
  'RIMINI-50-BL',
  'RIMINI-50-N',
  'SANTORINI-65-BL',
  'SANTORINI-78-BL',
  'VAS_V'
);
UPDATE public.products SET kiosk_category = 'raw_materials' WHERE barcode IN (
  '9122511-02R',
  '9225430-60M',
  '9225435-7BB',
  '9225491-60Y',
  '9225507-61T',
  '9225530-50T',
  '9225548-54S',
  '9225549-98T',
  '9236502-Q61',
  '9236504-Q63'
);
