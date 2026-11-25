-- ============================================================================
-- PAIE 2026 — official 2026 values, separate IR / CNSS / AMO / CIMR bases,
-- exemption ceilings, employer CIMR, IR regularisation, CNSS days.
--
-- Run by hand in the Supabase SQL editor. Safe to run more than once. The app
-- keeps working before it is run (writes are retried without the new
-- columns), but until then it cannot store: exemption ceilings, the AMO flag
-- and hours of payslip lines, the employer CIMR share, the IR regularisation,
-- the taxable figures and the CNSS days of a payslip.
--
-- No new table: the existing row rules (20261119130000_role_company_rules.sql)
-- cover the new columns.
-- ============================================================================

-- ── 1. Official values for 2026 ─────────────────────────────────────────────
-- Family deduction 600 MAD per dependant (finance law 2026, CGI art. 74-I,
-- income from 1 January 2026) and SMIG 17.92 MAD/h from 1 January 2026.
ALTER TABLE public.payroll_settings ALTER COLUMN family_ded_per_dep SET DEFAULT 600;
ALTER TABLE public.payroll_settings ALTER COLUMN smig_hourly SET DEFAULT 17.92;

-- Saved 2026+ settings still holding the 2025 values move to the 2026 ones.
-- A value changed on purpose to something else is left alone.
UPDATE public.payroll_settings SET family_ded_per_dep = 600
 WHERE year >= 2026 AND family_ded_per_dep = 500;
UPDATE public.payroll_settings SET smig_hourly = 17.92
 WHERE year >= 2026 AND smig_hourly = 17.10;

-- ── 2. Exemption ceilings on rubriques ──────────────────────────────────────
-- A ceiling is a monthly amount or a percentage of the base salary; the part
-- of a line above it joins the IR (or CNSS / AMO) base.
ALTER TABLE public.payroll_rubriques ADD COLUMN IF NOT EXISTS ir_ceiling_type TEXT
  CHECK (ir_ceiling_type IN ('amount', 'percent'));
ALTER TABLE public.payroll_rubriques ADD COLUMN IF NOT EXISTS ir_ceiling_value NUMERIC;
ALTER TABLE public.payroll_rubriques ADD COLUMN IF NOT EXISTS cnss_ceiling_type TEXT
  CHECK (cnss_ceiling_type IN ('amount', 'percent'));
ALTER TABLE public.payroll_rubriques ADD COLUMN IF NOT EXISTS cnss_ceiling_value NUMERIC;

-- The default allowances get their 2026 ceilings, unless the company already
-- made them subject or set a ceiling itself.
UPDATE public.payroll_rubriques
   SET ir_ceiling_type = 'amount', ir_ceiling_value = 500, cnss_ceiling_type = 'amount', cnss_ceiling_value = 500
 WHERE code = 'IND_TRANSPORT' AND ir_ceiling_type IS NULL AND cnss_ceiling_type IS NULL
   AND soumis_ir = false AND soumis_cnss = false;
-- Meal allowance: 2 × hourly SMIG (17.92) × 26 days.
UPDATE public.payroll_rubriques
   SET ir_ceiling_type = 'amount', ir_ceiling_value = 931.84, cnss_ceiling_type = 'amount', cnss_ceiling_value = 931.84
 WHERE code = 'IND_PANIER' AND ir_ceiling_type IS NULL AND cnss_ceiling_type IS NULL
   AND soumis_ir = false AND soumis_cnss = false;
UPDATE public.payroll_rubriques
   SET ir_ceiling_type = 'percent', ir_ceiling_value = 10, cnss_ceiling_type = 'percent', cnss_ceiling_value = 10
 WHERE code = 'IND_REPR' AND ir_ceiling_type IS NULL AND cnss_ceiling_type IS NULL
   AND soumis_ir = false AND soumis_cnss = false;

