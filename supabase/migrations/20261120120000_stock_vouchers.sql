-- Stock vouchers: Bon d'entrée (BE) and Bon de sortie (BS).
--
-- Numbered documents that move stock for everything that is not a supplier
-- receipt, a sale (BL) or a transfer: opening stock, breakage, internal use,
-- samples… A draft does not touch stock. Validating it posts all its lines in
-- one transaction (apply_stock_movements, posting key "voucher:<id>") and
-- locks it. A validated voucher is corrected by cancelling it, which posts the
-- opposite movements (posting key "voucher-cancel:<id>"); nothing is deleted.
--
-- Rules (owner's choices):
--   * Only stock staff (super admin, admin, manager) create and validate.
--   * The unit cost of a BE updates the product's average purchase price only
--     for "Réception sans commande"; otherwise it is kept for information.
--   * A BS that would make a stock level negative is refused, unless an admin
--     or super admin validates it with the override.
--
-- Also: reverse_document_stock(), so deleting a delivery note or a credit
-- note gives back the stock it had moved.
--
-- Safe to run more than once. Needs the secure-login step 3 helpers
-- (stocky_role, stocky_company_id, …).

-- ── Movement sources ─────────────────────────────────────────────────────
ALTER TABLE public.stock_movements DROP CONSTRAINT IF EXISTS stock_movements_source_type_check;
ALTER TABLE public.stock_movements ADD CONSTRAINT stock_movements_source_type_check CHECK (source_type IN (
  'manual', 'bl', 'invoice', 'receipt', 'transfer', 'count', 'return', 'voucher', 'reversal'
));

-- ── Tables ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.stock_vouchers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('entree', 'sortie')),
  number text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'validated', 'cancelled')),
  voucher_date date NOT NULL DEFAULT current_date,
  location_id uuid REFERENCES public.stock_locations(id) ON DELETE SET NULL,
  reason text NOT NULL,
  note text,
  created_by text,
  validated_by text,
  validated_at timestamptz,
  negative_override boolean NOT NULL DEFAULT false,
  cancelled_by text,
  cancelled_at timestamptz,
  cancel_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_vouchers_reason_check CHECK (
    (kind = 'entree' AND reason IN ('stock_initial', 'retour_client', 'reception_sans_commande', 'trouve_correction', 'assemblage', 'autre'))
    OR (kind = 'sortie' AND reason IN ('casse_perte', 'usage_interne', 'echantillon_demo', 'don', 'vol', 'correction', 'autre'))
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS stock_vouchers_number_key ON public.stock_vouchers (coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid), number) WHERE number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stock_vouchers_company ON public.stock_vouchers (company_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.stock_voucher_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_id uuid NOT NULL REFERENCES public.stock_vouchers(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  barcode text NOT NULL,
  product_name text,
  quantity numeric NOT NULL CHECK (quantity > 0),
  unit_cost numeric CHECK (unit_cost IS NULL OR unit_cost >= 0)
);
CREATE INDEX IF NOT EXISTS idx_stock_voucher_lines_voucher ON public.stock_voucher_lines (voucher_id, position);

-- Yearly numbering per company and kind: BE-2026-0001, BS-2026-0001.
CREATE TABLE IF NOT EXISTS public.stock_voucher_counters (
  company_key uuid NOT NULL,
  kind text NOT NULL,
  year integer NOT NULL,
  last_value integer NOT NULL DEFAULT 0,
  PRIMARY KEY (company_key, kind, year)
);

-- ── Who may touch vouchers ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.stocky_is_stock_staff()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(public.stocky_role() IN ('super_admin', 'admin', 'manager'), false);
$$;

-- A voucher of the caller's company (or any for those who write across companies).
CREATE OR REPLACE FUNCTION public.stocky_voucher_in_scope(p_company_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.stocky_is_stock_staff() AND (
    public.stocky_writes_all_companies('standard')
    OR p_company_id = public.stocky_company_id()
    OR (p_company_id IS NULL AND public.stocky_has_no_company())
  );
$$;

ALTER TABLE public.stock_vouchers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_voucher_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_voucher_counters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stocky_vouchers_select ON public.stock_vouchers;
DROP POLICY IF EXISTS stocky_vouchers_insert ON public.stock_vouchers;
DROP POLICY IF EXISTS stocky_vouchers_update ON public.stock_vouchers;
DROP POLICY IF EXISTS stocky_vouchers_delete ON public.stock_vouchers;
CREATE POLICY stocky_vouchers_select ON public.stock_vouchers FOR SELECT TO authenticated
  USING ((SELECT public.stocky_voucher_in_scope(company_id)) OR (public.stocky_is_stock_staff() AND public.stocky_reads_all_companies('standard')));
-- Drafts only: validation and cancellation go through the functions below.
CREATE POLICY stocky_vouchers_insert ON public.stock_vouchers FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.stocky_voucher_in_scope(company_id)) AND status = 'draft' AND number IS NULL);
CREATE POLICY stocky_vouchers_update ON public.stock_vouchers FOR UPDATE TO authenticated
  USING ((SELECT public.stocky_voucher_in_scope(company_id)) AND status = 'draft')
  WITH CHECK ((SELECT public.stocky_voucher_in_scope(company_id)) AND status = 'draft' AND number IS NULL);
