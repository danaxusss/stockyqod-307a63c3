-- Delivery notes leave stock through a Bon de sortie.
--
-- "Créer le bon de sortie" on a delivery note (BL) prepares a BS with reason
-- "Livraison client", the BL's lines and, per line, the location it ships
-- from. Validating that BS moves the stock (stock staff only, as for every
-- voucher). Billing staff may prepare and view the BS of their BLs.
--
-- Guards against counting a delivery twice:
--   * one active (draft or validated) BS per BL (unique index);
--   * a BS is refused for a BL already counted out the old way
--     ("Décompter le stock", movements with source_type 'bl').
-- Deleting the BL cancels its validated BS (stock comes back) and removes a
-- draft one.
--
-- Also: reverse_document_stock now takes the document id as text (quotes.id
-- is text), replacing the uuid version.
--
-- Needs 20261120120000_stock_vouchers.sql. Safe to run more than once.

-- ── Columns ──────────────────────────────────────────────────────────────
ALTER TABLE public.stock_vouchers ADD COLUMN IF NOT EXISTS source_document_id text;
ALTER TABLE public.stock_vouchers ADD COLUMN IF NOT EXISTS source_document_number text;
-- Lines may ship from different locations (a BL dispatched from two depots).
ALTER TABLE public.stock_voucher_lines ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES public.stock_locations(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS stock_vouchers_one_active_per_document
  ON public.stock_vouchers (source_document_id)
  WHERE source_document_id IS NOT NULL AND status <> 'cancelled';

ALTER TABLE public.stock_vouchers DROP CONSTRAINT IF EXISTS stock_vouchers_reason_check;
ALTER TABLE public.stock_vouchers ADD CONSTRAINT stock_vouchers_reason_check CHECK (
  (kind = 'entree' AND reason IN ('stock_initial', 'retour_client', 'reception_sans_commande', 'trouve_correction', 'assemblage', 'autre'))
  OR (kind = 'sortie' AND reason IN ('livraison_client', 'casse_perte', 'usage_interne', 'echantillon_demo', 'don', 'vol', 'correction', 'autre'))
);

-- ── Who may see and prepare vouchers ─────────────────────────────────────
-- Stock staff of the company (as before), plus billing staff for the
-- vouchers of their delivery notes.
CREATE OR REPLACE FUNCTION public.stocky_voucher_can_edit(p_company_id uuid, p_source_document_id text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.stocky_voucher_in_scope(p_company_id) OR (
    p_source_document_id IS NOT NULL
    AND coalesce(public.stocky_role() = 'facturation', false)
    AND (
      public.stocky_writes_all_companies('docs')
      OR p_company_id = public.stocky_company_id()
      OR (p_company_id IS NULL AND public.stocky_has_no_company())
    )
  );
$$;
REVOKE ALL ON FUNCTION public.stocky_voucher_can_edit(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stocky_voucher_can_edit(uuid, text) TO authenticated, service_role;

DROP POLICY IF EXISTS stocky_vouchers_select ON public.stock_vouchers;
DROP POLICY IF EXISTS stocky_vouchers_insert ON public.stock_vouchers;
DROP POLICY IF EXISTS stocky_vouchers_update ON public.stock_vouchers;
DROP POLICY IF EXISTS stocky_vouchers_delete ON public.stock_vouchers;
CREATE POLICY stocky_vouchers_select ON public.stock_vouchers FOR SELECT TO authenticated
  USING ((SELECT public.stocky_voucher_can_edit(company_id, source_document_id))
         OR (public.stocky_is_stock_staff() AND public.stocky_reads_all_companies('standard')));
CREATE POLICY stocky_vouchers_insert ON public.stock_vouchers FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.stocky_voucher_can_edit(company_id, source_document_id)) AND status = 'draft' AND number IS NULL);
CREATE POLICY stocky_vouchers_update ON public.stock_vouchers FOR UPDATE TO authenticated
  USING ((SELECT public.stocky_voucher_can_edit(company_id, source_document_id)) AND status = 'draft')
  WITH CHECK ((SELECT public.stocky_voucher_can_edit(company_id, source_document_id)) AND status = 'draft' AND number IS NULL);
CREATE POLICY stocky_vouchers_delete ON public.stock_vouchers FOR DELETE TO authenticated
  USING ((SELECT public.stocky_voucher_can_edit(company_id, source_document_id)) AND status = 'draft');

DROP POLICY IF EXISTS stocky_voucher_lines_write ON public.stock_voucher_lines;
CREATE POLICY stocky_voucher_lines_write ON public.stock_voucher_lines FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.stock_vouchers v WHERE v.id = voucher_id AND v.status = 'draft' AND (SELECT public.stocky_voucher_can_edit(v.company_id, v.source_document_id))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.stock_vouchers v WHERE v.id = voucher_id AND v.status = 'draft' AND (SELECT public.stocky_voucher_can_edit(v.company_id, v.source_document_id))));