-- ── 3. Payslip lines: AMO flag, how the amount is computed, ceilings ───────
ALTER TABLE public.payslip_variables ADD COLUMN IF NOT EXISTS soumis_amo BOOLEAN;
-- Before this column AMO followed CNSS.
UPDATE public.payslip_variables SET soumis_amo = soumis_cnss WHERE soumis_amo IS NULL;
ALTER TABLE public.payslip_variables ALTER COLUMN soumis_amo SET DEFAULT true;
ALTER TABLE public.payslip_variables ALTER COLUMN soumis_amo SET NOT NULL;
ALTER TABLE public.payslip_variables ADD COLUMN IF NOT EXISTS base TEXT NOT NULL DEFAULT 'fixe'
  CHECK (base IN ('fixe', 'pourcentage_base', 'heures', 'formule'));
ALTER TABLE public.payslip_variables ADD COLUMN IF NOT EXISTS ir_ceiling_type TEXT
  CHECK (ir_ceiling_type IN ('amount', 'percent'));
ALTER TABLE public.payslip_variables ADD COLUMN IF NOT EXISTS ir_ceiling_value NUMERIC;
ALTER TABLE public.payslip_variables ADD COLUMN IF NOT EXISTS cnss_ceiling_type TEXT
  CHECK (cnss_ceiling_type IN ('amount', 'percent'));
ALTER TABLE public.payslip_variables ADD COLUMN IF NOT EXISTS cnss_ceiling_value NUMERIC;

-- ── 4. Payslips ─────────────────────────────────────────────────────────────
-- Employer CIMR share.
ALTER TABLE public.payslips ADD COLUMN IF NOT EXISTS cimr_employer NUMERIC(12,2) NOT NULL DEFAULT 0;
-- IR taxable gross and net taxable salary, for the annual tax return. Left
-- empty on older payslips (the app works them out from their lines).
ALTER TABLE public.payslips ADD COLUMN IF NOT EXISTS ir_taxable_gross NUMERIC(12,2);
ALTER TABLE public.payslips ADD COLUMN IF NOT EXISTS net_taxable NUMERIC(12,2);
-- Uncapped CNSS and AMO bases (the 6,000 cap applies to the CNSS branches only).
ALTER TABLE public.payslips ADD COLUMN IF NOT EXISTS cnss_base NUMERIC(12,2);
ALTER TABLE public.payslips ADD COLUMN IF NOT EXISTS amo_base NUMERIC(12,2);
-- Days declared to the CNSS (26 for a full month).
ALTER TABLE public.payslips ADD COLUMN IF NOT EXISTS cnss_days INT NOT NULL DEFAULT 26
  CHECK (cnss_days BETWEEN 0 AND 31);
-- Dependants used on the payslip, so a later change does not alter it.
ALTER TABLE public.payslips ADD COLUMN IF NOT EXISTS dependents_count INT;
-- IR regularisation applied on the payslip (positive: IR given back) and the
-- validated payslips it covers. ir_amount is the IR withheld net of it.
ALTER TABLE public.payslips ADD COLUMN IF NOT EXISTS ir_regularisation NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.payslips ADD COLUMN IF NOT EXISTS ir_regularisation_ids JSONB NOT NULL DEFAULT '[]'::jsonb;

-- One payslip per employee and month. Created only when no duplicate exists
-- yet; otherwise a notice names the count and the app keeps refusing new ones.
DO $$
DECLARE
  dups int;
BEGIN
  IF to_regclass('public.payslips_employee_period_key') IS NOT NULL THEN
    RETURN;
  END IF;
  SELECT count(*) INTO dups FROM (
    SELECT 1 FROM public.payslips GROUP BY employee_id, period_year, period_month HAVING count(*) > 1
  ) d;
  IF dups = 0 THEN
    CREATE UNIQUE INDEX payslips_employee_period_key ON public.payslips (employee_id, period_year, period_month);
  ELSE
    RAISE NOTICE '% employee/month pair(s) have more than one payslip: unique index not created. Delete the extra payslips and run this file again.', dups;
  END IF;
END $$;

-- ── 5. Employees: employer CIMR rate (empty = same as the employee rate) ───
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS cimr_employer_rate NUMERIC(5,2);

-- ── 6. Cumuls: IR taxable gross next to the net taxable salary ─────────────
-- payroll_cumuls.taxable now holds the net taxable salary (it held total
-- gross minus professional expenses).
ALTER TABLE public.payroll_cumuls ADD COLUMN IF NOT EXISTS taxable_gross NUMERIC;

-- Let the API see the new columns at once.
NOTIFY pgrst, 'reload schema';
