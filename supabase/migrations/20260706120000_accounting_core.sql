-- ============================================================================
-- Comptabilité générale — Phase 1: ledger core
-- Sage-style double-entry accounting aligned with the Moroccan CGNC / Plan
-- Comptable Marocain. Fiscal years, plan comptable (accounts), journaux,
-- écritures (journal_entries) + lignes, and the post_journal_entry RPC that
-- enforces balance + sequential numbering + fiscal-year lock.
-- ============================================================================

-- ── Fiscal years / exercices ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.accounting_fiscal_years (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  closed_at TIMESTAMPTZ,
  closed_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, label)
);

-- ── Plan comptable / accounts ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.accounts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  class INT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('bilan_actif', 'bilan_passif', 'charge', 'produit', 'tresorerie')),
  parent_code TEXT,
  is_auxiliary BOOLEAN NOT NULL DEFAULT false,
  aux_kind TEXT CHECK (aux_kind IN ('client', 'fournisseur')),
  vat_rate NUMERIC,
  lettrable BOOLEAN NOT NULL DEFAULT false,
  active BOOLEAN NOT NULL DEFAULT true,
  is_system BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);
CREATE INDEX IF NOT EXISTS idx_accounts_company ON public.accounts(company_id);
CREATE INDEX IF NOT EXISTS idx_accounts_class ON public.accounts(company_id, class);

-- ── Journaux ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.journals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('vente', 'achat', 'banque', 'caisse', 'od', 'anouveaux', 'paie')),
  counterpart_account_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);

-- ── Écritures (headers) ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.journal_entries (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  fiscal_year_id UUID NOT NULL REFERENCES public.accounting_fiscal_years(id) ON DELETE CASCADE,
  journal_id UUID NOT NULL REFERENCES public.journals(id) ON DELETE CASCADE,
  entry_number INT,
  entry_date DATE NOT NULL,
  reference TEXT,
  label TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'posted', 'reversed')),
  source_type TEXT NOT NULL DEFAULT 'manual' CHECK (source_type IN ('manual', 'invoice', 'payment', 'payslip', 'reversal', 'depreciation', 'anouveaux')),
  source_id TEXT,
  posted_at TIMESTAMPTZ,
  posted_by TEXT,
  reversed_by UUID,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_journal_entries_company ON public.journal_entries(company_id);
CREATE INDEX IF NOT EXISTS idx_journal_entries_fy ON public.journal_entries(fiscal_year_id);
CREATE INDEX IF NOT EXISTS idx_journal_entries_journal ON public.journal_entries(journal_id);
CREATE INDEX IF NOT EXISTS idx_journal_entries_source ON public.journal_entries(source_type, source_id);

-- ── Lignes d'écriture ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.journal_entry_lines (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  entry_id UUID NOT NULL REFERENCES public.journal_entries(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  account_code TEXT NOT NULL,
  aux_account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
  label TEXT,
  debit NUMERIC NOT NULL DEFAULT 0,
  credit NUMERIC NOT NULL DEFAULT 0,
  vat_rate NUMERIC,
  lettrage_code TEXT,
  lettered_at TIMESTAMPTZ,
  analytic_code TEXT,
  sort_order INT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_journal_entry_lines_entry ON public.journal_entry_lines(entry_id);
CREATE INDEX IF NOT EXISTS idx_journal_entry_lines_account ON public.journal_entry_lines(company_id, account_code);
CREATE INDEX IF NOT EXISTS idx_journal_entry_lines_lettrage ON public.journal_entry_lines(company_id, account_code, lettrage_code);

-- ── RLS (permissive; app scopes by company_id, mirrors paie_tables) ─────────
ALTER TABLE public.accounting_fiscal_years ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_entry_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all accounting_fiscal_years" ON public.accounting_fiscal_years FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all accounts" ON public.accounts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all journals" ON public.journals FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all journal_entries" ON public.journal_entries FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all journal_entry_lines" ON public.journal_entry_lines FOR ALL USING (true) WITH CHECK (true);

