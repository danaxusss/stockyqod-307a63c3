-- VAT return (déclaration de TVA) computed from the documents.
--
-- 1. COMPANY SETTINGS (companies, and the legacy company_settings row):
--    - vat_regime: 'encaissement' (the rule, CGI art. 95) or 'debit' (option);
--    - vat_periodicity: 'M' monthly or 'T' quarterly (art. 108), NULL until
--      chosen (the page then proposes one from last year's turnover);
--    - vat_prorata: deduction prorata in % (art. 104), 100 by default;
--    - vat_opening_credit / vat_start_date: the VAT credit carried into the
--      first period declared with Stocky, and the first day of that period.
-- 2. DECLARATIONS (vat_declarations, created by 20260706130000):
--    - snapshot: the figures and every list the return was built from
--      (invoices, settlements, credit notes, supplier payments, relevé de
--      déductions), so that a filed return reads the same later;
--    - credit_precedent, tva_retenue_clients, prorata, period_start,
--      period_end: the main figures as columns, for lists and checks;
--    - filed_by, reopened_at, reopened_by: who filed it, who reopened it.
--    A filed declaration is frozen: its figures and snapshot cannot change,
--    and it cannot be deleted, until it is set back to 'draft' (the page asks
--    for confirmation first). Its credit_report is the credit the next
--    period starts from.
-- No new table: vat_declarations keeps the row-level security set by
-- 20261119130000_role_company_rules.sql ('strict' company scope).
--
-- The front end works before this script is run: it computes and shows the
-- return; saving a declaration or the VAT settings says to run this script.
-- Safe to run more than once. No nested $-quotes.

-- ── 1. Company settings ─────────────────────────────────────────────────
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS vat_regime text NOT NULL DEFAULT 'encaissement';
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS vat_periodicity text;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS vat_prorata numeric NOT NULL DEFAULT 100;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS vat_opening_credit numeric NOT NULL DEFAULT 0;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS vat_start_date date;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'companies_vat_settings_check') THEN
    ALTER TABLE public.companies ADD CONSTRAINT companies_vat_settings_check CHECK (
      vat_regime IN ('encaissement', 'debit')
      AND (vat_periodicity IS NULL OR vat_periodicity IN ('M', 'T'))
      AND vat_prorata > 0 AND vat_prorata <= 100
      AND vat_opening_credit >= 0
      AND (vat_start_date IS NULL OR extract(day FROM vat_start_date) = 1));
  END IF;
  IF to_regclass('public.company_settings') IS NOT NULL THEN
    ALTER TABLE public.company_settings ADD COLUMN IF NOT EXISTS vat_regime text NOT NULL DEFAULT 'encaissement';
    ALTER TABLE public.company_settings ADD COLUMN IF NOT EXISTS vat_periodicity text;
    ALTER TABLE public.company_settings ADD COLUMN IF NOT EXISTS vat_prorata numeric NOT NULL DEFAULT 100;
    ALTER TABLE public.company_settings ADD COLUMN IF NOT EXISTS vat_opening_credit numeric NOT NULL DEFAULT 0;
    ALTER TABLE public.company_settings ADD COLUMN IF NOT EXISTS vat_start_date date;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'company_settings_vat_settings_check') THEN
      ALTER TABLE public.company_settings ADD CONSTRAINT company_settings_vat_settings_check CHECK (
        vat_regime IN ('encaissement', 'debit')
        AND (vat_periodicity IS NULL OR vat_periodicity IN ('M', 'T'))
        AND vat_prorata > 0 AND vat_prorata <= 100
        AND vat_opening_credit >= 0
        AND (vat_start_date IS NULL OR extract(day FROM vat_start_date) = 1));
    END IF;
  END IF;
END $$;

-- ── 2. Declarations ─────────────────────────────────────────────────────
ALTER TABLE public.vat_declarations ADD COLUMN IF NOT EXISTS snapshot jsonb;
ALTER TABLE public.vat_declarations ADD COLUMN IF NOT EXISTS credit_precedent numeric NOT NULL DEFAULT 0;
ALTER TABLE public.vat_declarations ADD COLUMN IF NOT EXISTS tva_retenue_clients numeric NOT NULL DEFAULT 0;
ALTER TABLE public.vat_declarations ADD COLUMN IF NOT EXISTS prorata numeric NOT NULL DEFAULT 100;
ALTER TABLE public.vat_declarations ADD COLUMN IF NOT EXISTS period_start date;
ALTER TABLE public.vat_declarations ADD COLUMN IF NOT EXISTS period_end date;
ALTER TABLE public.vat_declarations ADD COLUMN IF NOT EXISTS filed_by text;
ALTER TABLE public.vat_declarations ADD COLUMN IF NOT EXISTS reopened_at timestamptz;
ALTER TABLE public.vat_declarations ADD COLUMN IF NOT EXISTS reopened_by text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vat_declarations_figures_check') THEN
    ALTER TABLE public.vat_declarations ADD CONSTRAINT vat_declarations_figures_check CHECK (
      prorata > 0 AND prorata <= 100
      AND tva_due >= 0 AND credit_report >= 0 AND credit_precedent >= 0
      AND (period_start IS NULL OR period_end IS NULL OR period_start <= period_end)) NOT VALID;
  END IF;
END $$;

-- A filed declaration stays as filed: no change to what was declared and no
-- deletion until it is reopened (status back to 'draft').
CREATE OR REPLACE FUNCTION public.stocky_vat_declaration_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Deleting the company itself still cascades (its row is gone by then).
    IF OLD.status = 'filed' AND EXISTS (SELECT 1 FROM public.companies c WHERE c.id = OLD.company_id) THEN
      RAISE EXCEPTION 'Déclaration de TVA % déposée : rouvrez-la avant de la supprimer.', OLD.period USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'filed' AND NEW.status = 'filed' AND (
       NEW.snapshot IS DISTINCT FROM OLD.snapshot
    OR NEW.period IS DISTINCT FROM OLD.period
    OR NEW.period_type IS DISTINCT FROM OLD.period_type
    OR NEW.regime IS DISTINCT FROM OLD.regime
    OR NEW.tva_facturee IS DISTINCT FROM OLD.tva_facturee
    OR NEW.tva_recuperable_biens IS DISTINCT FROM OLD.tva_recuperable_biens
    OR NEW.tva_recuperable_charges IS DISTINCT FROM OLD.tva_recuperable_charges
    OR NEW.tva_due IS DISTINCT FROM OLD.tva_due
    OR NEW.credit_report IS DISTINCT FROM OLD.credit_report
    OR NEW.credit_precedent IS DISTINCT FROM OLD.credit_precedent
    OR NEW.tva_retenue_clients IS DISTINCT FROM OLD.tva_retenue_clients
    OR NEW.prorata IS DISTINCT FROM OLD.prorata
    OR NEW.company_id IS DISTINCT FROM OLD.company_id) THEN
    RAISE EXCEPTION 'Déclaration de TVA % déposée : rouvrez-la avant de la modifier.', OLD.period USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.stocky_vat_declaration_guard() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS stocky_vat_declaration_guard ON public.vat_declarations;
CREATE TRIGGER stocky_vat_declaration_guard BEFORE UPDATE OR DELETE ON public.vat_declarations
  FOR EACH ROW EXECUTE FUNCTION public.stocky_vat_declaration_guard();
