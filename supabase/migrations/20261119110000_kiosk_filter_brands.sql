-- Kiosk: the brands (and their series) offered for the filters in use.
--
-- The brand row listed every brand of the kiosk whatever category, sector,
-- search or availability was chosen, so a customer could pick a brand with no
-- product left on screen. This returns, for the current filters (all except
-- brand and series themselves), each brand with its series (NULL when a
-- product has no series). Same visibility rules as kiosk_product_search.

CREATE OR REPLACE FUNCTION public.kiosk_filter_brands(
  p_profile_id uuid,
  p_search text DEFAULT '',
  p_category text DEFAULT NULL,
  p_sector uuid DEFAULT NULL,
  p_only_available boolean DEFAULT false,
  p_featured_only boolean DEFAULT false
)
RETURNS TABLE(brand text, series text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile public.kiosk_profiles%ROWTYPE;
  v_search text := btrim(coalesce(p_search, ''));
  v_category text := nullif(btrim(coalesce(p_category, '')), '');
BEGIN
  SELECT * INTO v_profile
  FROM public.kiosk_profiles
  WHERE kiosk_profiles.id = p_profile_id AND enabled;
  IF NOT FOUND THEN RAISE EXCEPTION 'Kiosk unavailable'; END IF;

  IF v_category IS NOT NULL
    AND v_category NOT IN ('utensils', 'furniture', 'equipment', 'decoration', 'raw_materials') THEN
    RAISE EXCEPTION 'Invalid kiosk category';
  END IF;

  RETURN QUERY
  SELECT DISTINCT p.brand, nullif(btrim(coalesce(p.series, '')), '')
  FROM public.products p
  LEFT JOIN LATERAL (
    SELECT coalesce(sum(
      CASE WHEN e.value ~ '^-?[0-9]+([.][0-9]+)?$' THEN e.value::numeric ELSE 0 END
    ), 0) AS total_stock
    FROM jsonb_each_text(coalesce(p.stock_levels, '{}'::jsonb)) e
  ) stock ON true
  WHERE btrim(coalesce(p.brand, '')) <> ''
    AND (coalesce(cardinality(v_profile.visible_brands), 0) = 0 OR p.brand = ANY(v_profile.visible_brands))
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
  ORDER BY 1, 2;
END;
$$;

REVOKE ALL ON FUNCTION public.kiosk_filter_brands(uuid, text, text, uuid, boolean, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kiosk_filter_brands(uuid, text, text, uuid, boolean, boolean) TO service_role;
