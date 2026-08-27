-- Use the Stocky product master as the kiosk source and add a deliberately
-- small, manually managed classification for touch-friendly browsing.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS kiosk_category text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.products'::regclass
      AND conname = 'products_kiosk_category_check'
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_kiosk_category_check
      CHECK (kiosk_category IS NULL OR kiosk_category IN ('utensils', 'furniture', 'equipment'));
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_products_kiosk_category
  ON public.products(kiosk_category)
  WHERE kiosk_category IS NOT NULL;

CREATE OR REPLACE FUNCTION public.kiosk_product_search(
  p_profile_id uuid,
  p_search text DEFAULT '',
  p_category text DEFAULT NULL,
  p_brand text DEFAULT NULL,
  p_only_available boolean DEFAULT false,
  p_offset integer DEFAULT 0,
  p_limit integer DEFAULT 48
)
RETURNS TABLE(
  barcode text,
  name text,
  brand text,
  image text,
  kiosk_category text,
  display_price numeric,
  available boolean,
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

CREATE OR REPLACE FUNCTION public.kiosk_product_brands(p_profile_id uuid)
RETURNS TABLE(brand text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile public.kiosk_profiles%ROWTYPE;
BEGIN
  SELECT * INTO v_profile
  FROM public.kiosk_profiles
  WHERE id = p_profile_id AND enabled;
  IF NOT FOUND THEN RAISE EXCEPTION 'Kiosk unavailable'; END IF;

  RETURN QUERY
  SELECT DISTINCT p.brand
  FROM public.products p
  WHERE btrim(p.brand) <> ''
    AND (coalesce(cardinality(v_profile.visible_brands), 0) = 0 OR p.brand = ANY(v_profile.visible_brands))
  ORDER BY p.brand;
END;
$$;

-- The company parameter is retained for backwards-compatible callers. Product
-- master data is shared, so every kiosk administrator selects from all brands.
CREATE OR REPLACE FUNCTION public.kiosk_company_brands(p_company_id uuid)
RETURNS TABLE(brand text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT p.brand
  FROM public.products p
  WHERE btrim(p.brand) <> ''
    AND p_company_id IS NOT NULL
  ORDER BY p.brand;
$$;

CREATE OR REPLACE FUNCTION public.create_kiosk_request(
  p_profile_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_customer_email text DEFAULT NULL,
  p_customer_note text DEFAULT NULL,
  p_items jsonb DEFAULT '[]'::jsonb,
  p_contact_details_pending boolean DEFAULT false
)
RETURNS TABLE(request_id uuid, request_number text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile public.kiosk_profiles%ROWTYPE;
  v_request_id uuid := gen_random_uuid();
  v_number text := 'KSK-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  v_requested integer;
  v_inserted integer;
BEGIN
  SELECT * INTO v_profile FROM public.kiosk_profiles WHERE id = p_profile_id AND enabled;
  IF NOT FOUND THEN RAISE EXCEPTION 'Kiosk unavailable'; END IF;

  IF NOT coalesce(p_contact_details_pending, false) THEN
    IF length(btrim(coalesce(p_customer_name, ''))) < 2 THEN
      RAISE EXCEPTION 'Customer name is required';
    END IF;
    IF btrim(coalesce(p_customer_phone, '')) !~ '^\+?[0-9 ()\.-]{7,24}$'
      OR length(regexp_replace(coalesce(p_customer_phone, ''), '[^0-9]', '', 'g')) NOT BETWEEN 7 AND 15 THEN
      RAISE EXCEPTION 'Invalid customer phone';
    END IF;
    IF v_profile.require_email AND btrim(coalesce(p_customer_email, '')) = '' THEN
      RAISE EXCEPTION 'Customer email is required';
    END IF;
    IF btrim(coalesce(p_customer_email, '')) <> ''
      AND btrim(p_customer_email) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$' THEN
      RAISE EXCEPTION 'Invalid customer email';
    END IF;
  END IF;

  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) < 1 OR jsonb_array_length(p_items) > 100 THEN
    RAISE EXCEPTION 'A request must contain 1 to 100 products';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_items) x(barcode text, quantity integer)
    WHERE btrim(coalesce(x.barcode, '')) = '' OR x.quantity NOT BETWEEN 1 AND 999
  ) THEN RAISE EXCEPTION 'Invalid product quantity'; END IF;

  INSERT INTO public.kiosk_requests (
    id, request_number, kiosk_profile_id, company_id, assigned_company_id,
    assigned_user_id, customer_name, customer_phone, customer_email,
    customer_note, contact_details_pending, status
  ) VALUES (
    v_request_id, v_number, v_profile.id, v_profile.company_id, v_profile.company_id,
    v_profile.default_assignee_id, btrim(coalesce(p_customer_name, '')),
    btrim(coalesce(p_customer_phone, '')), nullif(btrim(coalesce(p_customer_email, '')), ''),
    nullif(btrim(coalesce(p_customer_note, '')), ''), coalesce(p_contact_details_pending, false),
    CASE WHEN v_profile.default_assignee_id IS NULL THEN 'new' ELSE 'assigned' END
  );

  WITH requested AS (
    SELECT
      btrim(x.item ->> 'barcode') AS barcode,
      sum((x.item ->> 'quantity')::integer)::integer AS quantity,
      min(x.ord)::integer AS sort_order
    FROM jsonb_array_elements(p_items) WITH ORDINALITY AS x(item, ord)
    GROUP BY btrim(x.item ->> 'barcode')
  ), eligible AS (
    SELECT
      r.barcode, least(r.quantity, 999) AS quantity, r.sort_order,
      p.name, p.brand, p.image,
      CASE v_profile.price_mode WHEN 'reseller' THEN p.reseller_price ELSE p.price END AS unit_price
    FROM requested r
    JOIN public.products p ON p.barcode = r.barcode
    LEFT JOIN LATERAL (
      SELECT coalesce(sum(
        CASE WHEN e.value ~ '^-?[0-9]+([.][0-9]+)?$' THEN e.value::numeric ELSE 0 END
      ), 0) AS total_stock
      FROM jsonb_each_text(coalesce(p.stock_levels, '{}'::jsonb)) e
    ) stock ON true
    WHERE (coalesce(cardinality(v_profile.visible_brands), 0) = 0 OR p.brand = ANY(v_profile.visible_brands))
      AND (v_profile.show_out_of_stock OR stock.total_stock > 0)
  )
  INSERT INTO public.kiosk_request_items (
    request_id, product_barcode, product_name, product_brand, product_image,
    quantity, unit_price, customer_unit_price, price_mode, subtotal, sort_order
  )
  SELECT
    v_request_id, e.barcode, e.name, e.brand, e.image, e.quantity, e.unit_price,
    CASE WHEN v_profile.show_prices THEN e.unit_price ELSE NULL END,
    v_profile.price_mode, e.unit_price * e.quantity, e.sort_order
  FROM eligible e;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  SELECT count(DISTINCT btrim(x.barcode)) INTO v_requested
  FROM jsonb_to_recordset(p_items) x(barcode text, quantity integer);
  IF v_inserted <> v_requested THEN RAISE EXCEPTION 'One or more products are unavailable'; END IF;

  UPDATE public.kiosk_requests kr
  SET total_amount = totals.total,
      original_submission = jsonb_build_object(
        'customer', jsonb_build_object(
          'name', kr.customer_name, 'phone', kr.customer_phone,
          'email', kr.customer_email, 'note', kr.customer_note
        ),
        'contact_details_pending', kr.contact_details_pending,
        'items', totals.items,
        'prices_shown', v_profile.show_prices,
        'price_mode', v_profile.price_mode,
        'submitted_at', kr.submitted_at
      )
  FROM (
    SELECT coalesce(sum(i.subtotal), 0) AS total,
      coalesce(jsonb_agg(jsonb_build_object(
        'barcode', i.product_barcode, 'name', i.product_name, 'brand', i.product_brand,
        'image', i.product_image, 'quantity', i.quantity,
        'unit_price', i.customer_unit_price, 'subtotal',
        CASE WHEN i.customer_unit_price IS NULL THEN NULL ELSE i.customer_unit_price * i.quantity END
      ) ORDER BY i.sort_order), '[]'::jsonb) AS items
    FROM public.kiosk_request_items i WHERE i.request_id = v_request_id
  ) totals
  WHERE kr.id = v_request_id;

  INSERT INTO public.kiosk_request_events(request_id, event_type, details)
  VALUES (v_request_id, 'submitted', jsonb_build_object(
    'profile_id', v_profile.id,
    'contact_details_pending', coalesce(p_contact_details_pending, false)
  ));

  RETURN QUERY SELECT v_request_id, v_number;
END;
$$;

REVOKE ALL ON FUNCTION public.kiosk_product_search(uuid, text, text, text, boolean, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kiosk_product_search(uuid, text, text, text, boolean, integer, integer)
  TO service_role;

REVOKE ALL ON FUNCTION public.kiosk_product_brands(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kiosk_product_brands(uuid)
  TO service_role;

REVOKE ALL ON FUNCTION public.kiosk_company_brands(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kiosk_company_brands(uuid)
  TO service_role;

REVOKE ALL ON FUNCTION public.create_kiosk_request(uuid, text, text, text, text, jsonb, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_kiosk_request(uuid, text, text, text, text, jsonb, boolean)
  TO service_role;
