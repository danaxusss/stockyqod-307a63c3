-- Ledger integrity.
--
-- 1. An entry can only be posted into the fiscal year that contains its date
--    (and that belongs to the same company).
-- 2. Entry numbers are allocated under a lock, so two entries posted at the
--    same moment in one journal never share a number.
-- 3. A reversal is dated inside the reversed entry's fiscal year.
-- 4. Posted entries and their lines are read-only: only the reversal flag
--    and lettrage can change. Drafts stay fully editable.

CREATE OR REPLACE FUNCTION public.post_journal_entry(p_entry_id UUID, p_user TEXT DEFAULT NULL)
RETURNS public.journal_entries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry public.journal_entries;
  v_fy public.accounting_fiscal_years;
  v_debit NUMERIC;
  v_credit NUMERIC;
  v_count INT;
  v_next INT;
BEGIN
  SELECT * INTO v_entry FROM public.journal_entries WHERE id = p_entry_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Écriture introuvable'; END IF;
  IF v_entry.status = 'posted' THEN RETURN v_entry; END IF;
  IF v_entry.status <> 'draft' THEN RAISE EXCEPTION 'Écriture contre-passée : non validable'; END IF;

  SELECT * INTO v_fy FROM public.accounting_fiscal_years WHERE id = v_entry.fiscal_year_id;
  IF NOT FOUND OR v_fy.company_id <> v_entry.company_id THEN RAISE EXCEPTION 'Exercice introuvable pour cette société'; END IF;
  IF v_fy.status <> 'open' THEN RAISE EXCEPTION 'Exercice clôturé: écriture non validable'; END IF;
  IF v_entry.entry_date < v_fy.start_date OR v_entry.entry_date > v_fy.end_date THEN
    RAISE EXCEPTION 'Écriture datée du % hors de l''exercice % (% → %)',
      to_char(v_entry.entry_date, 'DD/MM/YYYY'), v_fy.label, to_char(v_fy.start_date, 'DD/MM/YYYY'), to_char(v_fy.end_date, 'DD/MM/YYYY');
  END IF;

  SELECT COUNT(*), COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
    INTO v_count, v_debit, v_credit
    FROM public.journal_entry_lines WHERE entry_id = p_entry_id;
  IF v_count = 0 THEN RAISE EXCEPTION 'Écriture sans lignes'; END IF;
  IF abs(v_debit - v_credit) > 0.005 THEN
    RAISE EXCEPTION 'Écriture déséquilibrée: débit % ≠ crédit %', v_debit, v_credit;
  END IF;

  -- One numbering sequence per journal and fiscal year.
  PERFORM pg_advisory_xact_lock(hashtext('journal_number:' || v_entry.journal_id::text || ':' || v_entry.fiscal_year_id::text));
  SELECT COALESCE(MAX(entry_number), 0) + 1 INTO v_next
    FROM public.journal_entries
    WHERE company_id = v_entry.company_id
      AND fiscal_year_id = v_entry.fiscal_year_id
      AND journal_id = v_entry.journal_id
      AND entry_number IS NOT NULL;

  UPDATE public.journal_entries
    SET entry_number = v_next, status = 'posted', posted_at = now(), posted_by = p_user, updated_at = now()
    WHERE id = p_entry_id
    RETURNING * INTO v_entry;

  RETURN v_entry;
END;
$$;
GRANT EXECUTE ON FUNCTION public.post_journal_entry(UUID, TEXT) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.reverse_journal_entry(p_entry_id UUID, p_user TEXT DEFAULT NULL)
RETURNS public.journal_entries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_src public.journal_entries;
  v_fy public.accounting_fiscal_years;
  v_new_id UUID;
  v_new public.journal_entries;
