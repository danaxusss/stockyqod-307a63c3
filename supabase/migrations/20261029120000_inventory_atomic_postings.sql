-- Inventory reliability: whole documents post stock in one transaction, once.
--
-- Before: pages called apply_stock_movement() once per line from the browser.
-- A failure halfway left a document half-posted, a retry or a second user
-- posted it again, counts applied a delta computed from levels loaded when the
-- page opened, and pages wrote location keys that did not match the keys the
-- products actually use ("DEP" vs "Dépôt").

-- ── Numeric-safe read of a stock level ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.stock_level_value(p_value text)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN btrim(coalesce(p_value, '')) ~ '^-?[0-9]+([.][0-9]+)?$' THEN btrim(p_value)::numeric ELSE 0 END;
$$;

-- ── Location key matching ───────────────────────────────────────────────────
-- Products store stock under loose keys (abbreviation, name, normalized name).
-- Returns the product's existing key matching the first candidate that has one
-- (exact, then case-insensitive, then spaces/underscores ignored); otherwise
-- the first non-empty candidate.
CREATE OR REPLACE FUNCTION public.resolve_stock_location_key(p_levels jsonb, p_candidates text[])
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT coalesce(
    (
      SELECT k.key
      FROM unnest(p_candidates) WITH ORDINALITY AS c(candidate, ord)
      JOIN jsonb_object_keys(coalesce(p_levels, '{}'::jsonb)) AS k(key)
        ON k.key = btrim(c.candidate)
        OR lower(k.key) = lower(btrim(c.candidate))
        OR lower(regexp_replace(k.key, '[\s_]+', '_', 'g')) = lower(regexp_replace(btrim(c.candidate), '[\s_]+', '_', 'g'))
      WHERE btrim(coalesce(c.candidate, '')) <> ''
      ORDER BY c.ord, (k.key = btrim(c.candidate)) DESC, (lower(k.key) = lower(btrim(c.candidate))) DESC
      LIMIT 1
    ),
    (
      SELECT btrim(c.candidate)
      FROM unnest(p_candidates) WITH ORDINALITY AS c(candidate, ord)
      WHERE btrim(coalesce(c.candidate, '')) <> ''
      ORDER BY c.ord
      LIMIT 1
    )
  );
$$;

-- ── apply_stock_movement: same contract, safer arithmetic ───────────────────
-- * Non-numeric stock values no longer abort the movement.
-- * CMUP ignores a negative total (oversold stock): receiving 5 at 120 with a
--   total of -4 now gives 120, not (-400 + 600) / 1 = 200.
CREATE OR REPLACE FUNCTION public.apply_stock_movement(
  p_barcode TEXT,
  p_location_key TEXT,
  p_type TEXT,
  p_quantity NUMERIC,
  p_unit_cost NUMERIC DEFAULT NULL,
  p_reason TEXT DEFAULT NULL,
  p_source_type TEXT DEFAULT 'manual',
  p_source_id TEXT DEFAULT NULL,
  p_company_id UUID DEFAULT NULL,
  p_created_by TEXT DEFAULT NULL,
  p_location_id UUID DEFAULT NULL,
  p_transfer_group_id UUID DEFAULT NULL
)
RETURNS public.stock_movements
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_levels JSONB;
  v_current NUMERIC;
  v_delta NUMERIC;
  v_new_level NUMERIC;
  v_total_qty NUMERIC;
  v_old_cost NUMERIC;
  v_new_cost NUMERIC;
  v_row public.stock_movements;
BEGIN
  SELECT stock_levels, buyprice INTO v_levels, v_old_cost
  FROM public.products WHERE barcode = p_barcode FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Produit introuvable: %', p_barcode;
  END IF;

  v_levels := COALESCE(v_levels, '{}'::jsonb);
  v_current := public.stock_level_value(v_levels ->> p_location_key);

  v_delta := CASE p_type
    WHEN 'in'           THEN  abs(p_quantity)
    WHEN 'return'       THEN  abs(p_quantity)
    WHEN 'transfer_in'  THEN  abs(p_quantity)
    WHEN 'out'          THEN -abs(p_quantity)
    WHEN 'transfer_out' THEN -abs(p_quantity)
    ELSE p_quantity
  END;

  v_new_level := v_current + v_delta;

  IF v_delta > 0 AND p_unit_cost IS NOT NULL AND p_unit_cost > 0 THEN
    SELECT GREATEST(COALESCE(SUM(public.stock_level_value(value)), 0), 0) INTO v_total_qty
    FROM jsonb_each_text(v_levels);
    v_new_cost := (v_total_qty * COALESCE(v_old_cost, 0) + v_delta * p_unit_cost) / (v_total_qty + v_delta);
    UPDATE public.products
      SET buyprice = round(v_new_cost::numeric, 2), updated_at = now()
      WHERE barcode = p_barcode;
  END IF;

  UPDATE public.products
    SET stock_levels = jsonb_set(v_levels, ARRAY[p_location_key], to_jsonb(v_new_level), true),
        updated_at = now()
    WHERE barcode = p_barcode;

  INSERT INTO public.stock_movements (
    company_id, barcode, location_key, location_id, type, quantity, unit_cost,
    balance_after, reason, source_type, source_id, transfer_group_id, created_by
  ) VALUES (
    p_company_id, p_barcode, p_location_key, p_location_id, p_type, v_delta, p_unit_cost,
    v_new_level, p_reason, p_source_type, p_source_id, p_transfer_group_id, p_created_by
  ) RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- ── Postings already applied (one row per document posting) ────────────────
