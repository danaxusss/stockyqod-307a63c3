-- Invoiced stock (stock facturé): the opening quantities it starts from.
--
-- The page "Stock comptable → Stock facturé / réel" counts, per company and
-- product, the quantities bought on supplier invoices minus those sold on
-- the company's sales invoices (plus goods taken back on credit notes), next
-- to the real stock. Supplier invoices were not recorded in Stocky before
-- 20261126120000_supplier_invoices.sql, so the count needs a starting point:
-- the invoiced quantity of each product at the end of a day ("as of"). The
-- count then leaves out every purchase and sale dated on or before that day.
--
-- 1. public.invoiced_stock_openings: one row per company (the opening in
--    force), with its date and who saved it.
-- 2. public.invoiced_stock_opening_lines: quantity per product (barcode).
-- 3. replace_invoiced_stock_opening(company, as_of, lines): replaces the
--    company's opening and all its lines in one transaction (a failed save
--    leaves the previous opening as it was). It runs with the caller's
--    rights: the row rules below apply to it.
--
-- Who: the same people as supplier invoices (super admins, admins,
-- accountants, billing staff), never resellers: these quantities are read
-- next to purchase costs. Read: own company (super admins, billing staff and
-- managers with cross-branch reading: like supplier invoices). Write: own
-- company only (super admins: every company).
--
-- Needs 20261126120000_supplier_invoices.sql (its access helpers) and the
-- secure-login step 3 helpers (20261119130000_role_company_rules.sql).
-- The front end works before this script is run: the count starts from zero
-- and the page says to run it to save an opening.
-- Safe to run more than once. (No nested $-quotes: the Supabase SQL editor
-- rejects them.)

DO $$
BEGIN
  IF to_regprocedure('public.stocky_is_purchase_staff()') IS NULL
     OR to_regprocedure('public.stocky_purchase_in_scope(uuid, boolean)') IS NULL
     OR to_regprocedure('public.stocky_current_user()') IS NULL THEN
    RAISE EXCEPTION 'Exécutez d''abord 20261119130000_role_company_rules.sql puis 20261126120000_supplier_invoices.sql.';
  END IF;
END $$;

-- ── Tables ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.invoiced_stock_openings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  as_of date NOT NULL,
  line_count integer NOT NULL DEFAULT 0,
  saved_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoiced_stock_openings_company_key UNIQUE (company_id)
);

CREATE TABLE IF NOT EXISTS public.invoiced_stock_opening_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opening_id uuid NOT NULL REFERENCES public.invoiced_stock_openings(id) ON DELETE CASCADE,
  barcode text NOT NULL CHECK (btrim(barcode) <> ''),
  -- Any finite quantity: an invoiced stock may be negative (more invoiced
  -- out than in), and the real stock it is often taken from may be too.
  quantity numeric NOT NULL CHECK (quantity <> 'NaN'::numeric),
  CONSTRAINT invoiced_stock_opening_lines_key UNIQUE (opening_id, barcode)
);

-- ── Who may touch them ───────────────────────────────────────────────────
ALTER TABLE public.invoiced_stock_openings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoiced_stock_opening_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stocky_signed_in_only ON public.invoiced_stock_openings;
DROP POLICY IF EXISTS stocky_invoiced_stock_openings_select ON public.invoiced_stock_openings;
DROP POLICY IF EXISTS stocky_invoiced_stock_openings_insert ON public.invoiced_stock_openings;
DROP POLICY IF EXISTS stocky_invoiced_stock_openings_update ON public.invoiced_stock_openings;
DROP POLICY IF EXISTS stocky_invoiced_stock_openings_delete ON public.invoiced_stock_openings;
-- Restrictive: whatever permissive policy is added later, a request without a
-- known Stocky user gets nothing.
CREATE POLICY stocky_signed_in_only ON public.invoiced_stock_openings AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.stocky_is_user())) WITH CHECK ((SELECT public.stocky_is_user()));
CREATE POLICY stocky_invoiced_stock_openings_select ON public.invoiced_stock_openings FOR SELECT TO authenticated
  USING ((SELECT public.stocky_is_purchase_staff()) AND public.stocky_purchase_in_scope(company_id, false));
CREATE POLICY stocky_invoiced_stock_openings_insert ON public.invoiced_stock_openings FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.stocky_is_purchase_staff()) AND public.stocky_purchase_in_scope(company_id, true));
CREATE POLICY stocky_invoiced_stock_openings_update ON public.invoiced_stock_openings FOR UPDATE TO authenticated
  USING ((SELECT public.stocky_is_purchase_staff()) AND public.stocky_purchase_in_scope(company_id, true))
  WITH CHECK ((SELECT public.stocky_is_purchase_staff()) AND public.stocky_purchase_in_scope(company_id, true));
CREATE POLICY stocky_invoiced_stock_openings_delete ON public.invoiced_stock_openings FOR DELETE TO authenticated
  USING ((SELECT public.stocky_is_purchase_staff()) AND public.stocky_purchase_in_scope(company_id, true));