BEGIN
  SELECT * INTO v_src FROM public.journal_entries WHERE id = p_entry_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Écriture introuvable'; END IF;
  IF v_src.status <> 'posted' THEN RAISE EXCEPTION 'Seule une écriture validée peut être contre-passée'; END IF;

  SELECT * INTO v_fy FROM public.accounting_fiscal_years WHERE id = v_src.fiscal_year_id;
  IF v_fy.status <> 'open' THEN RAISE EXCEPTION 'Exercice clôturé'; END IF;

  -- Today, kept inside the original's fiscal year and never before it.
  INSERT INTO public.journal_entries (company_id, fiscal_year_id, journal_id, entry_date, reference, label, status, source_type, source_id, created_by)
  VALUES (v_src.company_id, v_src.fiscal_year_id, v_src.journal_id,
          GREATEST(v_src.entry_date, LEAST(CURRENT_DATE, v_fy.end_date)),
          v_src.reference, 'Contre-passation ' || COALESCE(v_src.label, ''), 'draft', 'reversal', v_src.id::text, p_user)
  RETURNING id INTO v_new_id;

  INSERT INTO public.journal_entry_lines (entry_id, company_id, account_code, aux_account_id, label, debit, credit, vat_rate, sort_order)
  SELECT v_new_id, company_id, account_code, aux_account_id, label, credit, debit, vat_rate, sort_order
  FROM public.journal_entry_lines WHERE entry_id = p_entry_id;

  SELECT * INTO v_new FROM public.post_journal_entry(v_new_id, p_user);
  UPDATE public.journal_entries SET status = 'reversed', reversed_by = v_new_id, updated_at = now() WHERE id = p_entry_id;

  RETURN v_new;
END;
$$;
GRANT EXECUTE ON FUNCTION public.reverse_journal_entry(UUID, TEXT) TO anon, authenticated, service_role;

-- ── Posted entries are read-only ────────────────────────────────────────────
-- Deletes cascading from a company or fiscal year (trigger depth > 1) pass.
CREATE OR REPLACE FUNCTION public.guard_journal_entry()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN RAISE EXCEPTION 'Une écriture est créée en brouillon puis validée'; END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'draft' THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Écriture validée : suppression impossible, contre-passez-la';
  END IF;
  IF (NEW.company_id, NEW.fiscal_year_id, NEW.journal_id, NEW.entry_number, NEW.entry_date, NEW.reference, NEW.label, NEW.source_type, NEW.source_id, NEW.posted_at, NEW.posted_by)
     IS NOT DISTINCT FROM
     (OLD.company_id, OLD.fiscal_year_id, OLD.journal_id, OLD.entry_number, OLD.entry_date, OLD.reference, OLD.label, OLD.source_type, OLD.source_id, OLD.posted_at, OLD.posted_by)
     AND (NEW.status = OLD.status OR (OLD.status = 'posted' AND NEW.status = 'reversed' AND NEW.reversed_by IS NOT NULL)) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Écriture validée : modification impossible, contre-passez-la';
END;
$$;

DROP TRIGGER IF EXISTS guard_journal_entry ON public.journal_entries;
CREATE TRIGGER guard_journal_entry
  BEFORE INSERT OR UPDATE OR DELETE ON public.journal_entries
  FOR EACH ROW EXECUTE FUNCTION public.guard_journal_entry();

CREATE OR REPLACE FUNCTION public.guard_journal_entry_line()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_status TEXT;
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN COALESCE(NEW, OLD); END IF;
  SELECT status INTO v_status FROM public.journal_entries WHERE id = COALESCE(OLD.entry_id, NEW.entry_id);
  IF TG_OP = 'UPDATE' AND NEW.entry_id IS DISTINCT FROM OLD.entry_id THEN
    RAISE EXCEPTION 'Une ligne ne change pas d''écriture';
  END IF;
  IF v_status IS NULL OR v_status = 'draft' THEN RETURN COALESCE(NEW, OLD); END IF;
  -- Lettrage and analytics may still be set on posted lines.
  IF TG_OP = 'UPDATE'
     AND (NEW.company_id, NEW.account_code, NEW.aux_account_id, NEW.label, NEW.debit, NEW.credit, NEW.vat_rate, NEW.sort_order)
         IS NOT DISTINCT FROM
         (OLD.company_id, OLD.account_code, OLD.aux_account_id, OLD.label, OLD.debit, OLD.credit, OLD.vat_rate, OLD.sort_order) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Ligne d''une écriture validée : modification impossible';
END;
$$;

DROP TRIGGER IF EXISTS guard_journal_entry_line ON public.journal_entry_lines;
CREATE TRIGGER guard_journal_entry_line
  BEFORE INSERT OR UPDATE OR DELETE ON public.journal_entry_lines
  FOR EACH ROW EXECUTE FUNCTION public.guard_journal_entry_line();