CREATE TABLE IF NOT EXISTS public.stock_postings (
  posting_key TEXT PRIMARY KEY,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.stock_postings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Read stock_postings" ON public.stock_postings;
CREATE POLICY "Read stock_postings" ON public.stock_postings FOR SELECT USING (true);

-- ── apply_stock_movements: a whole document, all or nothing, once ───────────
-- p_movements: [{ barcode, location_keys: [candidates…] | location_key, type,
--   quantity | counted, unit_cost?, reason?, source_type?, source_id?,
--   location_id?, transfer_group_id? }]
-- * `counted` sets the level (physical count / adjustment): the delta is taken
--   against the level locked inside this transaction, never a stale one.
-- * p_posting_key (e.g. "bl-out:<id>") makes the posting idempotent: a retry, a
--   double click or a second user gets { duplicate: true } and nothing moves.
--   A failed posting rolls back its key too, so it can be retried.
CREATE OR REPLACE FUNCTION public.apply_stock_movements(
  p_posting_key TEXT,
  p_movements JSONB,
  p_company_id UUID DEFAULT NULL,
  p_created_by TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m JSONB;
  v_levels JSONB;
  v_key TEXT;
  v_candidates TEXT[];
  v_quantity NUMERIC;
  v_row public.stock_movements;
  v_rows JSONB := '[]'::jsonb;
BEGIN
  IF jsonb_typeof(p_movements) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Mouvements invalides';
  END IF;

  IF p_posting_key IS NOT NULL THEN
    INSERT INTO public.stock_postings (posting_key, created_by)
      VALUES (p_posting_key, p_created_by)
      ON CONFLICT (posting_key) DO NOTHING;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('duplicate', true, 'movements', '[]'::jsonb);
    END IF;
  END IF;

  FOR m IN SELECT value FROM jsonb_array_elements(p_movements) LOOP
    SELECT stock_levels INTO v_levels
    FROM public.products WHERE barcode = m ->> 'barcode' FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Produit introuvable: %', m ->> 'barcode';
    END IF;

    IF jsonb_typeof(m -> 'location_keys') = 'array' THEN
      SELECT array_agg(value) INTO v_candidates FROM jsonb_array_elements_text(m -> 'location_keys');
    ELSE
      v_candidates := ARRAY[m ->> 'location_key'];
    END IF;
    v_key := public.resolve_stock_location_key(v_levels, v_candidates);
    IF v_key IS NULL THEN
      RAISE EXCEPTION 'Emplacement manquant pour %', m ->> 'barcode';
    END IF;

    IF m ? 'counted' THEN
      v_quantity := (m ->> 'counted')::numeric - public.stock_level_value(coalesce(v_levels, '{}'::jsonb) ->> v_key);
      CONTINUE WHEN v_quantity = 0;
    ELSE
      v_quantity := (m ->> 'quantity')::numeric;
    END IF;

    v_row := public.apply_stock_movement(
      m ->> 'barcode', v_key, m ->> 'type', v_quantity,
      NULLIF(m ->> 'unit_cost', '')::numeric,
      m ->> 'reason',
      coalesce(m ->> 'source_type', 'manual'),
      m ->> 'source_id',
      p_company_id,
      p_created_by,
      NULLIF(m ->> 'location_id', '')::uuid,
      NULLIF(m ->> 'transfer_group_id', '')::uuid
    );
    v_rows := v_rows || to_jsonb(v_row);
  END LOOP;

  RETURN jsonb_build_object('duplicate', false, 'movements', v_rows);
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_stock_movements(TEXT, JSONB, UUID, TEXT) TO anon, authenticated, service_role;

-- ── Purchase order reception, locked and all-or-nothing ─────────────────────
-- p_lines: { "<purchase_order_items.id>": quantity received now }. Receiving
-- more than what remains is refused unless p_allow_over (checked against the
-- locked lines, so two people receiving at once cannot both take the rest).
CREATE OR REPLACE FUNCTION public.receive_purchase_order(
  p_po_id UUID,
  p_lines JSONB,
  p_location_keys TEXT[],
  p_location_id UUID DEFAULT NULL,
  p_allow_over BOOLEAN DEFAULT false,
  p_company_id UUID DEFAULT NULL,
  p_created_by TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_po public.purchase_orders;
  r RECORD;
  v_levels JSONB;
  v_key TEXT;
  v_status TEXT;
  v_any BOOLEAN := false;
BEGIN
  SELECT * INTO v_po FROM public.purchase_orders WHERE id = p_po_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bon de commande introuvable';
  END IF;
  IF v_po.status IN ('received', 'cancelled') THEN
    RAISE EXCEPTION 'Ce bon de commande est déjà %', CASE v_po.status WHEN 'received' THEN 'entièrement réceptionné' ELSE 'annulé' END;
  END IF;

  FOR r IN
    SELECT i.*, public.stock_level_value(p_lines ->> i.id::text) AS qty_now
    FROM public.purchase_order_items i
    WHERE i.po_id = p_po_id AND p_lines ? i.id::text
    ORDER BY i.sort_order
    FOR UPDATE
  LOOP
    CONTINUE WHEN r.qty_now <= 0;
    IF NOT p_allow_over AND r.qty_received + r.qty_now > r.qty_ordered THEN
      RAISE EXCEPTION 'Réception supérieure au reste à recevoir pour « % » (reste %)', r.label, GREATEST(r.qty_ordered - r.qty_received, 0)
        USING ERRCODE = 'P0001', HINT = 'over_receipt';
    END IF;
    SELECT stock_levels INTO v_levels FROM public.products WHERE barcode = r.barcode FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Produit introuvable: %', r.barcode;
    END IF;
    v_key := public.resolve_stock_location_key(v_levels, p_location_keys);
    PERFORM public.apply_stock_movement(
      r.barcode, v_key, 'in', r.qty_now, NULLIF(r.unit_cost, 0),
      'Réception ' || v_po.po_number, 'receipt', p_po_id::text,
      p_company_id, p_created_by, p_location_id, NULL
    );
    UPDATE public.purchase_order_items SET qty_received = qty_received + r.qty_now WHERE id = r.id;
    v_any := true;
  END LOOP;

  IF NOT v_any THEN
    RAISE EXCEPTION 'Aucune quantité à réceptionner';
  END IF;

  SELECT CASE
           WHEN bool_and(qty_received >= qty_ordered) THEN 'received'
           WHEN bool_or(qty_received > 0) THEN 'partial'
           ELSE v_po.status
         END
    INTO v_status
  FROM public.purchase_order_items WHERE po_id = p_po_id;

  UPDATE public.purchase_orders SET status = v_status WHERE id = p_po_id;
  RETURN v_status;
END;
$$;

GRANT EXECUTE ON FUNCTION public.receive_purchase_order(UUID, JSONB, TEXT[], UUID, BOOLEAN, UUID, TEXT) TO anon, authenticated, service_role;

-- ── Purchase order numbers: unique per company and year ─────────────────────
-- Replaces "count of POs + 1", which gave two simultaneous creations the same
-- number and never restarted with the year. The counter is seeded from the
-- highest number already used, so existing numbers are never reissued.
CREATE TABLE IF NOT EXISTS public.purchase_order_counters (
  company_key TEXT NOT NULL,
  year TEXT NOT NULL,
  last_number INTEGER NOT NULL,
  PRIMARY KEY (company_key, year)
);
ALTER TABLE public.purchase_order_counters ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.next_purchase_order_number(p_company_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year TEXT := to_char(now() AT TIME ZONE 'Africa/Casablanca', 'YYYY');
  v_company TEXT := coalesce(p_company_id::text, 'none');
  v_max INTEGER;
  v_next INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('po-number:' || v_company || ':' || v_year));
  SELECT coalesce(max((substring(po_number FROM '^BC-' || v_year || '-([0-9]+)$'))::int), 0)
    INTO v_max
  FROM public.purchase_orders
  WHERE company_id IS NOT DISTINCT FROM p_company_id AND po_number LIKE 'BC-' || v_year || '-%';

  INSERT INTO public.purchase_order_counters (company_key, year, last_number)
    VALUES (v_company, v_year, v_max + 1)
  ON CONFLICT (company_key, year)
    DO UPDATE SET last_number = GREATEST(purchase_order_counters.last_number, v_max) + 1
  RETURNING last_number INTO v_next;

  RETURN 'BC-' || v_year || '-' || lpad(v_next::text, 4, '0');
END;
$$;

GRANT EXECUTE ON FUNCTION public.next_purchase_order_number(UUID) TO anon, authenticated, service_role;