-- ── Validate: per-line locations, and no second count of a BL ────────────
CREATE OR REPLACE FUNCTION public.validate_stock_voucher(p_voucher_id uuid, p_allow_negative boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v public.stock_vouchers%ROWTYPE;
  v_user text := (SELECT u.username FROM public.app_users u WHERE u.id = auth.uid());
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
  IF v.location_id IS NULL AND EXISTS (SELECT 1 FROM public.stock_voucher_lines WHERE voucher_id = v.id AND location_id IS NULL) THEN
    RAISE EXCEPTION 'Choisissez un emplacement de stock.';
  END IF;

  -- A delivery note already counted out with "Décompter le stock".
  IF v.source_document_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.stock_movements m
    WHERE m.source_id = v.source_document_id
    GROUP BY m.source_id
    HAVING bool_or(m.source_type = 'bl') AND sum(m.quantity) <> 0
  ) THEN
    RAISE EXCEPTION 'Ce BL a déjà été décompté du stock : ce bon de sortie le décompterait une deuxième fois.';
  END IF;

  -- A Bon de sortie never takes a level below zero, unless an admin says so.
  IF v.kind = 'sortie' THEN
    FOR l IN
      SELECT vl.barcode, max(vl.product_name) AS name, sum(vl.quantity) AS qty, loc.name AS loc_name,
             array_remove(ARRAY[nullif(btrim(loc.abbreviation), ''), nullif(btrim(loc.name), '')], NULL) AS candidates
      FROM public.stock_voucher_lines vl
      JOIN public.stock_locations loc ON loc.id = coalesce(vl.location_id, v.location_id)
      WHERE vl.voucher_id = v.id
      GROUP BY vl.barcode, loc.id, loc.name, loc.abbreviation
    LOOP
      SELECT stock_levels INTO v_levels FROM public.products WHERE barcode = l.barcode FOR UPDATE;
      v_key := public.resolve_stock_location_key(coalesce(v_levels, '{}'::jsonb), l.candidates);
      v_level := public.stock_level_value(coalesce(v_levels, '{}'::jsonb) ->> v_key);
      IF v_level - l.qty < 0 THEN
        IF p_allow_negative AND public.stocky_role() IN ('super_admin', 'admin') THEN
          v_override := true;
        ELSE
          RAISE EXCEPTION 'Stock insuffisant pour % (% disponible à %, % demandé).', coalesce(l.name, l.barcode), v_level, l.loc_name, l.qty;
        END IF;
      END IF;
    END LOOP;
  END IF;

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
    WHEN 'livraison_client' THEN 'Livraison ' || coalesce(v.source_document_number, 'client')
    WHEN 'casse_perte' THEN 'Casse / perte'
    WHEN 'usage_interne' THEN 'Usage interne'
    WHEN 'echantillon_demo' THEN 'Échantillon / démo'
    WHEN 'don' THEN 'Don'
    WHEN 'vol' THEN 'Vol'
    WHEN 'correction' THEN 'Correction'
    ELSE 'Autre' END;

  FOR l IN
    SELECT vl.*, coalesce(vl.location_id, v.location_id) AS loc_id,
           array_remove(ARRAY[nullif(btrim(loc.abbreviation), ''), nullif(btrim(loc.name), '')], NULL) AS candidates
    FROM public.stock_voucher_lines vl
    JOIN public.stock_locations loc ON loc.id = coalesce(vl.location_id, v.location_id)
    WHERE vl.voucher_id = v.id ORDER BY vl.position, vl.id
  LOOP
    v_movements := v_movements || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'barcode', l.barcode,
      'location_keys', to_jsonb(l.candidates),
      'location_id', l.loc_id,
      'type', CASE v.kind WHEN 'entree' THEN 'in' ELSE 'out' END,
      'quantity', l.quantity,
      'unit_cost', CASE WHEN v.kind = 'entree' AND v.reason = 'reception_sans_commande' AND l.unit_cost > 0 THEN l.unit_cost END,
      'reason', v_short,
      'source_type', 'voucher',
      'source_id', v.id::text
    )));
  END LOOP;
  IF jsonb_array_length(v_movements) = 0 THEN RAISE EXCEPTION 'Emplacement introuvable pour les lignes de ce bon.'; END IF;

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