-- Lines follow their opening. Reading: an opening the caller may read.
-- Writing: an opening of a company the caller may WRITE (a billing user who
-- reads every company must not change another company's lines).
DROP POLICY IF EXISTS stocky_signed_in_only ON public.invoiced_stock_opening_lines;
DROP POLICY IF EXISTS stocky_parent_rows_select ON public.invoiced_stock_opening_lines;
DROP POLICY IF EXISTS stocky_parent_rows_insert ON public.invoiced_stock_opening_lines;
DROP POLICY IF EXISTS stocky_parent_rows_update ON public.invoiced_stock_opening_lines;
DROP POLICY IF EXISTS stocky_parent_rows_delete ON public.invoiced_stock_opening_lines;
CREATE POLICY stocky_signed_in_only ON public.invoiced_stock_opening_lines AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.stocky_is_user())) WITH CHECK ((SELECT public.stocky_is_user()));
CREATE POLICY stocky_parent_rows_select ON public.invoiced_stock_opening_lines FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.invoiced_stock_openings o WHERE o.id = opening_id));
CREATE POLICY stocky_parent_rows_insert ON public.invoiced_stock_opening_lines FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.invoiced_stock_openings o WHERE o.id = opening_id
                      AND public.stocky_purchase_in_scope(o.company_id, true)));
CREATE POLICY stocky_parent_rows_update ON public.invoiced_stock_opening_lines FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.invoiced_stock_openings o WHERE o.id = opening_id
                 AND public.stocky_purchase_in_scope(o.company_id, true)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.invoiced_stock_openings o WHERE o.id = opening_id
                      AND public.stocky_purchase_in_scope(o.company_id, true)));
CREATE POLICY stocky_parent_rows_delete ON public.invoiced_stock_opening_lines FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.invoiced_stock_openings o WHERE o.id = opening_id
                 AND public.stocky_purchase_in_scope(o.company_id, true)));

REVOKE ALL ON public.invoiced_stock_openings, public.invoiced_stock_opening_lines FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoiced_stock_openings, public.invoiced_stock_opening_lines TO authenticated;
GRANT ALL ON public.invoiced_stock_openings, public.invoiced_stock_opening_lines TO service_role;

-- ── Replace the opening of a company ─────────────────────────────────────
-- p_lines: [{"barcode": "P1", "quantity": 12}, …]. Zero quantities are not
-- stored (no line means zero). A reference twice, an empty reference or a
-- quantity that is not a number refuses the whole save.
CREATE OR REPLACE FUNCTION public.replace_invoiced_stock_opening(p_company_id uuid, p_as_of date, p_lines jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $fn$
DECLARE
  v_id uuid;
  v_count integer;
  v_bad text;
  v_user text;
BEGIN
  IF p_company_id IS NULL OR p_as_of IS NULL THEN
    RAISE EXCEPTION 'Société et date d''ouverture obligatoires.' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT (public.stocky_is_purchase_staff() AND public.stocky_purchase_in_scope(p_company_id, true)) THEN
    RAISE EXCEPTION 'Accès refusé : l''ouverture du stock facturé de cette société ne peut pas être modifiée avec votre compte.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN
    RAISE EXCEPTION 'Lignes d''ouverture illisibles.' USING ERRCODE = 'check_violation';
  END IF;
  SELECT coalesce(x->>'barcode', '?') INTO v_bad FROM jsonb_array_elements(p_lines) x
   WHERE jsonb_typeof(x) <> 'object' OR nullif(btrim(coalesce(x->>'barcode', '')), '') IS NULL
      OR jsonb_typeof(x->'quantity') IS DISTINCT FROM 'number'
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Ligne d''ouverture invalide (référence « % ») : référence et quantité numérique obligatoires.', v_bad
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT b INTO v_bad FROM (SELECT btrim(x->>'barcode') AS b FROM jsonb_array_elements(p_lines) x) s
   GROUP BY b HAVING count(*) > 1 LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'La référence % figure deux fois dans l''ouverture.', v_bad USING ERRCODE = 'check_violation';
  END IF;

  v_user := (public.stocky_current_user()).username;
  SELECT count(*)::integer INTO v_count FROM jsonb_array_elements(p_lines) x WHERE (x->>'quantity')::numeric <> 0;

  -- One opening per company: the upsert locks its row, so two saves at the
  -- same moment run one after the other and the last one wins whole.
  INSERT INTO public.invoiced_stock_openings (company_id, as_of, line_count, saved_by)
  VALUES (p_company_id, p_as_of, v_count, v_user)
  ON CONFLICT (company_id) DO UPDATE
    SET as_of = EXCLUDED.as_of, line_count = EXCLUDED.line_count, saved_by = EXCLUDED.saved_by, updated_at = now()
  RETURNING id INTO v_id;

  DELETE FROM public.invoiced_stock_opening_lines WHERE opening_id = v_id;
  INSERT INTO public.invoiced_stock_opening_lines (opening_id, barcode, quantity)
  SELECT v_id, btrim(x->>'barcode'), (x->>'quantity')::numeric
    FROM jsonb_array_elements(p_lines) x
   WHERE (x->>'quantity')::numeric <> 0;

  RETURN jsonb_build_object('id', v_id, 'as_of', p_as_of, 'lines', v_count);
END
$fn$;

REVOKE ALL ON FUNCTION public.replace_invoiced_stock_opening(uuid, date, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_invoiced_stock_opening(uuid, date, jsonb) TO authenticated, service_role;

-- PostgREST picks up the new tables and function without a restart.
NOTIFY pgrst, 'reload schema';