CREATE TRIGGER update_accounting_fiscal_years_updated_at BEFORE UPDATE ON public.accounting_fiscal_years FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_accounts_updated_at BEFORE UPDATE ON public.accounts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_journal_entries_updated_at BEFORE UPDATE ON public.journal_entries FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── post_journal_entry: balance + FY lock + sequential numbering ────────────
CREATE OR REPLACE FUNCTION public.post_journal_entry(p_entry_id UUID, p_user TEXT DEFAULT NULL)
RETURNS public.journal_entries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry public.journal_entries;
  v_fy_status TEXT;
  v_debit NUMERIC;
  v_credit NUMERIC;
  v_count INT;
  v_next INT;
BEGIN
  SELECT * INTO v_entry FROM public.journal_entries WHERE id = p_entry_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Écriture introuvable'; END IF;
  IF v_entry.status = 'posted' THEN RETURN v_entry; END IF;

  SELECT status INTO v_fy_status FROM public.accounting_fiscal_years WHERE id = v_entry.fiscal_year_id;
  IF v_fy_status <> 'open' THEN RAISE EXCEPTION 'Exercice clôturé: écriture non validable'; END IF;

  SELECT COUNT(*), COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
    INTO v_count, v_debit, v_credit
    FROM public.journal_entry_lines WHERE entry_id = p_entry_id;
  IF v_count = 0 THEN RAISE EXCEPTION 'Écriture sans lignes'; END IF;
  IF abs(v_debit - v_credit) > 0.005 THEN
    RAISE EXCEPTION 'Écriture déséquilibrée: débit % ≠ crédit %', v_debit, v_credit;
  END IF;

  SELECT COALESCE(MAX(entry_number), 0) + 1 INTO v_next
    FROM public.journal_entries
    WHERE company_id = v_entry.company_id
      AND fiscal_year_id = v_entry.fiscal_year_id
      AND journal_id = v_entry.journal_id
      AND status = 'posted';

  UPDATE public.journal_entries
    SET entry_number = v_next, status = 'posted', posted_at = now(), posted_by = p_user, updated_at = now()
    WHERE id = p_entry_id
    RETURNING * INTO v_entry;

  RETURN v_entry;
END;
$$;
GRANT EXECUTE ON FUNCTION public.post_journal_entry(UUID, TEXT) TO anon, authenticated, service_role;

-- ── reverse_journal_entry: contre-passation of a posted entry ───────────────
CREATE OR REPLACE FUNCTION public.reverse_journal_entry(p_entry_id UUID, p_user TEXT DEFAULT NULL)
RETURNS public.journal_entries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_src public.journal_entries;
  v_fy_status TEXT;
  v_new_id UUID;
  v_new public.journal_entries;
BEGIN
  SELECT * INTO v_src FROM public.journal_entries WHERE id = p_entry_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Écriture introuvable'; END IF;
  IF v_src.status <> 'posted' THEN RAISE EXCEPTION 'Seule une écriture validée peut être contre-passée'; END IF;

  SELECT status INTO v_fy_status FROM public.accounting_fiscal_years WHERE id = v_src.fiscal_year_id;
  IF v_fy_status <> 'open' THEN RAISE EXCEPTION 'Exercice clôturé'; END IF;

  INSERT INTO public.journal_entries (company_id, fiscal_year_id, journal_id, entry_date, reference, label, status, source_type, source_id, created_by)
  VALUES (v_src.company_id, v_src.fiscal_year_id, v_src.journal_id, CURRENT_DATE,
          v_src.reference, 'Contre-passation ' || COALESCE(v_src.label, ''), 'draft', 'reversal', v_src.id::text, p_user)
  RETURNING id INTO v_new_id;

  INSERT INTO public.journal_entry_lines (entry_id, company_id, account_code, aux_account_id, label, debit, credit, vat_rate, sort_order)
  SELECT v_new_id, company_id, account_code, aux_account_id, label, credit, debit, vat_rate, sort_order
  FROM public.journal_entry_lines WHERE entry_id = p_entry_id;

  SELECT public.post_journal_entry(v_new_id, p_user) INTO v_new;
  UPDATE public.journal_entries SET status = 'reversed', reversed_by = v_new_id, updated_at = now() WHERE id = p_entry_id;

  RETURN v_new;
END;
$$;
GRANT EXECUTE ON FUNCTION public.reverse_journal_entry(UUID, TEXT) TO anon, authenticated, service_role;
