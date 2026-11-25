-- ============================================================================
-- PAIE — RH : solde de tout compte, stagiaires (ANAPEC), congés et jours
-- fériés, attestations numérotées, paiement des lots.
--
-- Run by hand in the Supabase SQL editor, after 20261125140000_payroll_2026.sql.
-- Safe to run more than once. The app keeps working before it is run:
--   • leave: the fixed civil holidays and Sunday as rest day are used, nothing
--     of the holidays / rest day / opening balances can be saved;
--   • final settlements are computed and printed (provisional), not saved;
--   • certificates get a provisional number, not registered;
--   • "Marquer comme payé" sets the status, without the date and mode;
--   • a trainee ("Stage") cannot be saved (the old CHECK refuses it);
--   • loan repayments are not kept per payslip ("Dévalider" then warns).
--
-- New tables follow the company rules of 20261119130000_role_company_rules.sql
-- (payroll = 'strict' scope: own company only, super admins everywhere). On a
-- database where that migration has not been run, they get the step-2 rule
-- (any signed-in user), like every other table there.
-- ============================================================================

-- ── 1. Employees: trainee contract ─────────────────────────────────────────
-- The CHECK on contract_type was created inline (name chosen by Postgres):
-- every CHECK of the table that mentions contract_type is replaced by one
-- named constraint that also accepts 'Stage'.
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.employees'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%contract_type%'
  LOOP
    EXECUTE format('ALTER TABLE public.employees DROP CONSTRAINT %I', c.conname);
  END LOOP;
  ALTER TABLE public.employees ADD CONSTRAINT employees_contract_type_check
    CHECK (contract_type IN ('CDI', 'CDD', 'Interim', 'Stage'));
END $$;

-- First day of the internship (the IR and CNSS periods start there); empty = hire date.
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS stage_start_date DATE;
-- CNSS and training tax not due for the trainee (ANAPEC contract; to confirm
-- with the CNSS). Empty = on for a trainee.
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS stage_cnss_exempt BOOLEAN;

-- ── 2. Leave requests: unjustified absence, sick leave paid anyway ─────────
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.leave_requests'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%type%' AND pg_get_constraintdef(oid) ILIKE '%sans_solde%'
  LOOP
    EXECUTE format('ALTER TABLE public.leave_requests DROP CONSTRAINT %I', c.conname);
  END LOOP;
  ALTER TABLE public.leave_requests ADD CONSTRAINT leave_requests_type_check
    CHECK (type IN ('paye', 'maladie', 'sans_solde', 'exceptionnel', 'absence', 'autre'));
END $$;
ALTER TABLE public.leave_requests ADD COLUMN IF NOT EXISTS pay_maintained BOOLEAN NOT NULL DEFAULT false;

-- ── 3. Payroll runs: when and how they were paid ───────────────────────────
ALTER TABLE public.payroll_runs ADD COLUMN IF NOT EXISTS paid_at DATE;
ALTER TABLE public.payroll_runs ADD COLUMN IF NOT EXISTS payment_mode TEXT;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payroll_runs_payment_mode_check') THEN
    ALTER TABLE public.payroll_runs ADD CONSTRAINT payroll_runs_payment_mode_check
      CHECK (payment_mode IS NULL OR payment_mode IN ('virement', 'cheque', 'especes'));
  END IF;
END $$;

-- ── 4. Payslips: loan repayments applied at validation ─────────────────────
-- [{"loan_id": …, "amount": …}], so un-validating gives back exactly that.
ALTER TABLE public.payslips ADD COLUMN IF NOT EXISTS loan_repayments JSONB;

-- ── 5. New tables ──────────────────────────────────────────────────────────
-- Paid public holidays, per company and year (civil ones pre-filled by the
-- app, religious ones entered when announced).
CREATE TABLE IF NOT EXISTS public.public_holidays (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  year INT NOT NULL,
  holiday_date DATE NOT NULL,
  label TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'civil' CHECK (kind IN ('civil', 'religieux')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (extract(year FROM holiday_date) = year),
  UNIQUE (company_id, holiday_date)
);
CREATE INDEX IF NOT EXISTS idx_public_holidays_company_year ON public.public_holidays(company_id, year);

-- Company HR settings: the weekly rest day (0 = Sunday … 6 = Saturday).
CREATE TABLE IF NOT EXISTS public.payroll_hr_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL UNIQUE REFERENCES public.companies(id) ON DELETE CASCADE,
  weekly_rest_day INT NOT NULL DEFAULT 0 CHECK (weekly_rest_day BETWEEN 0 AND 6),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Opening paid-leave balance of an employee for a year (first year of use);
-- later years carry the previous balance.
CREATE TABLE IF NOT EXISTS public.leave_opening_balances (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  year INT NOT NULL,
  days NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_id, year)
);
CREATE INDEX IF NOT EXISTS idx_leave_opening_balances_company ON public.leave_opening_balances(company_id);

