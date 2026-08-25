-- Touch-friendly public quote-request kiosks.
-- Public clients never access these tables directly; the kiosk Edge Function
-- uses its service role after validating a revocable profile token.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE public.kiosk_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'Kiosque principal',
  public_token uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  enabled boolean NOT NULL DEFAULT true,
  greeting_title text NOT NULL DEFAULT 'Bienvenue',
  greeting_message text NOT NULL DEFAULT 'Créez votre demande de devis en quelques étapes.',
  logo_url text,
  accent_color text,
  language text NOT NULL DEFAULT 'fr' CHECK (language IN ('fr', 'en', 'ar')),
  show_prices boolean NOT NULL DEFAULT true,
  price_mode text NOT NULL DEFAULT 'retail' CHECK (price_mode IN ('retail', 'reseller')),
  require_email boolean NOT NULL DEFAULT false,
  show_out_of_stock boolean NOT NULL DEFAULT true,
  show_availability boolean NOT NULL DEFAULT false,
  inactivity_timeout_seconds integer NOT NULL DEFAULT 180
    CHECK (inactivity_timeout_seconds BETWEEN 60 AND 1800),
  default_assignee_id uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  visible_family_ids uuid[] NOT NULL DEFAULT '{}',
  visible_brands text[] NOT NULL DEFAULT '{}',
  featured_barcodes text[] NOT NULL DEFAULT '{}',
  created_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);

CREATE TABLE public.kiosk_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_number text NOT NULL UNIQUE,
  kiosk_profile_id uuid NOT NULL REFERENCES public.kiosk_profiles(id) ON DELETE RESTRICT,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  assigned_company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  assigned_user_id uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  customer_name text NOT NULL,
  customer_phone text NOT NULL,
  customer_email text,
  customer_note text,
  status text NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'assigned', 'reviewing', 'prepared', 'contacted', 'converted', 'rejected')),
  internal_notes text,
  total_amount numeric NOT NULL DEFAULT 0,
  -- Deliberately not an FK: quotes point back to kiosk requests, and avoiding a
  -- circular dependency keeps backup/restore deterministic.
  quote_id text,
  original_submission jsonb NOT NULL DEFAULT '{}'::jsonb,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.kiosk_request_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.kiosk_requests(id) ON DELETE CASCADE,
  product_barcode text NOT NULL REFERENCES public.products(barcode) ON UPDATE CASCADE ON DELETE RESTRICT,
  product_name text NOT NULL,
  product_brand text NOT NULL DEFAULT '',
  product_image text,
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 999),
  unit_price numeric NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  customer_unit_price numeric,
  price_mode text NOT NULL CHECK (price_mode IN ('retail', 'reseller')),
  subtotal numeric NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, product_barcode)
);