-- ── Deleting a delivery note or a credit note ────────────────────────────
-- Gives back what the document moved itself, cancels its validated Bon de
-- sortie (stock comes back) and removes a draft one.
DROP FUNCTION IF EXISTS public.reverse_document_stock(uuid, text);
CREATE OR REPLACE FUNCTION public.reverse_document_stock(p_document_id text, p_reference text DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user text := (SELECT u.username FROM public.app_users u WHERE u.id = auth.uid());
  v_company uuid;
  v_ref text := 'Suppression ' || coalesce(nullif(btrim(p_reference), ''), 'document');
  v_count integer := 0;
  vo record;
BEGIN
  IF coalesce(public.stocky_role() NOT IN ('super_admin', 'admin', 'manager', 'facturation'), true) THEN
    RAISE EXCEPTION 'Accès refusé.';
  END IF;
  IF btrim(coalesce(p_document_id, '')) = '' THEN RETURN 0; END IF;

  SELECT company_id INTO v_company FROM public.stock_movements
    WHERE source_id = p_document_id AND source_type <> 'reversal' LIMIT 1;
  IF v_company IS NULL THEN
    SELECT company_id INTO v_company FROM public.stock_vouchers WHERE source_document_id = p_document_id LIMIT 1;
  END IF;
  IF v_company IS NOT NULL AND NOT (public.stocky_writes_all_companies('docs') OR v_company = public.stocky_company_id()) THEN
    RAISE EXCEPTION 'Accès refusé.';
  END IF;

  v_count := public.reverse_stock_source(p_document_id, 'document-delete:' || p_document_id, v_ref, v_company, v_user);

  PERFORM set_config('stocky.voucher_posting', 'on', true);
  FOR vo IN SELECT * FROM public.stock_vouchers WHERE source_document_id = p_document_id AND status <> 'cancelled' FOR UPDATE LOOP
    IF vo.status = 'validated' THEN
      v_count := v_count + public.reverse_stock_source(vo.id::text, 'voucher-cancel:' || vo.id, 'Annulation ' || vo.number || ' (' || v_ref || ')', vo.company_id, v_user);
      UPDATE public.stock_vouchers
        SET status = 'cancelled', cancelled_by = v_user, cancelled_at = now(), cancel_reason = v_ref, updated_at = now()
        WHERE id = vo.id;
    ELSE
      DELETE FROM public.stock_vouchers WHERE id = vo.id;
    END IF;
  END LOOP;
  PERFORM set_config('stocky.voucher_posting', 'off', true);

  RETURN v_count;
END $$;

REVOKE ALL ON FUNCTION public.reverse_document_stock(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_document_stock(text, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