CREATE POLICY stocky_vouchers_delete ON public.stock_vouchers FOR DELETE TO authenticated
  USING ((SELECT public.stocky_voucher_in_scope(company_id)) AND status = 'draft');

DROP POLICY IF EXISTS stocky_voucher_lines_select ON public.stock_voucher_lines;
DROP POLICY IF EXISTS stocky_voucher_lines_write ON public.stock_voucher_lines;
CREATE POLICY stocky_voucher_lines_select ON public.stock_voucher_lines FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.stock_vouchers v WHERE v.id = voucher_id));
CREATE POLICY stocky_voucher_lines_write ON public.stock_voucher_lines FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.stock_vouchers v WHERE v.id = voucher_id AND v.status = 'draft' AND (SELECT public.stocky_voucher_in_scope(v.company_id))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.stock_vouchers v WHERE v.id = voucher_id AND v.status = 'draft' AND (SELECT public.stocky_voucher_in_scope(v.company_id))));

-- Counters: only the functions below use them (no policy = no direct access).
REVOKE ALL ON public.stock_voucher_counters FROM anon, authenticated, PUBLIC;
REVOKE ALL ON public.stock_vouchers, public.stock_voucher_lines FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_vouchers, public.stock_voucher_lines TO authenticated;
GRANT ALL ON public.stock_vouchers, public.stock_voucher_lines, public.stock_voucher_counters TO service_role;

