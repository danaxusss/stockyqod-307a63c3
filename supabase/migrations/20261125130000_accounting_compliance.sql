-- Accounting compliance (CGNC, CGI, CNC avis n° 24).
--
-- Safe to run more than once, and after the front-end is deployed: the app
-- works without it (it adds missing seed accounts itself when it needs
-- them, and sends the passenger-car flag only when it is set).
--
-- 1. Accounts the seed now includes are added to every existing chart:
--    1199 (loss of the year), 2332, 2822, 3453, 3456, 4453, 4457, 6119,
--    6192, 6193, 6701, 7119. Existing accounts are never changed.
-- 2. The collected-VAT accounts at 14 % (44552) and 7 % (44557) are made
--    inactive where no entry line uses them: VAT has two rates (20 %, 10 %)
--    since 1 January 2026. Accounts with history stay active.
-- 3. fixed_assets.passenger_car: "voiture de tourisme" (tax-deductible
--    depreciation capped, CGI art. 10-I-F-1°-b).
-- 4. Guards, in the database as in the app:
--    • at most two open fiscal years (CNC avis 24 §2.3-d);
--    • a fiscal year that holds entries cannot be deleted (its entries
--      would be deleted with it);
--    • an account used by entry lines cannot be deleted, deactivated or
--      have its code changed (avis 24 §2.6);
--    • an asset with a booked dotation cannot be deleted.
--    Deletes cascading from a company (trigger depth > 1) pass, as in
--    20261030120000_accounting_integrity.sql.
-- 5. Last statement: how many existing assets of class 23 (22) are charged
--    to 6191 (non-valeurs) instead of 6193 (6192). They are not changed;
--    the Immobilisations page shows a hint on each.

-- ── 1. New accounts in existing charts ────────────────────────────────────
INSERT INTO public.accounts (company_id, code, label, class, type, is_system)
SELECT c.company_id, v.code, v.label, v.class, v.type, true
FROM (SELECT DISTINCT company_id FROM public.accounts) c
CROSS JOIN (VALUES
  ('1199', 'Résultat net de l''exercice (solde débiteur)', 1, 'bilan_passif'),
  ('2332', 'Matériel et outillage', 2, 'bilan_actif'),
  ('2822', 'Amort. brevets, marques, droits et valeurs similaires', 2, 'bilan_actif'),
  ('3453', 'État - acomptes sur impôts sur les résultats', 3, 'bilan_actif'),
  ('3456', 'État - crédit de TVA (suivant déclarations)', 3, 'bilan_actif'),
  ('4453', 'État - impôts sur les résultats', 4, 'bilan_passif'),
  ('4457', 'État - impôts et taxes à payer', 4, 'bilan_passif'),
  ('6119', 'Rabais, remises et ristournes obtenus sur achats de marchandises', 6, 'charge'),
  ('6192', 'D.E.A. des immobilisations incorporelles', 6, 'charge'),
  ('6193', 'D.E.A. des immobilisations corporelles', 6, 'charge'),
  ('6701', 'Impôts sur les bénéfices', 6, 'charge'),
  ('7119', 'Rabais, remises et ristournes accordés par l''entreprise', 7, 'produit')
) AS v(code, label, class, type)
ON CONFLICT (company_id, code) DO NOTHING;

-- ── 2. 14 % and 7 % VAT accounts without history ──────────────────────────
UPDATE public.accounts a
   SET active = false
 WHERE a.code IN ('44552', '44557')
   AND a.active
   AND NOT EXISTS (
     SELECT 1 FROM public.journal_entry_lines l
       JOIN public.journal_entries e ON e.id = l.entry_id
      WHERE l.account_code = a.code AND e.company_id = a.company_id
   );

-- ── 3. Passenger cars ─────────────────────────────────────────────────────
ALTER TABLE public.fixed_assets ADD COLUMN IF NOT EXISTS passenger_car BOOLEAN NOT NULL DEFAULT false;

-- ── 4a. Fiscal years: two open at most; no delete with entries ────────────
CREATE OR REPLACE FUNCTION public.guard_fiscal_year()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_open INT;
  v_oldest TEXT;
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM public.journal_entries WHERE fiscal_year_id = OLD.id) THEN
      RAISE EXCEPTION 'L''exercice % contient des écritures : il ne peut pas être supprimé', OLD.label;
    END IF;
    RETURN OLD;
  END IF;
  -- Opening a year (insert, or reopening a closed one).
  IF NEW.status = 'open' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'open') THEN
    SELECT COUNT(*), MIN(label) INTO v_open, v_oldest
      FROM public.accounting_fiscal_years
     WHERE company_id = NEW.company_id AND status = 'open' AND id <> NEW.id;
    IF v_open >= 2 THEN
      RAISE EXCEPTION 'Clôturez l''exercice % avant d''ouvrir l''exercice % : deux exercices au plus peuvent être ouverts', v_oldest, NEW.label;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_fiscal_year ON public.accounting_fiscal_years;
CREATE TRIGGER guard_fiscal_year
  BEFORE INSERT OR UPDATE OR DELETE ON public.accounting_fiscal_years
  FOR EACH ROW EXECUTE FUNCTION public.guard_fiscal_year();

-- ── 4b. Accounts used by entry lines ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.guard_account()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_used BOOLEAN;
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.code IS NOT DISTINCT FROM OLD.code
     AND NEW.company_id IS NOT DISTINCT FROM OLD.company_id
     AND NOT (OLD.active AND NOT NEW.active) THEN
    RETURN NEW;
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.journal_entry_lines l
      JOIN public.journal_entries e ON e.id = l.entry_id
     WHERE l.account_code = OLD.code AND e.company_id = OLD.company_id
  ) INTO v_used;
  IF v_used THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Le compte % a des écritures : il ne peut pas être supprimé', OLD.code;
    END IF;
    RAISE EXCEPTION 'Le compte % a des écritures : il ne peut être ni désactivé ni renuméroté', OLD.code;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS guard_account ON public.accounts;
CREATE TRIGGER guard_account
  BEFORE UPDATE OR DELETE ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION public.guard_account();

-- ── 4c. Assets with a booked dotation ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.guard_fixed_asset()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN OLD; END IF;
  IF EXISTS (SELECT 1 FROM public.fixed_asset_depreciations WHERE asset_id = OLD.id AND entry_id IS NOT NULL)
     OR EXISTS (SELECT 1 FROM public.journal_entries WHERE source_type = 'depreciation' AND source_id LIKE 'amort:' || OLD.id::text || ':%') THEN
    RAISE EXCEPTION 'Des dotations ont été comptabilisées pour l''immobilisation « % » : elle ne peut pas être supprimée', OLD.label;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS guard_fixed_asset ON public.fixed_assets;
CREATE TRIGGER guard_fixed_asset
  BEFORE DELETE ON public.fixed_assets
  FOR EACH ROW EXECUTE FUNCTION public.guard_fixed_asset();

-- ── 5. Report: assets charged to 6191 that are not non-valeurs (left as they are) ──
SELECT COUNT(*) FILTER (WHERE account_code LIKE '23%') AS assets_corporelles_sur_6191,
       COUNT(*) FILTER (WHERE account_code LIKE '22%') AS assets_incorporelles_sur_6191
  FROM public.fixed_assets
 WHERE expense_account_code = '6191';
