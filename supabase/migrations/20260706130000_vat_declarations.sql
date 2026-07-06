-- ============================================================================
-- Comptabilité Phase 3: TVA declarations (déclaration de TVA)
-- Persists the periodic TVA computation (facturée, récupérable, due / crédit).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.vat_declarations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  fiscal_year_id UUID REFERENCES public.accounting_fiscal_years(id) ON DELETE SET NULL,
  period_type TEXT NOT NULL DEFAULT 'M' CHECK (period_type IN ('M', 'T')),
  period TEXT NOT NULL,                       -- e.g. 2026-03 (month) or 2026-T1
  regime TEXT NOT NULL DEFAULT 'encaissement' CHECK (regime IN ('debit', 'encaissement')),
  tva_facturee NUMERIC NOT NULL DEFAULT 0,
  tva_recuperable_biens NUMERIC NOT NULL DEFAULT 0,
  tva_recuperable_charges NUMERIC NOT NULL DEFAULT 0,
  tva_due NUMERIC NOT NULL DEFAULT 0,
  credit_report NUMERIC NOT NULL DEFAULT 0,
  entry_id UUID REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'filed')),
  filed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, period)
);

CREATE INDEX IF NOT EXISTS idx_vat_declarations_company ON public.vat_declarations(company_id);

ALTER TABLE public.vat_declarations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all vat_declarations" ON public.vat_declarations FOR ALL USING (true) WITH CHECK (true);

CREATE TRIGGER update_vat_declarations_updated_at BEFORE UPDATE ON public.vat_declarations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