-- A validated or cancelled voucher never changes again, whoever asks
-- (the functions below switch this guard off for their own update).
CREATE OR REPLACE FUNCTION public.stock_vouchers_lock()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF coalesce(current_setting('stocky.voucher_posting', true), '') = 'on' THEN
    RETURN coalesce(NEW, OLD);
  END IF;
  IF TG_TABLE_NAME = 'stock_vouchers' THEN
    IF OLD.status <> 'draft' THEN RAISE EXCEPTION 'Bon validé ou annulé : il ne peut plus être modifié.'; END IF;
    IF TG_OP = 'UPDATE' AND (NEW.status <> 'draft' OR NEW.number IS NOT NULL) THEN
      RAISE EXCEPTION 'Un bon se valide avec le bouton Valider.';
    END IF;
    IF TG_OP = 'UPDATE' THEN NEW.updated_at := now(); END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM public.stock_vouchers v WHERE v.id = coalesce(NEW.voucher_id, OLD.voucher_id) AND v.status <> 'draft') THEN
      RAISE EXCEPTION 'Bon validé ou annulé : ses lignes ne peuvent plus être modifiées.';
    END IF;
  END IF;
  RETURN coalesce(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS stock_vouchers_lock ON public.stock_vouchers;
CREATE TRIGGER stock_vouchers_lock BEFORE UPDATE OR DELETE ON public.stock_vouchers
  FOR EACH ROW EXECUTE FUNCTION public.stock_vouchers_lock();
DROP TRIGGER IF EXISTS stock_voucher_lines_lock ON public.stock_voucher_lines;
CREATE TRIGGER stock_voucher_lines_lock BEFORE INSERT OR UPDATE OR DELETE ON public.stock_voucher_lines
  FOR EACH ROW EXECUTE FUNCTION public.stock_vouchers_lock();

-- ── Validate ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.validate_stock_voucher(p_voucher_id uuid, p_allow_negative boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v public.stock_vouchers%ROWTYPE;
  loc public.stock_locations%ROWTYPE;
  v_user text := (SELECT u.username FROM public.app_users u WHERE u.id = auth.uid());
  v_candidates text[];
  v_year integer;
  v_seq integer;
  v_number text;
  v_movements jsonb := '[]'::jsonb;
  v_short text;
  l record;
  v_levels jsonb;
  v_key text;
  v_level numeric;
  v_override boolean := false;
  v_result jsonb;
BEGIN
  SELECT * INTO v FROM public.stock_vouchers WHERE id = p_voucher_id FOR UPDATE;
  IF NOT FOUND OR NOT public.stocky_voucher_in_scope(v.company_id) THEN
    RAISE EXCEPTION 'Bon introuvable ou accès refusé.';
  END IF;
  IF v.status <> 'draft' THEN RAISE EXCEPTION 'Ce bon est déjà %.', CASE v.status WHEN 'validated' THEN 'validé' ELSE 'annulé' END; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.stock_voucher_lines WHERE voucher_id = v.id) THEN
    RAISE EXCEPTION 'Ajoutez au moins un article.';
  END IF;

  SELECT * INTO loc FROM public.stock_locations WHERE id = v.location_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Choisissez un emplacement de stock.'; END IF;
  v_candidates := array_remove(ARRAY[nullif(btrim(loc.abbreviation), ''), nullif(btrim(loc.name), '')], NULL);

  -- A Bon de sortie never takes a level below zero, unless an admin says so.
  IF v.kind = 'sortie' THEN
    FOR l IN
      SELECT barcode, max(product_name) AS name, sum(quantity) AS qty
      FROM public.stock_voucher_lines WHERE voucher_id = v.id GROUP BY barcode
    LOOP
      SELECT stock_levels INTO v_levels FROM public.products WHERE barcode = l.barcode FOR UPDATE;
      v_key := public.resolve_stock_location_key(coalesce(v_levels, '{}'::jsonb), v_candidates);
      v_level := public.stock_level_value(coalesce(v_levels, '{}'::jsonb) ->> v_key);
      IF v_level - l.qty < 0 THEN
        IF p_allow_negative AND public.stocky_role() IN ('super_admin', 'admin') THEN
          v_override := true;
        ELSE
          RAISE EXCEPTION 'Stock insuffisant pour % (% disponible à %, % demandé).', coalesce(l.name, l.barcode), v_level, loc.name, l.qty;
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- Number, in a gapless yearly sequence per company and kind.
  v_year := extract(year FROM v.voucher_date)::integer;
  INSERT INTO public.stock_voucher_counters (company_key, kind, year, last_value)
    VALUES (coalesce(v.company_id, '00000000-0000-0000-0000-000000000000'::uuid), v.kind, v_year, 1)
    ON CONFLICT (company_key, kind, year) DO UPDATE SET last_value = stock_voucher_counters.last_value + 1
    RETURNING last_value INTO v_seq;
  v_number := CASE v.kind WHEN 'entree' THEN 'BE' ELSE 'BS' END || '-' || v_year || '-' || lpad(v_seq::text, 4, '0');
  v_short := v_number || ' · ' || CASE v.reason
    WHEN 'stock_initial' THEN 'Stock initial'
    WHEN 'retour_client' THEN 'Retour client'
    WHEN 'reception_sans_commande' THEN 'Réception sans commande'
    WHEN 'trouve_correction' THEN 'Trouvé / correction'
    WHEN 'assemblage' THEN 'Assemblage'
    WHEN 'casse_perte' THEN 'Casse / perte'
    WHEN 'usage_interne' THEN 'Usage interne'
    WHEN 'echantillon_demo' THEN 'Échantillon / démo'
    WHEN 'don' THEN 'Don'
    WHEN 'vol' THEN 'Vol'
    WHEN 'correction' THEN 'Correction'
    ELSE 'Autre' END;

  FOR l IN SELECT * FROM public.stock_voucher_lines WHERE voucher_id = v.id ORDER BY position, id LOOP
    v_movements := v_movements || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'barcode', l.barcode,
      'location_keys', to_jsonb(v_candidates),
      'location_id', v.location_id,
      'type', CASE v.kind WHEN 'entree' THEN 'in' ELSE 'out' END,
      'quantity', l.quantity,
      -- The average purchase price moves only for a receipt without order.
      'unit_cost', CASE WHEN v.kind = 'entree' AND v.reason = 'reception_sans_commande' AND l.unit_cost > 0 THEN l.unit_cost END,
      'reason', v_short,
      'source_type', 'voucher',
      'source_id', v.id::text
    )));
  END LOOP;

  v_result := public.apply_stock_movements('voucher:' || v.id, v_movements, v.company_id, v_user);
  IF coalesce((v_result ->> 'duplicate')::boolean, false) THEN
    RAISE EXCEPTION 'Ce bon a déjà été appliqué au stock.';
  END IF;

  PERFORM set_config('stocky.voucher_posting', 'on', true);
  UPDATE public.stock_vouchers
    SET status = 'validated', number = v_number, validated_by = v_user, validated_at = now(),
        negative_override = v_override, updated_at = now()
    WHERE id = v.id;
  PERFORM set_config('stocky.voucher_posting', 'off', true);

  RETURN jsonb_build_object('number', v_number, 'movements', jsonb_array_length(v_movements), 'negative_override', v_override);
