-- Kiosk quick wins: customer language choice, configurable confirmation
-- flow, and featured products returned by the public catalogue.

ALTER TABLE public.kiosk_profiles
  ADD COLUMN IF NOT EXISTS customer_languages text[] NOT NULL DEFAULT '{fr,en,ar}',
  ADD COLUMN IF NOT EXISTS allow_deferred_contact boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS success_screen_seconds integer NOT NULL DEFAULT 20;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.kiosk_profiles'::regclass
      AND conname = 'kiosk_profiles_customer_languages_check'
  ) THEN
    ALTER TABLE public.kiosk_profiles
      ADD CONSTRAINT kiosk_profiles_customer_languages_check
      CHECK (customer_languages <@ ARRAY['fr', 'en', 'ar']::text[]);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.kiosk_profiles'::regclass
      AND conname = 'kiosk_profiles_success_screen_seconds_check'
  ) THEN
    ALTER TABLE public.kiosk_profiles
      ADD CONSTRAINT kiosk_profiles_success_screen_seconds_check
      CHECK (success_screen_seconds BETWEEN 5 AND 120);
  END IF;
END;
$$;

-- The return type changes (new `featured` column), so the function has to be
-- dropped rather than replaced.
DROP FUNCTION IF EXISTS public.kiosk_product_search(uuid, text, text, text, boolean, integer, integer);

CREATE FUNCTION public.kiosk_product_search(
  p_profile_id uuid,
  p_search text DEFAULT '',
  p_category text DEFAULT NULL,
  p_brand text DEFAULT NULL,
  p_only_available boolean DEFAULT false,
  p_offset integer DEFAULT 0,
  p_limit integer DEFAULT 48,
  p_featured_only boolean DEFAULT false
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

REVOKE ALL ON FUNCTION public.kiosk_product_search(uuid, text, text, text, boolean, integer, integer, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kiosk_product_search(uuid, text, text, text, boolean, integer, integer, boolean)
  TO service_role;
