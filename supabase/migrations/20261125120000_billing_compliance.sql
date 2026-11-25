-- Billing compliance: invoices and credit notes that meet Moroccan law.
--
-- 1. VAT RATE FROZEN ON EACH DOCUMENT (quotes.tva_rate). Until now every
--    screen, PDF and journal entry used the company's CURRENT rate, so
--    changing it rewrote the HT/TVA of every past document. Each document now
--    keeps the rate it was issued with. Existing documents are given their
--    issuing company's current rate (issuing_company_id, else company_id;
--    documents without a company: the legacy company_settings rate, else 20).
--    A document inserted without a rate (kiosk conversion, older app
--    versions) takes its company's rate.
-- 2. DUE DATE (quotes.due_date, loi 69-21 on payment delays): invoice date +
--    the company's payment delay (companies.payment_terms_days, default 60,
--    at most 120). Existing invoices: invoice date + 60 days.
-- 3. INVOICE MENTIONS: clients.is_individual ("Particulier (sans ICE)") and
--    companies.vat_exemption_text (printed after "Exonéré de TVA" at 0 %).
-- 4. BOOKED INVOICES ARE FIXED (CGI art. 145-III, CNC avis n° 24): an invoice
--    or credit note whose journal entry is validated (journal_entries.source_id
--    = the document id, status 'posted') can no longer change number, date,
--    customer, lines, totals, rate, issuer, nor go back to draft, nor be
--    deleted. Payments, notes, the lock, the due date and completing the
--    buyer's ICE / address still pass. Reversing the entry (status
--    'reversed') frees the document again. Nothing is blocked when the
--    accounting tables do not exist.
--    stocky_document_is_posted(id) lets the app ask the same question across
--    companies (billing users edit other companies' invoices, but cannot read
--    their books).
--
-- The front end works before this script is run (it saves without the new
-- columns), so it can be run after a deployment. Safe to run more than once.
-- (No nested $-quotes: the Supabase SQL editor rejects them.)

-- ── Columns ──────────────────────────────────────────────────────────────
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS tva_rate numeric;
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS due_date date;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS is_individual boolean NOT NULL DEFAULT false;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS payment_terms_days integer NOT NULL DEFAULT 60;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS vat_exemption_text text NOT NULL DEFAULT '';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'companies_payment_terms_days_check') THEN
    ALTER TABLE public.companies ADD CONSTRAINT companies_payment_terms_days_check
      CHECK (payment_terms_days BETWEEN 0 AND 120);
  END IF;
  -- The legacy single-company settings row gets the same settings.
  IF to_regclass('public.company_settings') IS NOT NULL THEN
    ALTER TABLE public.company_settings ADD COLUMN IF NOT EXISTS payment_terms_days integer NOT NULL DEFAULT 60;
    ALTER TABLE public.company_settings ADD COLUMN IF NOT EXISTS vat_exemption_text text NOT NULL DEFAULT '';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_quotes_dtype_due ON public.quotes(document_type, due_date);

-- ── Defaults for documents inserted without rate or due date ──────────────
CREATE OR REPLACE FUNCTION public.stocky_quotes_billing_defaults()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  v_rate numeric;
  v_days integer;
BEGIN
  IF NEW.tva_rate IS NULL OR (NEW.document_type = 'invoice' AND NEW.due_date IS NULL) THEN
    SELECT c.tva_rate, c.payment_terms_days INTO v_rate, v_days
    FROM public.companies c
    WHERE c.id = coalesce(NEW.issuing_company_id, NEW.company_id);
  END IF;
  IF NEW.tva_rate IS NULL THEN
    NEW.tva_rate := coalesce(v_rate, 20);
  END IF;
  IF NEW.document_type = 'invoice' AND NEW.due_date IS NULL THEN
    NEW.due_date := coalesce(NEW.quote_date, (coalesce(NEW.created_at, now()) AT TIME ZONE 'Africa/Casablanca')::date)
                    + coalesce(v_days, 60);
  END IF;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION public.stocky_quotes_billing_defaults() FROM PUBLIC, anon, authenticated;

-- ── Is a document booked? ────────────────────────────────────────────────
-- SECURITY DEFINER: the books are company-private (only super admins cross
-- companies there), but a billing user may edit another company's invoice
-- and must be told it is booked. Answers only yes / no for one document id.
CREATE OR REPLACE FUNCTION public.stocky_document_is_posted(p_document_id text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF to_regclass('public.journal_entries') IS NULL THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.journal_entries e
    WHERE e.source_id = p_document_id AND e.status = 'posted'
  );
