-- ============================================================================
-- Inventory Management — Phase 1: stock movements ledger
--
-- Turns products.stock_levels (a static JSONB {location_key: qty} snapshot)
-- into a movement-driven system. stock_movements becomes the source of truth;
-- products.stock_levels is kept as a denormalized cache, updated only through
-- apply_stock_movement() so it can never drift from the ledger.
--
-- NOTE: products are global (PK = barcode, no company_id) in this app, so stock
-- is global too. Movements are tagged with company_id for "who did it" audit,
-- but the stock_levels update is on the shared product row (existing behavior).
-- location_key matches the loose string keys already used in stock_levels
-- (abbreviation / name / normalized name), so search/filter paths keep working.
-- ============================================================================

-- ── Movements ledger ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.stock_movements (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  barcode TEXT NOT NULL,
  location_key TEXT NOT NULL,
  location_id UUID REFERENCES public.stock_locations(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN (
    'in', 'out', 'adjustment', 'count', 'transfer_in', 'transfer_out', 'return'
  )),
  quantity NUMERIC NOT NULL,                 -- signed applied delta (+in / -out)
  unit_cost NUMERIC,                         -- for valuation (entrées)
  balance_after NUMERIC,                     -- stock level after applying (audit)
  reason TEXT,
  source_type TEXT NOT NULL DEFAULT 'manual' CHECK (source_type IN (
    'manual', 'bl', 'invoice', 'receipt', 'transfer', 'count', 'return'
  )),
  source_id TEXT,
  transfer_group_id UUID,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_movements_barcode ON public.stock_movements(barcode);
CREATE INDEX IF NOT EXISTS idx_stock_movements_location ON public.stock_movements(location_key);
CREATE INDEX IF NOT EXISTS idx_stock_movements_source ON public.stock_movements(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_company ON public.stock_movements(company_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_created ON public.stock_movements(created_at DESC);

ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all stock_movements" ON public.stock_movements
  FOR ALL USING (true) WITH CHECK (true);

-- ── Reorder rules (per product, optionally per location) ────────────────────
CREATE TABLE IF NOT EXISTS public.product_stock_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  barcode TEXT NOT NULL,
  location_key TEXT,                          -- null = applies to all locations
  reorder_point NUMERIC NOT NULL DEFAULT 0,
  reorder_qty NUMERIC NOT NULL DEFAULT 0,
  min_qty NUMERIC,
  max_qty NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (barcode, location_key, company_id)
);

CREATE INDEX IF NOT EXISTS idx_product_stock_settings_barcode ON public.product_stock_settings(barcode);

ALTER TABLE public.product_stock_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all product_stock_settings" ON public.product_stock_settings
  FOR ALL USING (true) WITH CHECK (true);

CREATE TRIGGER update_product_stock_settings_updated_at
  BEFORE UPDATE ON public.product_stock_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── apply_stock_movement: the ONLY writer of stock_levels ───────────────────
-- For directional types the magnitude is taken as abs(); for 'adjustment' and
-- 'count' the caller passes a SIGNED delta. Recomputes CMUP (weighted average)
-- into products.buyprice on entrées that carry a unit_cost.
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
  -- Lock the product row for a consistent read-modify-write
  SELECT stock_levels, buyprice INTO v_levels, v_old_cost
  FROM public.products WHERE barcode = p_barcode FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Produit introuvable: %', p_barcode;
  END IF;

  v_levels := COALESCE(v_levels, '{}'::jsonb);
  v_current := COALESCE((v_levels ->> p_location_key)::numeric, 0);

  v_delta := CASE p_type
    WHEN 'in'           THEN  abs(p_quantity)
    WHEN 'return'       THEN  abs(p_quantity)
    WHEN 'transfer_in'  THEN  abs(p_quantity)
    WHEN 'out'          THEN -abs(p_quantity)
    WHEN 'transfer_out' THEN -abs(p_quantity)
    ELSE p_quantity  -- 'adjustment' / 'count' : signed delta
  END;

  v_new_level := v_current + v_delta;

  -- CMUP (coût moyen unitaire pondéré) on entrées that carry a cost
  IF v_delta > 0 AND p_unit_cost IS NOT NULL AND p_unit_cost > 0 THEN
    SELECT COALESCE(SUM(value::numeric), 0) INTO v_total_qty
    FROM jsonb_each_text(v_levels);
    IF (v_total_qty + v_delta) > 0 THEN
      v_new_cost := (v_total_qty * COALESCE(v_old_cost, 0) + v_delta * p_unit_cost)
                    / (v_total_qty + v_delta);
      UPDATE public.products
        SET buyprice = round(v_new_cost::numeric, 2), updated_at = now()
        WHERE barcode = p_barcode;
    END IF;
  END IF;

  -- Update the cache (the ONLY place stock_levels is written)
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

GRANT EXECUTE ON FUNCTION public.apply_stock_movement(
  TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, TEXT, TEXT, UUID, TEXT, UUID, UUID
) TO anon, authenticated, service_role;

-- ── Backfill: seed existing stock_levels as opening-balance history ─────────
-- One 'count' movement per (product, location) recording the current level as
-- balance_after, WITHOUT changing stock_levels. Gives every existing quantity a
-- traceable starting point. Idempotent: skipped if any opening balance exists.
DO $$
DECLARE
  r RECORD;
BEGIN
  IF EXISTS (SELECT 1 FROM public.stock_movements WHERE source_type = 'count' AND reason = 'Solde d''ouverture') THEN
    RETURN;
  END IF;
  FOR r IN
    SELECT p.barcode, kv.key AS location_key, kv.value::numeric AS level
    FROM public.products p, jsonb_each_text(COALESCE(p.stock_levels, '{}'::jsonb)) kv
    WHERE kv.value::numeric <> 0
  LOOP
    INSERT INTO public.stock_movements (
      barcode, location_key, type, quantity, balance_after, reason,
      source_type, created_by
    ) VALUES (
      r.barcode, r.location_key, 'count', r.level, r.level, 'Solde d''ouverture',
      'count', 'system'
    );
  END LOOP;
END $$;