CREATE TABLE public.kiosk_request_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.kiosk_requests(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  actor_user_id uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  actor_name text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS source_kiosk_request_id uuid
  REFERENCES public.kiosk_requests(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_quotes_source_kiosk_request
  ON public.quotes(source_kiosk_request_id)
  WHERE source_kiosk_request_id IS NOT NULL;
CREATE INDEX idx_kiosk_profiles_company ON public.kiosk_profiles(company_id);
CREATE INDEX idx_kiosk_requests_company_status ON public.kiosk_requests(assigned_company_id, status, created_at DESC);
CREATE INDEX idx_kiosk_requests_assignee ON public.kiosk_requests(assigned_user_id, status, created_at DESC);
CREATE INDEX idx_kiosk_request_items_request ON public.kiosk_request_items(request_id, sort_order);
CREATE INDEX idx_kiosk_request_events_request ON public.kiosk_request_events(request_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_products_name_trgm ON public.products USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_products_brand_trgm ON public.products USING gin (brand gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_products_barcode_trgm ON public.products USING gin (barcode gin_trgm_ops);

ALTER TABLE public.kiosk_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kiosk_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kiosk_request_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kiosk_request_events ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS update_kiosk_profiles_updated_at ON public.kiosk_profiles;
CREATE TRIGGER update_kiosk_profiles_updated_at
  BEFORE UPDATE ON public.kiosk_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_kiosk_requests_updated_at ON public.kiosk_requests;
CREATE TRIGGER update_kiosk_requests_updated_at
  BEFORE UPDATE ON public.kiosk_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Fast, server-controlled catalogue paging for a validated kiosk profile.
CREATE OR REPLACE FUNCTION public.kiosk_catalog_search(
  p_profile_id uuid,
  p_search text DEFAULT '',
  p_family_id uuid DEFAULT NULL,
  p_offset integer DEFAULT 0,
  p_limit integer DEFAULT 30
)
RETURNS TABLE(
  barcode text,
  name text,
  brand text,
  image text,
  family_id uuid,
  family_name text,
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
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 60);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
BEGIN
  SELECT * INTO v_profile FROM public.kiosk_profiles WHERE id = p_profile_id AND enabled;
  IF NOT FOUND THEN RAISE EXCEPTION 'Kiosk unavailable'; END IF;

  RETURN QUERY
  WITH eligible AS (
    SELECT
      p.barcode,
      p.name,
      p.brand,
      p.image,
      cp.family_id,
      cf.name AS family_name,
      CASE v_profile.price_mode WHEN 'reseller' THEN p.reseller_price ELSE p.price END AS internal_price,
      stock.total_stock > 0 AS available,
      cp.sort_order,
      cf.sort_order AS family_sort,
      array_position(v_profile.featured_barcodes, p.barcode) AS featured_order
    FROM public.catalog_products cp
    JOIN public.products p ON p.barcode = cp.ref
    LEFT JOIN public.catalog_families cf ON cf.id = cp.family_id
    LEFT JOIN LATERAL (
      SELECT coalesce(sum(
        CASE WHEN e.value ~ '^-?[0-9]+([.][0-9]+)?$' THEN e.value::numeric ELSE 0 END
      ), 0) AS total_stock
      FROM jsonb_each_text(coalesce(p.stock_levels, '{}'::jsonb)) e
    ) stock ON true
    WHERE cp.company_id = v_profile.company_id
      AND NOT cp.hidden
      AND (cardinality(v_profile.visible_family_ids) = 0 OR cp.family_id = ANY(v_profile.visible_family_ids))
      AND (cardinality(v_profile.visible_brands) = 0 OR p.brand = ANY(v_profile.visible_brands))
      AND (p_family_id IS NULL OR cp.family_id = p_family_id)
      AND (v_profile.show_out_of_stock OR stock.total_stock > 0)
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
    e.family_id,
    e.family_name,
    CASE WHEN v_profile.show_prices THEN e.internal_price ELSE NULL END,
    e.available,
    count(*) OVER ()
  FROM eligible e
  ORDER BY e.featured_order NULLS LAST, e.family_sort NULLS LAST, e.sort_order, e.name, e.barcode
  OFFSET v_offset LIMIT v_limit;
END;
$$;

-- Atomic public submission. Prices and product eligibility are always resolved
-- on the server; the browser only sends barcode + quantity.
CREATE OR REPLACE FUNCTION public.create_kiosk_request(
  p_profile_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_customer_email text DEFAULT NULL,
  p_customer_note text DEFAULT NULL,
  p_items jsonb DEFAULT '[]'::jsonb
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
  IF length(btrim(coalesce(p_customer_name, ''))) < 2 THEN RAISE EXCEPTION 'Customer name is required'; END IF;
  IF length(btrim(coalesce(p_customer_phone, ''))) < 5 THEN RAISE EXCEPTION 'Customer phone is required'; END IF;
  IF v_profile.require_email AND length(btrim(coalesce(p_customer_email, ''))) < 5 THEN
    RAISE EXCEPTION 'Customer email is required';
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
    customer_note, status
  ) VALUES (
    v_request_id, v_number, v_profile.id, v_profile.company_id, v_profile.company_id,
    v_profile.default_assignee_id, btrim(p_customer_name), btrim(p_customer_phone),
    nullif(btrim(coalesce(p_customer_email, '')), ''), nullif(btrim(coalesce(p_customer_note, '')), ''),
    CASE WHEN v_profile.default_assignee_id IS NULL THEN 'new' ELSE 'assigned' END
  );

  WITH requested AS (
    SELECT btrim(x.barcode) AS barcode, sum(x.quantity)::integer AS quantity, min(x.ord)::integer AS sort_order
    FROM jsonb_to_recordset(p_items) WITH ORDINALITY AS x(barcode text, quantity integer, ord bigint)
    GROUP BY btrim(x.barcode)
  ), eligible AS (
    SELECT
      r.barcode, least(r.quantity, 999) AS quantity, r.sort_order,
      p.name, p.brand, p.image,
      CASE v_profile.price_mode WHEN 'reseller' THEN p.reseller_price ELSE p.price END AS unit_price
    FROM requested r
    JOIN public.products p ON p.barcode = r.barcode
    JOIN public.catalog_products cp ON cp.ref = p.barcode AND cp.company_id = v_profile.company_id AND NOT cp.hidden
    LEFT JOIN LATERAL (
      SELECT coalesce(sum(
        CASE WHEN e.value ~ '^-?[0-9]+([.][0-9]+)?$' THEN e.value::numeric ELSE 0 END
      ), 0) AS total_stock
      FROM jsonb_each_text(coalesce(p.stock_levels, '{}'::jsonb)) e
    ) stock ON true
    WHERE (cardinality(v_profile.visible_family_ids) = 0 OR cp.family_id = ANY(v_profile.visible_family_ids))
      AND (cardinality(v_profile.visible_brands) = 0 OR p.brand = ANY(v_profile.visible_brands))
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
  VALUES (v_request_id, 'submitted', jsonb_build_object('profile_id', v_profile.id));

  RETURN QUERY SELECT v_request_id, v_number;
END;
$$;

CREATE OR REPLACE FUNCTION public.kiosk_admin_product_search(
  p_company_id uuid,
  p_search text DEFAULT '',
  p_limit integer DEFAULT 20
)
RETURNS TABLE(
  barcode text,
  name text,
  brand text,
  image text,
  retail_price numeric,
  reseller_price numeric
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.barcode, p.name, p.brand, p.image, p.price, p.reseller_price
  FROM public.catalog_products cp
  JOIN public.products p ON p.barcode = cp.ref
  WHERE cp.company_id = p_company_id
    AND NOT cp.hidden
    AND (
      btrim(coalesce(p_search, '')) = '' OR
      p.barcode ILIKE '%' || btrim(p_search) || '%' OR
      p.name ILIKE '%' || btrim(p_search) || '%' OR
      p.brand ILIKE '%' || btrim(p_search) || '%'
    )
  ORDER BY p.name, p.barcode
  LIMIT least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

CREATE OR REPLACE FUNCTION public.kiosk_company_brands(p_company_id uuid)
RETURNS TABLE(brand text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT p.brand
  FROM public.catalog_products cp
  JOIN public.products p ON p.barcode = cp.ref
  WHERE cp.company_id = p_company_id
    AND NOT cp.hidden
    AND btrim(p.brand) <> ''
  ORDER BY p.brand;
$$;

-- Atomic staff edit. The Edge Function performs authorization before calling.
CREATE OR REPLACE FUNCTION public.update_kiosk_request(
  p_request_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_customer_email text,
  p_customer_note text,
  p_status text,
  p_assigned_company_id uuid,
  p_assigned_user_id uuid,
  p_internal_notes text,
  p_items jsonb,
  p_actor_user_id uuid,
  p_actor_name text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_status NOT IN ('new', 'assigned', 'reviewing', 'prepared', 'contacted', 'converted', 'rejected') THEN
    RAISE EXCEPTION 'Invalid request status';
  END IF;
  IF p_status = 'converted' THEN RAISE EXCEPTION 'Use quote conversion to mark a request converted'; END IF;
  IF length(btrim(coalesce(p_customer_name, ''))) < 2 OR length(btrim(coalesce(p_customer_phone, ''))) < 5 THEN
    RAISE EXCEPTION 'Customer name and phone are required';
  END IF;
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) < 1 OR jsonb_array_length(p_items) > 200 THEN
    RAISE EXCEPTION 'A request must contain 1 to 200 products';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_items) x(barcode text, quantity integer, unit_price numeric, price_mode text)
    WHERE btrim(coalesce(x.barcode, '')) = '' OR x.quantity NOT BETWEEN 1 AND 999
      OR x.unit_price < 0 OR x.unit_price > 1000000000
      OR coalesce(x.price_mode, 'retail') NOT IN ('retail', 'reseller')
  ) THEN RAISE EXCEPTION 'Invalid request item'; END IF;
  IF p_assigned_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.app_users u
    WHERE u.id = p_assigned_user_id
      AND (u.company_id = p_assigned_company_id OR u.is_superadmin)
  ) THEN RAISE EXCEPTION 'Assignee does not belong to the selected company'; END IF;

  UPDATE public.kiosk_requests
  SET customer_name = btrim(p_customer_name),
      customer_phone = btrim(p_customer_phone),
      customer_email = nullif(btrim(coalesce(p_customer_email, '')), ''),
      customer_note = nullif(btrim(coalesce(p_customer_note, '')), ''),
      status = CASE WHEN p_assigned_user_id IS NOT NULL AND p_status = 'new' THEN 'assigned' ELSE p_status END,
      assigned_company_id = p_assigned_company_id,
      assigned_user_id = p_assigned_user_id,
      internal_notes = nullif(btrim(coalesce(p_internal_notes, '')), '')
  WHERE id = p_request_id AND quote_id IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Editable kiosk request not found'; END IF;

  DELETE FROM public.kiosk_request_items WHERE request_id = p_request_id;
  WITH requested AS (
    SELECT btrim(x.barcode) AS barcode, sum(x.quantity)::integer AS quantity,
      min(x.unit_price) AS unit_price, min(coalesce(x.price_mode, 'retail')) AS price_mode,
      min(x.ord)::integer AS sort_order
    FROM jsonb_to_recordset(p_items) WITH ORDINALITY AS x(barcode text, quantity integer, unit_price numeric, price_mode text, ord bigint)
    GROUP BY btrim(x.barcode)
  )
  INSERT INTO public.kiosk_request_items (
    request_id, product_barcode, product_name, product_brand, product_image,
    quantity, unit_price, customer_unit_price, price_mode, subtotal, sort_order
  )
  SELECT p_request_id, p.barcode, p.name, p.brand, p.image,
    least(r.quantity, 999), r.unit_price, r.unit_price, r.price_mode,
    r.unit_price * least(r.quantity, 999), r.sort_order
  FROM requested r JOIN public.products p ON p.barcode = r.barcode;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> (SELECT count(DISTINCT btrim(x.barcode)) FROM jsonb_to_recordset(p_items) x(barcode text, quantity integer, unit_price numeric, price_mode text)) THEN
    RAISE EXCEPTION 'One or more products were not found';
  END IF;

  UPDATE public.kiosk_requests kr SET total_amount = (
    SELECT coalesce(sum(i.subtotal), 0) FROM public.kiosk_request_items i WHERE i.request_id = kr.id
  ) WHERE kr.id = p_request_id;

  INSERT INTO public.kiosk_request_events(request_id, event_type, actor_user_id, actor_name, details)
  VALUES (p_request_id, 'updated', p_actor_user_id, p_actor_name,
    jsonb_build_object('status', p_status, 'assigned_company_id', p_assigned_company_id, 'assigned_user_id', p_assigned_user_id));
END;
$$;

-- Convert once into the normal Stocky quote workflow.
CREATE OR REPLACE FUNCTION public.convert_kiosk_request(
  p_request_id uuid,
  p_actor_user_id uuid,
  p_actor_name text
)
RETURNS TABLE(quote_id text, quote_number text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request public.kiosk_requests%ROWTYPE;
  v_quote_id text := gen_random_uuid()::text;
  v_quote_number text := 'QT-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  v_items jsonb;
  v_salesperson text;
BEGIN
  SELECT * INTO v_request FROM public.kiosk_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Kiosk request not found'; END IF;
  IF v_request.quote_id IS NOT NULL OR v_request.status = 'converted' THEN RAISE EXCEPTION 'Request already converted'; END IF;
  IF v_request.status = 'rejected' THEN RAISE EXCEPTION 'Rejected request cannot be converted'; END IF;

  SELECT coalesce(nullif(u.custom_seller_name, ''), nullif(u.username, ''), p_actor_name)
  INTO v_salesperson
  FROM public.app_users u WHERE u.id = v_request.assigned_user_id;
  v_salesperson := coalesce(v_salesperson, p_actor_name, '');

  SELECT jsonb_agg(jsonb_build_object(
    'id', i.id::text,
    'product', jsonb_build_object(
      'barcode', p.barcode, 'name', p.name, 'brand', p.brand, 'image', p.image,
      'techsheet', p.techsheet, 'price', p.price, 'buyprice', p.buyprice,
      'reseller_price', p.reseller_price, 'provider', p.provider,
      'stock_levels', p.stock_levels
    ),
    'priceType', CASE WHEN i.price_mode = 'reseller' THEN 'reseller' ELSE 'normal' END,
    'marginPercentage', 0,
    'finalPrice', i.unit_price,
    'unitPrice', i.unit_price,
    'quantity', i.quantity,
    'subtotal', i.subtotal,
    'quoteName', i.product_name,
    'quoteBrand', i.product_brand,
    'quoteBarcode', i.product_barcode,
    'addedAt', now()
  ) ORDER BY i.sort_order)
  INTO v_items
  FROM public.kiosk_request_items i
  JOIN public.products p ON p.barcode = i.product_barcode
  WHERE i.request_id = p_request_id;
  IF v_items IS NULL THEN RAISE EXCEPTION 'Request has no products'; END IF;

  INSERT INTO public.quotes (
    id, quote_number, status, customer_info, items, total_amount, notes,
    created_by, document_type, company_id, issuing_company_id, source_kiosk_request_id
  ) VALUES (
    v_quote_id, v_quote_number, 'draft',
    jsonb_build_object(
      'fullName', v_request.customer_name,
      'phoneNumber', v_request.customer_phone,
      'email', v_request.customer_email,
      'address', '', 'city', '', 'salesPerson', v_salesperson
    ),
    v_items, v_request.total_amount,
    concat_ws(E'\n', 'Demande kiosque ' || v_request.request_number, v_request.customer_note, v_request.internal_notes),
    p_actor_name, 'quote', v_request.assigned_company_id, v_request.assigned_company_id, p_request_id
  );

  UPDATE public.kiosk_requests
  SET quote_id = v_quote_id, status = 'converted'
  WHERE id = p_request_id;

  INSERT INTO public.kiosk_request_events(request_id, event_type, actor_user_id, actor_name, details)
  VALUES (p_request_id, 'converted', p_actor_user_id, p_actor_name,
    jsonb_build_object('quote_id', v_quote_id, 'quote_number', v_quote_number));

  RETURN QUERY SELECT v_quote_id, v_quote_number;
END;
$$;

REVOKE ALL ON TABLE public.kiosk_profiles, public.kiosk_requests, public.kiosk_request_items, public.kiosk_request_events
  FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.kiosk_catalog_search(uuid, text, uuid, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_kiosk_request(uuid, text, text, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.kiosk_admin_product_search(uuid, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.kiosk_company_brands(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_kiosk_request(uuid, text, text, text, text, text, uuid, uuid, text, jsonb, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.convert_kiosk_request(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kiosk_catalog_search(uuid, text, uuid, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_kiosk_request(uuid, text, text, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.kiosk_admin_product_search(uuid, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.kiosk_company_brands(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_kiosk_request(uuid, text, text, text, text, text, uuid, uuid, text, jsonb, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.convert_kiosk_request(uuid, uuid, text) TO service_role;