END $$;

-- ── Cancel ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cancel_stock_voucher(p_voucher_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v public.stock_vouchers%ROWTYPE;
  v_user text := (SELECT u.username FROM public.app_users u WHERE u.id = auth.uid());
  v_count integer;
BEGIN
  SELECT * INTO v FROM public.stock_vouchers WHERE id = p_voucher_id FOR UPDATE;
  IF NOT FOUND OR NOT public.stocky_voucher_in_scope(v.company_id) THEN
    RAISE EXCEPTION 'Bon introuvable ou accès refusé.';
  END IF;
  IF v.status = 'draft' THEN RAISE EXCEPTION 'Un brouillon se supprime, il ne s''annule pas.'; END IF;
  IF v.status = 'cancelled' THEN RAISE EXCEPTION 'Ce bon est déjà annulé.'; END IF;

  v_count := public.reverse_stock_source(v.id::text, 'voucher-cancel:' || v.id, 'Annulation ' || v.number, v.company_id, v_user);

  PERFORM set_config('stocky.voucher_posting', 'on', true);
  UPDATE public.stock_vouchers
    SET status = 'cancelled', cancelled_by = v_user, cancelled_at = now(),
        cancel_reason = nullif(btrim(coalesce(p_reason, '')), ''), updated_at = now()
    WHERE id = v.id;
  PERFORM set_config('stocky.voucher_posting', 'off', true);

  RETURN jsonb_build_object('reversed', v_count);
END $$;

-- ── Reverse every movement of a source, once ─────────────────────────────
-- Internal: posts the opposite of each movement recorded under p_source_id, in
-- one transaction, idempotent through p_posting_key. Returns the number of
-- movements posted (0 when already reversed or nothing to reverse).
CREATE OR REPLACE FUNCTION public.reverse_stock_source(p_source_id text, p_posting_key text, p_reason text, p_company_id uuid, p_created_by text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_movements jsonb := '[]'::jsonb;
  m record;
  v_result jsonb;
BEGIN
  FOR m IN
    SELECT barcode, location_key, location_id, sum(quantity) AS qty
    FROM public.stock_movements
    WHERE source_id = p_source_id AND source_type <> 'reversal'
    GROUP BY barcode, location_key, location_id
    HAVING sum(quantity) <> 0
  LOOP
    v_movements := v_movements || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'barcode', m.barcode,
      'location_key', m.location_key,
      'location_id', m.location_id,
      -- A signed delta back: stock that left comes back, stock that came in leaves.
      'type', 'adjustment',
      'quantity', -m.qty,
      'reason', p_reason,
      'source_type', 'reversal',
      'source_id', p_source_id
    )));
  END LOOP;
  IF jsonb_array_length(v_movements) = 0 THEN RETURN 0; END IF;

  v_result := public.apply_stock_movements(p_posting_key, v_movements, p_company_id, p_created_by);
  IF coalesce((v_result ->> 'duplicate')::boolean, false) THEN RETURN 0; END IF;
  RETURN jsonb_array_length(v_result -> 'movements');
END $$;

-- Deleting a delivery note or a credit note: give back what it moved.
CREATE OR REPLACE FUNCTION public.reverse_document_stock(p_document_id uuid, p_reference text DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user text := (SELECT u.username FROM public.app_users u WHERE u.id = auth.uid());
  v_company uuid;
BEGIN
  IF coalesce(public.stocky_role() NOT IN ('super_admin', 'admin', 'manager', 'facturation'), true) THEN
    RAISE EXCEPTION 'Accès refusé.';
  END IF;
  SELECT company_id INTO v_company FROM public.stock_movements
    WHERE source_id = p_document_id::text AND source_type <> 'reversal' LIMIT 1;
  IF v_company IS NOT NULL AND NOT (public.stocky_writes_all_companies('docs') OR v_company = public.stocky_company_id()) THEN
    RAISE EXCEPTION 'Accès refusé.';
  END IF;
  RETURN public.reverse_stock_source(
    p_document_id::text, 'document-delete:' || p_document_id,
    'Suppression ' || coalesce(nullif(btrim(p_reference), ''), 'document'), v_company, v_user);
END $$;

REVOKE ALL ON FUNCTION public.validate_stock_voucher(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_stock_voucher(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reverse_document_stock(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reverse_stock_source(text, text, text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.stock_vouchers_lock() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.stocky_is_stock_staff() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.stocky_voucher_in_scope(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.validate_stock_voucher(uuid, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_stock_voucher(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reverse_document_stock(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.stocky_is_stock_staff() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.stocky_voucher_in_scope(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
