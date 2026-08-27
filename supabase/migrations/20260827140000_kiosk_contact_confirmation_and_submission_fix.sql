-- Move kiosk contact collection to confirmation, permit explicitly deferred
-- contact details, and fix JSON item ordering on current PostgreSQL versions.

ALTER TABLE public.kiosk_requests
  ADD COLUMN IF NOT EXISTS contact_details_pending boolean NOT NULL DEFAULT false;

DROP FUNCTION IF EXISTS public.create_kiosk_request(uuid, text, text, text, text, jsonb);

CREATE FUNCTION public.create_kiosk_request(
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
  v_require_email boolean;
  v_contact_pending boolean;
BEGIN
  IF p_status NOT IN ('new', 'assigned', 'reviewing', 'prepared', 'contacted', 'converted', 'rejected') THEN
    RAISE EXCEPTION 'Invalid request status';
  END IF;
  IF p_status = 'converted' THEN RAISE EXCEPTION 'Use quote conversion to mark a request converted'; END IF;
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

  SELECT kp.require_email INTO v_require_email
  FROM public.kiosk_requests kr
  JOIN public.kiosk_profiles kp ON kp.id = kr.kiosk_profile_id
  WHERE kr.id = p_request_id AND kr.quote_id IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Editable kiosk request not found'; END IF;

  v_contact_pending :=
    length(btrim(coalesce(p_customer_name, ''))) < 2
    OR btrim(coalesce(p_customer_phone, '')) !~ '^\+?[0-9 ()\.-]{7,24}$'
    OR length(regexp_replace(coalesce(p_customer_phone, ''), '[^0-9]', '', 'g')) NOT BETWEEN 7 AND 15
    OR (btrim(coalesce(p_customer_email, '')) <> ''
      AND btrim(p_customer_email) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$')
    OR (v_require_email AND btrim(coalesce(p_customer_email, '')) = '');

  UPDATE public.kiosk_requests
  SET customer_name = btrim(coalesce(p_customer_name, '')),
      customer_phone = btrim(coalesce(p_customer_phone, '')),
      customer_email = nullif(btrim(coalesce(p_customer_email, '')), ''),
      customer_note = nullif(btrim(coalesce(p_customer_note, '')), ''),
      contact_details_pending = v_contact_pending,
      status = CASE WHEN p_assigned_user_id IS NOT NULL AND p_status = 'new' THEN 'assigned' ELSE p_status END,
      assigned_company_id = p_assigned_company_id,
      assigned_user_id = p_assigned_user_id,
      internal_notes = nullif(btrim(coalesce(p_internal_notes, '')), '')
  WHERE id = p_request_id AND quote_id IS NULL;

  DELETE FROM public.kiosk_request_items WHERE request_id = p_request_id;
  WITH requested AS (
    SELECT
      btrim(x.item ->> 'barcode') AS barcode,
      sum((x.item ->> 'quantity')::integer)::integer AS quantity,
      min((x.item ->> 'unit_price')::numeric) AS unit_price,
      min(coalesce(nullif(x.item ->> 'price_mode', ''), 'retail')) AS price_mode,
      min(x.ord)::integer AS sort_order
    FROM jsonb_array_elements(p_items) WITH ORDINALITY AS x(item, ord)
    GROUP BY btrim(x.item ->> 'barcode')
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
    jsonb_build_object(
      'status', p_status,
      'assigned_company_id', p_assigned_company_id,
      'assigned_user_id', p_assigned_user_id,
      'contact_details_pending', v_contact_pending
    ));
END;
$$;

-- A deferred-contact request may be edited and assigned, but never converted
-- into a quote until staff completes the contact details.
CREATE OR REPLACE FUNCTION public.guard_kiosk_contact_before_conversion()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'converted' AND NEW.contact_details_pending THEN
    RAISE EXCEPTION 'Complete customer details before creating the quote';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_kiosk_contact_before_conversion ON public.kiosk_requests;
CREATE TRIGGER guard_kiosk_contact_before_conversion
  BEFORE UPDATE OF status ON public.kiosk_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_kiosk_contact_before_conversion();

REVOKE ALL ON FUNCTION public.create_kiosk_request(uuid, text, text, text, text, jsonb, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_kiosk_request(uuid, text, text, text, text, jsonb, boolean)
  TO service_role;

REVOKE ALL ON FUNCTION public.update_kiosk_request(uuid, text, text, text, text, text, uuid, uuid, text, jsonb, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_kiosk_request(uuid, text, text, text, text, text, uuid, uuid, text, jsonb, uuid, text)
  TO service_role;

REVOKE ALL ON FUNCTION public.guard_kiosk_contact_before_conversion()
  FROM PUBLIC, anon, authenticated;
