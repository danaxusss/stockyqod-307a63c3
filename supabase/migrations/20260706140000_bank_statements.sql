-- ============================================================================
-- Comptabilité Phase 3b: bank accounts + statements (rapprochement bancaire)
-- Bank statement scans are parsed by AI into structured lines, stored here,
-- then reconciled against the treasury ledger.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.bank_accounts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  account_code TEXT NOT NULL DEFAULT '5141',
  bank_name TEXT,
  rib TEXT,
  currency TEXT NOT NULL DEFAULT 'MAD',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.bank_statements (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  bank_account_id UUID REFERENCES public.bank_accounts(id) ON DELETE SET NULL,
  account_code TEXT NOT NULL DEFAULT '5141',
  label TEXT,
  bank_name TEXT,
  period_start DATE,
  period_end DATE,
  opening_balance NUMERIC,
  closing_balance NUMERIC,
  file_url TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'reconciled')),
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bank_statements_company ON public.bank_statements(company_id);

CREATE TABLE IF NOT EXISTS public.bank_statement_lines (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  statement_id UUID NOT NULL REFERENCES public.bank_statements(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  line_date DATE,
  label TEXT,
  reference TEXT,
  debit NUMERIC NOT NULL DEFAULT 0,       -- money out of the account (décaissement)
  credit NUMERIC NOT NULL DEFAULT 0,      -- money into the account (encaissement)
  balance NUMERIC,
  matched_entry_line_id UUID REFERENCES public.journal_entry_lines(id) ON DELETE SET NULL,
  reconciled BOOLEAN NOT NULL DEFAULT false,
  sort_order INT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_bank_statement_lines_stmt ON public.bank_statement_lines(statement_id);

ALTER TABLE public.bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_statements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_statement_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all bank_accounts" ON public.bank_accounts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all bank_statements" ON public.bank_statements FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all bank_statement_lines" ON public.bank_statement_lines FOR ALL USING (true) WITH CHECK (true);

CREATE TRIGGER update_bank_accounts_updated_at BEFORE UPDATE ON public.bank_accounts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_bank_statements_updated_at BEFORE UPDATE ON public.bank_statements FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
