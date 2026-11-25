-- ============================================================================
-- PAIE — official declaration files: annual salary return (9421, SIMPL-IR
-- XML) and monthly CNSS declaration file (Damancom e-BDS).
--
-- Run by hand in the Supabase SQL editor, after 20261125140000_payroll_2026.sql.
-- Safe to run more than once. The app keeps working before it is run: the
-- declarations page shows what it can, and says this file must be run to keep
-- the employee identity data of the return, the company's commune code and
-- the IR payments. Saving an employee with these fields filled in is refused
-- (rather than silently dropped) until it has run.
-- ============================================================================

-- ── 1. Employees: identity data the salary return needs (CGI art. 79-I) ────
-- Surname and first name are separate elements of the return (full_name is
-- kept for everything else).
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS last_name TEXT;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS first_name TEXT;
-- Personal address (art. 79-I-1°).
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS address TEXT;
-- Residence card number of a foreign employee, in place of the CIN (art. 79-I-2°).
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS residence_card TEXT;
-- The employee's own tax identifier (element "ifu" of the return), if any.
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS tax_id TEXT;
-- Which list of the return the employee goes in. Empty: automatic (a "Stage"
-- contract is a trainee, anyone else permanent staff).
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS dts_category TEXT;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employees_dts_category_check') THEN
    ALTER TABLE public.employees ADD CONSTRAINT employees_dts_category_check
      CHECK (dts_category IS NULL OR dts_category IN ('permanent', 'occasionnel', 'stagiaire', 'exonere_57_20', 'exonere_247'));
  END IF;
END $$;

-- ── 2. Company data of the return that the company settings do not hold ───
-- One row per company. IF, RC, CNSS, patente (TP), address, phone and e-mail
-- stay in the company settings.
CREATE TABLE IF NOT EXISTS public.payroll_declaration_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  -- DGI commune code (Annexe 2 of the specification, e.g. 141.01.01).
  commune_code TEXT,
  fax TEXT,
  -- For a sole trader filing in their own name (nom / prénom / CIN of the
  -- return header); empty for a company, which files under its name.
  taxpayer_last_name TEXT,
  taxpayer_first_name TEXT,
  taxpayer_cin TEXT,
  -- The 2026 annex caps the family field at 3,600: if SIMPL reads it as an
  -- amount rather than a number of dependants, the file can carry the amount.
  family_field_as_amount BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS payroll_declaration_settings_company_key
  ON public.payroll_declaration_settings (company_id);

-- ── 3. Monthly payments of the IR withheld on salaries ─────────────────────
-- Reported in the "état récapitulatif" (listVersements) of the return. A
-- month can be paid in several payments.
CREATE TABLE IF NOT EXISTS public.payroll_ir_payments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  year INT NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  -- Month of the salaries the payment is for.
  month INT NOT NULL CHECK (month BETWEEN 1 AND 12),
  reference TEXT,
  receipt_number TEXT,
  payment_date DATE NOT NULL,
  principal NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (principal >= 0),
  penalty NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (penalty >= 0),
  surcharge NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (surcharge >= 0),
  -- Codes of Annexe 2: ES cash, CH cheque, SIR online payment.
  payment_mode TEXT NOT NULL DEFAULT 'SIR' CHECK (payment_mode IN ('ES', 'CH', 'SIR')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payroll_ir_payments_company_year
  ON public.payroll_ir_payments (company_id, year, month);

-- updated_at kept by the shared trigger function, when it exists.
DO $$
DECLARE
  t text;
BEGIN
  IF to_regprocedure('public.update_updated_at_column()') IS NULL THEN
    RAISE NOTICE 'update_updated_at_column() not found: updated_at is not maintained on the new tables.';
    RETURN;
  END IF;
  FOREACH t IN ARRAY ARRAY['payroll_declaration_settings', 'payroll_ir_payments'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_' || t || '_updated_at') THEN
      EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()',
        'update_' || t || '_updated_at', t);
    END IF;
  END LOOP;
END $$;

-- ── 4. Row rules: the payroll ("strict") company scope ─────────────────────
-- The same rule as the other payroll tables (20261119130000_role_company_rules.sql):
-- super admins everywhere, other users only their own company.
DO $$
DECLARE
  t text;
  r text;
  w text;
BEGIN
  IF to_regprocedure('public.stocky_reads_all_companies(text)') IS NULL
     OR to_regprocedure('public.stocky_writes_all_companies(text)') IS NULL
     OR to_regprocedure('public.stocky_company_id()') IS NULL
     OR to_regprocedure('public.stocky_has_no_company()') IS NULL THEN
    RAISE EXCEPTION 'Run 20261119130000_role_company_rules.sql first: the stocky_* rule functions are missing.';
  END IF;
  r := '((SELECT public.stocky_reads_all_companies(''strict'')) OR company_id = (SELECT public.stocky_company_id())'
    || ' OR (company_id IS NULL AND (SELECT public.stocky_has_no_company())))';
  w := '((SELECT public.stocky_writes_all_companies(''strict'')) OR company_id = (SELECT public.stocky_company_id())'
    || ' OR (company_id IS NULL AND (SELECT public.stocky_has_no_company())))';
  FOREACH t IN ARRAY ARRAY['payroll_declaration_settings', 'payroll_ir_payments'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS stocky_company_select ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS stocky_company_insert ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS stocky_company_update ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS stocky_company_delete ON public.%I', t);
    EXECUTE format('CREATE POLICY stocky_company_select ON public.%I FOR SELECT TO authenticated USING (%s)', t, r);
    EXECUTE format('CREATE POLICY stocky_company_insert ON public.%I FOR INSERT TO authenticated WITH CHECK (%s)', t, w);
    EXECUTE format('CREATE POLICY stocky_company_update ON public.%I FOR UPDATE TO authenticated USING (%s) WITH CHECK (%s)', t, w, w);
    EXECUTE format('CREATE POLICY stocky_company_delete ON public.%I FOR DELETE TO authenticated USING (%s)', t, w);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
  END LOOP;
END $$;

-- Let the API see the new columns and tables at once.
NOTIFY pgrst, 'reload schema';
