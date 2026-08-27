-- Keep kiosk quote IDs aligned with the live UUID quotes primary key and stop
-- deferred-contact requests before any quote data is written.

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
  v_quote_id uuid := gen_random_uuid();
  v_quote_number text := 'QT-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  v_items jsonb;
  v_salesperson text;
BEGIN
  SELECT * INTO v_request FROM public.kiosk_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Kiosk request not found'; END IF;
  IF v_request.quote_id IS NOT NULL OR v_request.status = 'converted' THEN RAISE EXCEPTION 'Request already converted'; END IF;
  IF v_request.status = 'rejected' THEN RAISE EXCEPTION 'Rejected request cannot be converted'; END IF;
  IF v_request.contact_details_pending THEN
    RAISE EXCEPTION 'Complete customer details before creating the quote';
  END IF;

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
  SET quote_id = v_quote_id::text, status = 'converted'
  WHERE id = p_request_id;

  INSERT INTO public.kiosk_request_events(request_id, event_type, actor_user_id, actor_name, details)
  VALUES (p_request_id, 'converted', p_actor_user_id, p_actor_name,
    jsonb_build_object('quote_id', v_quote_id, 'quote_number', v_quote_number));

  RETURN QUERY SELECT v_quote_id::text, v_quote_number;
END;
$$;

REVOKE ALL ON FUNCTION public.convert_kiosk_request(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.convert_kiosk_request(uuid, uuid, text)
  TO service_role;
