-- PAIE: employees, payslips, payslip_items tables

CREATE TABLE public.employees (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  cin TEXT,
  gender TEXT CHECK (gender IN ('M', 'F')),
  birth_date DATE,
  marital_status TEXT CHECK (marital_status IN ('celibataire', 'marie', 'divorce', 'veuf')),
  dependents_count INT NOT NULL DEFAULT 0,
  position TEXT,
  department TEXT,
  contract_type TEXT NOT NULL DEFAULT 'CDI' CHECK (contract_type IN ('CDI', 'CDD', 'Interim')),
  cnss_number TEXT,
  cimr_number TEXT,
  cimr_rate NUMERIC(5,2) DEFAULT 0,
  bank_iban TEXT,
  hire_date DATE,
  base_salary NUMERIC(12,2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.payslips (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  period_month INT NOT NULL,
  period_year INT NOT NULL,
  payslip_number TEXT NOT NULL,
  hours_worked NUMERIC(6,2) NOT NULL DEFAULT 191,
  base_salary NUMERIC(12,2) NOT NULL DEFAULT 0,
  anciennete_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
  anciennete_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  other_earnings NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_gross NUMERIC(12,2) NOT NULL DEFAULT 0,
  cnss_employee NUMERIC(12,2) NOT NULL DEFAULT 0,
  amo_employee NUMERIC(12,2) NOT NULL DEFAULT 0,
  cimr_employee NUMERIC(12,2) NOT NULL DEFAULT 0,
  frais_pro NUMERIC(12,2) NOT NULL DEFAULT 0,
  ir_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  other_deductions NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_deductions NUMERIC(12,2) NOT NULL DEFAULT 0,
  net_salary NUMERIC(12,2) NOT NULL DEFAULT 0,
  cnss_employer NUMERIC(12,2) NOT NULL DEFAULT 0,
  amo_employer NUMERIC(12,2) NOT NULL DEFAULT 0,
  alloc_familiales NUMERIC(12,2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.payslip_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  payslip_id UUID NOT NULL REFERENCES public.payslips(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  item_type TEXT NOT NULL CHECK (item_type IN ('earning', 'deduction')),
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  included_in_anciennete_base BOOLEAN NOT NULL DEFAULT false,
  sort_order INT NOT NULL DEFAULT 0
);

ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payslips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payslip_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all employees" ON public.employees FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all payslips" ON public.payslips FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all payslip_items" ON public.payslip_items FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX idx_employees_company_id ON public.employees(company_id);
CREATE INDEX idx_payslips_company_id ON public.payslips(company_id);
CREATE INDEX idx_payslips_employee_id ON public.payslips(employee_id);
CREATE INDEX idx_payslip_items_payslip_id ON public.payslip_items(payslip_id);

CREATE TRIGGER update_employees_updated_at
  BEFORE UPDATE ON public.employees
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_payslips_updated_at
  BEFORE UPDATE ON public.payslips
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
