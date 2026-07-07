-- ============================================================================
-- Comptabilité Phase 4c: immobilisations & amortissements
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.fixed_assets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  account_code TEXT NOT NULL DEFAULT '2340',        -- immobilisation (classe 2)
  acquisition_date DATE NOT NULL,
  amount NUMERIC NOT NULL DEFAULT 0,
  method TEXT NOT NULL DEFAULT 'lineaire' CHECK (method IN ('lineaire', 'degressif')),
  duration_years INT NOT NULL DEFAULT 5,
  salvage NUMERIC NOT NULL DEFAULT 0,
  depreciation_account_code TEXT NOT NULL DEFAULT '2834',   -- amortissements (28x)
  expense_account_code TEXT NOT NULL DEFAULT '6191',        -- dotations (619x)
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fixed_assets_company ON public.fixed_assets(company_id);

CREATE TABLE IF NOT EXISTS public.fixed_asset_depreciations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  asset_id UUID NOT NULL REFERENCES public.fixed_assets(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  year INT NOT NULL,
  amount NUMERIC NOT NULL DEFAULT 0,
  entry_id UUID REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (asset_id, year)
);

ALTER TABLE public.fixed_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fixed_asset_depreciations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all fixed_assets" ON public.fixed_assets FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all fixed_asset_depreciations" ON public.fixed_asset_depreciations FOR ALL USING (true) WITH CHECK (true);

CREATE TRIGGER update_fixed_assets_updated_at BEFORE UPDATE ON public.fixed_assets FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