-- Final settlements (solde de tout compte), numbered STC-YYYY-NNN, with what
-- was entered and what was computed; validated into the final payslip.
CREATE TABLE IF NOT EXISTS public.payroll_stc (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  number TEXT NOT NULL,
  motif TEXT NOT NULL CHECK (motif IN ('licenciement', 'faute_grave', 'demission', 'fin_cdd', 'depart_negocie', 'retraite', 'deces')),
  exit_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'validated', 'cancelled', 'reversed')),
  inputs JSONB NOT NULL DEFAULT '{}'::jsonb,
  results JSONB NOT NULL DEFAULT '{}'::jsonb,
  payslip_id UUID REFERENCES public.payslips(id) ON DELETE SET NULL,
  payslip_created BOOLEAN NOT NULL DEFAULT false,
  previous JSONB,
  created_by TEXT,
  validated_at TIMESTAMPTZ,
  validated_by TEXT,
  reversed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, number)
);
CREATE INDEX IF NOT EXISTS idx_payroll_stc_company ON public.payroll_stc(company_id);
-- One open settlement (draft or validated) per employee.
CREATE UNIQUE INDEX IF NOT EXISTS payroll_stc_one_open_per_employee
  ON public.payroll_stc(employee_id) WHERE status IN ('draft', 'validated');

-- Issued certificates, numbered ATT- / ATS- / CT-YYYY-NNN.
CREATE TABLE IF NOT EXISTS public.hr_documents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('attestation_travail', 'attestation_salaire', 'certificat_travail')),
  year INT NOT NULL,
  number TEXT NOT NULL,
  issued_on DATE NOT NULL DEFAULT current_date,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, number)
);
CREATE INDEX IF NOT EXISTS idx_hr_documents_company ON public.hr_documents(company_id);

DROP TRIGGER IF EXISTS update_payroll_hr_settings_updated_at ON public.payroll_hr_settings;
CREATE TRIGGER update_payroll_hr_settings_updated_at BEFORE UPDATE ON public.payroll_hr_settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS update_leave_opening_balances_updated_at ON public.leave_opening_balances;
CREATE TRIGGER update_leave_opening_balances_updated_at BEFORE UPDATE ON public.leave_opening_balances FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS update_payroll_stc_updated_at ON public.payroll_stc;
CREATE TRIGGER update_payroll_stc_updated_at BEFORE UPDATE ON public.payroll_stc FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── 6. Row rules and rights ────────────────────────────────────────────────
-- With the company rules installed (their helpers stocky_reads_all_companies,
-- stocky_writes_all_companies, stocky_company_id, stocky_has_no_company are
-- kept by that migration; its policy builder is not), each new table gets the
-- same four stocky_company_* policies as the other payroll tables, built
-- exactly as stocky_scope_sql('strict', …) builds them. The table is also
-- registered for the undo script of 20261119130000, with "any signed-in user"
-- as the rule to restore (what step 2 gives every table).
DO $$
DECLARE
  t text;
  pol record;
  r text := '((SELECT public.stocky_reads_all_companies(''strict'')) OR company_id = (SELECT public.stocky_company_id()) OR (company_id IS NULL AND (SELECT public.stocky_has_no_company())))';
  w text := '((SELECT public.stocky_writes_all_companies(''strict'')) OR company_id = (SELECT public.stocky_company_id()) OR (company_id IS NULL AND (SELECT public.stocky_has_no_company())))';
  has_rules boolean := to_regprocedure('public.stocky_reads_all_companies(text)') IS NOT NULL
                   AND to_regprocedure('public.stocky_writes_all_companies(text)') IS NOT NULL
                   AND to_regprocedure('public.stocky_company_id()') IS NOT NULL
                   AND to_regprocedure('public.stocky_has_no_company()') IS NOT NULL;
  has_backup boolean := to_regclass('stocky_backup.role_company_rules_tables') IS NOT NULL
                    AND to_regclass('stocky_backup.role_company_rules_policies') IS NOT NULL;
  has_roles boolean := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated');
BEGIN
  FOREACH t IN ARRAY ARRAY['public_holidays', 'payroll_hr_settings', 'leave_opening_balances', 'payroll_stc', 'hr_documents'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    IF NOT has_roles THEN
      CONTINUE;
    END IF;
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, PUBLIC', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    END IF;
    -- Start from no permissive policy (a re-run replaces its own).
    FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND permissive = 'PERMISSIVE' LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', pol.policyname, t);
    END LOOP;
    IF has_rules THEN
      EXECUTE format('CREATE POLICY stocky_company_select ON public.%I FOR SELECT TO authenticated USING (%s)', t, r);
      EXECUTE format('CREATE POLICY stocky_company_insert ON public.%I FOR INSERT TO authenticated WITH CHECK (%s)', t, w);
      EXECUTE format('CREATE POLICY stocky_company_update ON public.%I FOR UPDATE TO authenticated USING (%s) WITH CHECK (%s)', t, w, w);
      EXECUTE format('CREATE POLICY stocky_company_delete ON public.%I FOR DELETE TO authenticated USING (%s)', t, w);
      IF has_backup THEN
        INSERT INTO stocky_backup.role_company_rules_tables (table_name) VALUES (t) ON CONFLICT DO NOTHING;
        INSERT INTO stocky_backup.role_company_rules_policies (tablename, policyname, permissive, roles, cmd, qual, with_check)
        VALUES (t, 'stocky_signed_in', 'PERMISSIVE', ARRAY['authenticated']::name[], 'ALL', 'true', 'true') ON CONFLICT DO NOTHING;
      END IF;
    ELSE
      RAISE NOTICE '%: company rules (20261119130000_role_company_rules.sql) not found, any signed-in user can use it', t;
      EXECUTE format('CREATE POLICY stocky_signed_in ON public.%I AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true)', t);
    END IF;
  END LOOP;
END $$;

-- Let the API see the new tables and columns at once.
NOTIFY pgrst, 'reload schema';