END
$fn$;
REVOKE ALL ON FUNCTION public.stocky_document_is_posted(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stocky_document_is_posted(text) TO authenticated, service_role;

-- ── Booked invoices and credit notes are fixed ───────────────────────────
-- Only the columns below are compared, so payment updates, the lock, notes,
-- the due date and the first filling of tva_rate (backfill) pass. In the
-- customer, the buyer's ICE, address and "private person" flag can still be
-- completed (mandatory mentions; who was invoiced does not change).
-- Changes cascading from a deleted company (trigger depth > 1) pass, like the
-- journal guards of 20261030120000_accounting_integrity.sql.
CREATE OR REPLACE FUNCTION public.stocky_quotes_guard_posted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_booked boolean;
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN coalesce(NEW, OLD);
  END IF;
  IF OLD.document_type IS NULL OR OLD.document_type NOT IN ('invoice', 'avoir') THEN
    RETURN coalesce(NEW, OLD);
  END IF;
  IF TG_OP = 'UPDATE'
     AND (NEW.quote_number, NEW.quote_date, NEW.items, NEW.total_amount, NEW.document_type,
          NEW.company_id, NEW.issuing_company_id, NEW.customer_info - 'ice' - 'address' - 'isIndividual')
         IS NOT DISTINCT FROM
         (OLD.quote_number, OLD.quote_date, OLD.items, OLD.total_amount, OLD.document_type,
          OLD.company_id, OLD.issuing_company_id, OLD.customer_info - 'ice' - 'address' - 'isIndividual')
     AND NOT (NEW.status = 'draft' AND OLD.status IS DISTINCT FROM 'draft')
     AND (OLD.tva_rate IS NULL OR NEW.tva_rate IS NOT DISTINCT FROM OLD.tva_rate) THEN
    RETURN NEW;
  END IF;
  IF to_regclass('public.journal_entries') IS NULL THEN
    RETURN coalesce(NEW, OLD);
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.journal_entries e
    WHERE e.source_id = OLD.id::text AND e.status = 'posted'
  ) INTO v_booked;
  IF v_booked THEN
    IF OLD.document_type = 'avoir' THEN
      RAISE EXCEPTION 'Cet avoir est comptabilisé. Extournez son écriture dans Comptabilité pour le modifier.'
        USING ERRCODE = 'check_violation';
    END IF;
    RAISE EXCEPTION 'Cette facture est comptabilisée. Extournez son écriture dans Comptabilité ou établissez un avoir.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN coalesce(NEW, OLD);
END
$fn$;
REVOKE ALL ON FUNCTION public.stocky_quotes_guard_posted() FROM PUBLIC, anon, authenticated;

-- ── Backfill, then the triggers ──────────────────────────────────────────
-- The table's own triggers (updated_at, …) are paused during the backfill so
-- documents keep their dates, as in 20261119130000_role_company_rules.sql.
DO $$
DECLARE
  trg record;
  disabled text[] := '{}';
  v_default numeric;
BEGIN
  IF to_regclass('public.company_settings') IS NOT NULL THEN
    EXECUTE 'SELECT tva_rate FROM public.company_settings LIMIT 1' INTO v_default;
  END IF;
  v_default := coalesce(v_default, 20);

  FOR trg IN SELECT tgname FROM pg_trigger
             WHERE tgrelid = 'public.quotes'::regclass AND NOT tgisinternal AND tgenabled <> 'D' LOOP
    EXECUTE format('ALTER TABLE public.quotes DISABLE TRIGGER %I', trg.tgname);
    disabled := disabled || trg.tgname::text;
  END LOOP;

  UPDATE public.quotes q
  SET tva_rate = coalesce(
    (SELECT c.tva_rate FROM public.companies c WHERE c.id = coalesce(q.issuing_company_id, q.company_id)),
    v_default)
  WHERE q.tva_rate IS NULL;

  UPDATE public.quotes q
  SET due_date = coalesce(q.quote_date, (q.created_at AT TIME ZONE 'Africa/Casablanca')::date) + 60
  WHERE q.document_type = 'invoice' AND q.due_date IS NULL;

  FOR i IN 1 .. coalesce(array_length(disabled, 1), 0) LOOP
    EXECUTE format('ALTER TABLE public.quotes ENABLE TRIGGER %I', disabled[i]);
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS stocky_quotes_billing_defaults ON public.quotes;
CREATE TRIGGER stocky_quotes_billing_defaults
  BEFORE INSERT ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.stocky_quotes_billing_defaults();

DROP TRIGGER IF EXISTS stocky_quotes_guard_posted ON public.quotes;
CREATE TRIGGER stocky_quotes_guard_posted
  BEFORE UPDATE OR DELETE ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.stocky_quotes_guard_posted();

-- PostgREST picks up the new columns and function without a restart.
NOTIFY pgrst, 'reload schema';
