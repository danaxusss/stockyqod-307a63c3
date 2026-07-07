-- ============================================================================
-- PAIE — approfondissement (Phases 1-2)
-- payroll_settings (taux statutaires versionnés), payroll_rubriques (bibliothèque),
-- payslip_variables (éléments variables), payroll_runs (lot mensuel),
-- payroll_cumuls (cumuls), + extensions employees/payslips.
-- ============================================================================

-- ── Paramètres statutaires par société/année ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payroll_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  year INT NOT NULL,
  cnss_rate_emp NUMERIC NOT NULL DEFAULT 0.0448,
  cnss_cap NUMERIC NOT NULL DEFAULT 6000,
  amo_rate_emp NUMERIC NOT NULL DEFAULT 0.0226,
  cnss_rate_er NUMERIC NOT NULL DEFAULT 0.0898,
  af_rate NUMERIC NOT NULL DEFAULT 0.0640,
  amo_rate_er NUMERIC NOT NULL DEFAULT 0.0411,
  tfp_rate NUMERIC NOT NULL DEFAULT 0.0160,
  frais_pro_low NUMERIC NOT NULL DEFAULT 0.35,
  frais_pro_high NUMERIC NOT NULL DEFAULT 0.25,
  frais_pro_threshold NUMERIC NOT NULL DEFAULT 78000,
  frais_pro_cap NUMERIC NOT NULL DEFAULT 35000,
  family_ded_per_dep NUMERIC NOT NULL DEFAULT 500,
  family_ded_max INT NOT NULL DEFAULT 6,
  smig_hourly NUMERIC NOT NULL DEFAULT 17.10,
  conges_days_per_month NUMERIC NOT NULL DEFAULT 1.5,
  ir_brackets JSONB NOT NULL DEFAULT '[[0,40000,0,0],[40000,60000,0.10,4000],[60000,80000,0.20,10000],[80000,100000,0.30,18000],[100000,180000,0.34,22000],[180000,999999999,0.37,27400]]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, year)
);

-- ── Bibliothèque de rubriques ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payroll_rubriques (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('gain', 'retenue')),
  base TEXT NOT NULL DEFAULT 'fixe' CHECK (base IN ('fixe', 'pourcentage_base', 'heures', 'formule')),
  rate NUMERIC NOT NULL DEFAULT 0,
  soumis_cnss BOOLEAN NOT NULL DEFAULT true,
  soumis_amo BOOLEAN NOT NULL DEFAULT true,
  soumis_ir BOOLEAN NOT NULL DEFAULT true,
  soumis_cimr BOOLEAN NOT NULL DEFAULT false,
  inclus_anciennete BOOLEAN NOT NULL DEFAULT false,
  compte_comptable TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);
CREATE INDEX IF NOT EXISTS idx_payroll_rubriques_company ON public.payroll_rubriques(company_id);

-- ── Éléments variables du bulletin ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payslip_variables (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  payslip_id UUID NOT NULL REFERENCES public.payslips(id) ON DELETE CASCADE,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  rubrique_id UUID REFERENCES public.payroll_rubriques(id) ON DELETE SET NULL,
  code TEXT,
  label TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'gain' CHECK (type IN ('gain', 'retenue')),
  quantity NUMERIC NOT NULL DEFAULT 1,
  rate NUMERIC NOT NULL DEFAULT 0,
  amount NUMERIC NOT NULL DEFAULT 0,
  soumis_cnss BOOLEAN NOT NULL DEFAULT true,
  soumis_ir BOOLEAN NOT NULL DEFAULT true,
  soumis_cimr BOOLEAN NOT NULL DEFAULT false,
  inclus_anciennete BOOLEAN NOT NULL DEFAULT false,
  sort_order INT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_payslip_variables_payslip ON public.payslip_variables(payslip_id);

-- ── Lot de paie mensuel ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payroll_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  period_month INT NOT NULL,
  period_year INT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'validated', 'paid')),
  total_gross NUMERIC NOT NULL DEFAULT 0,
  total_net NUMERIC NOT NULL DEFAULT 0,
  total_cnss NUMERIC NOT NULL DEFAULT 0,
  total_ir NUMERIC NOT NULL DEFAULT 0,
  employer_cost NUMERIC NOT NULL DEFAULT 0,
  journal_entry_id UUID REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  created_by TEXT,
  validated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, period_year, period_month)
);

-- ── Cumuls par employé ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payroll_cumuls (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  year INT NOT NULL,
  month INT NOT NULL,
  gross NUMERIC NOT NULL DEFAULT 0,
  taxable NUMERIC NOT NULL DEFAULT 0,
  ir NUMERIC NOT NULL DEFAULT 0,
  cnss_emp NUMERIC NOT NULL DEFAULT 0,
  amo_emp NUMERIC NOT NULL DEFAULT 0,
  cimr NUMERIC NOT NULL DEFAULT 0,
  net NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_id, year, month)
);

-- ── Extensions ──────────────────────────────────────────────────────────────
ALTER TABLE public.payslips ADD COLUMN IF NOT EXISTS tfp_employer NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE public.payslips ADD COLUMN IF NOT EXISTS run_id UUID REFERENCES public.payroll_runs(id) ON DELETE SET NULL;
ALTER TABLE public.payslips ADD COLUMN IF NOT EXISTS is_locked BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS matricule TEXT;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS mode_paiement TEXT NOT NULL DEFAULT 'virement';
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS date_sortie DATE;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS user_id UUID;

-- ── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.payroll_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_rubriques ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payslip_variables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_cumuls ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all payroll_settings" ON public.payroll_settings FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all payroll_rubriques" ON public.payroll_rubriques FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all payslip_variables" ON public.payslip_variables FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all payroll_runs" ON public.payroll_runs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all payroll_cumuls" ON public.payroll_cumuls FOR ALL USING (true) WITH CHECK (true);

CREATE TRIGGER update_payroll_settings_updated_at BEFORE UPDATE ON public.payroll_settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_payroll_rubriques_updated_at BEFORE UPDATE ON public.payroll_rubriques FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_payroll_runs_updated_at BEFORE UPDATE ON public.payroll_runs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
