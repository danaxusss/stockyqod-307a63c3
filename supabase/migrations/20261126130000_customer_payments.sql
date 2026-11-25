-- Customer payments and invoice numbers (2026 rules).
--
-- 1. PAYMENTS: each payment of an invoice now carries its own date, and two
--    new kinds of settlement exist (VAT withheld at source by the client, CGI
--    art. 117-IV; stamp duty on cash, art. 252-I-B). They live in the JSON
--    column quotes.payment_methods_json, as before: no column is added for
--    them. Entries without a date keep the invoice's payment date.
-- 2. COMPANY SETTINGS (companies, and the legacy company_settings row):
--    - tax_attestation_date: issue date of the attestation de régularité
--      fiscale. Older than 6 months (or missing), the company's
--      VAT-registered clients withhold the VAT of its invoices;
--    - cash_stamp_duty: collect the 0.25 % stamp duty on cash settlements.
--      Off by default (turning it on changes what customers pay).
-- 3. ACCOUNTS, added to every existing chart (new charts get them from the
--    app's seed):
--    - 34581 État - TVA retenue à la source par les clients (under 3458
--      État - autres comptes débiteurs): the withheld VAT the State owes back;
--    - 44578 État - droits de timbre sur règlements en espèces (under 4457
--      État - impôts et taxes à payer): the duty collected, paid over before
--      the end of the following month (art. 254-II).
-- 4. INVOICE NUMBER AT FINALISATION (CGI art. 145-III, continuous series):
--    a draft invoice carries a provisional reference ("BROUILLON-…") and
--    takes the next number of its issuer's series, for the month of its date,
--    when it is finalised: stocky_finalize_invoice(id) does it in one
--    transaction. The invoice row is locked (the same draft finalised twice
--    gets one number), the series of that company and month is serialised
--    with a transaction advisory lock, the counter is advanced with the
--    existing next_document_number (not defined in these migrations: it is
--    only called, never redefined, with untyped arguments so either of its
--    known signatures matches), and a number already carried by another
--    invoice of the same issuer is skipped. If anything fails, the whole
--    transaction - counter included, when the counter is a table - is
--    rolled back. Drafts that already hold a number keep it.
--
-- The front end works before this script is run (settings are saved without
-- the new columns, finalisation is done from the browser), so it can be run
-- after a deployment. stocky_quotes_guard_posted is not changed: payments are
-- not among the columns it compares, and finalising only touches drafts,
-- which are never booked. Safe to run more than once. No nested $-quotes.

-- ── 2. Company settings ─────────────────────────────────────────────────
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS tax_attestation_date date;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS cash_stamp_duty boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF to_regclass('public.company_settings') IS NOT NULL THEN
    ALTER TABLE public.company_settings ADD COLUMN IF NOT EXISTS tax_attestation_date date;
    ALTER TABLE public.company_settings ADD COLUMN IF NOT EXISTS cash_stamp_duty boolean NOT NULL DEFAULT false;
  END IF;
END $$;

-- ── 3. Accounts in existing charts ──────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.accounts') IS NOT NULL THEN
    INSERT INTO public.accounts (company_id, code, label, class, type, is_system)
    SELECT c.company_id, v.code, v.label, v.class, v.type, true
    FROM (SELECT DISTINCT company_id FROM public.accounts) c
    CROSS JOIN (VALUES
      ('34581', 'État - TVA retenue à la source par les clients', 3, 'bilan_actif'),
      ('44578', 'État - droits de timbre sur règlements en espèces', 4, 'bilan_passif')
    ) AS v(code, label, class, type)
    ON CONFLICT (company_id, code) DO NOTHING;
  END IF;
END $$;

-- ── 4. Finalise a draft invoice: number and status in one step ──────────
-- SECURITY INVOKER: the caller's row-level security applies to the invoice,
-- as when the app updates it directly. Returns the invoice's number.
CREATE OR REPLACE FUNCTION public.stocky_finalize_invoice(p_invoice_id text)
RETURNS text
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  v_row public.quotes%ROWTYPE;
  v_issuer text;
  v_day date;
  v_ym text;
  v_prefix text;
  v_raw text;
  v_number text;
  v_attempt integer := 0;
BEGIN
  SELECT * INTO v_row FROM public.quotes WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Facture introuvable' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_row.document_type IS DISTINCT FROM 'invoice' THEN
    RAISE EXCEPTION 'Seule une facture se finalise.' USING ERRCODE = 'check_violation';
  END IF;
  -- Already issued (by someone else a moment ago): nothing more to do.
  IF v_row.status IS DISTINCT FROM 'draft' THEN
    RETURN v_row.quote_number;
  END IF;
  IF coalesce(btrim(v_row.customer_info ->> 'fullName'), '') = '' THEN
    RAISE EXCEPTION 'Indiquez le client avant de finaliser la facture.' USING ERRCODE = 'check_violation';
  END IF;
  IF jsonb_typeof(v_row.items) IS DISTINCT FROM 'array' OR jsonb_array_length(v_row.items) = 0 THEN
    RAISE EXCEPTION 'Ajoutez au moins une ligne avant de finaliser la facture.' USING ERRCODE = 'check_violation';
  END IF;

  -- A draft created before numbering at finalisation keeps its number.
  IF v_row.quote_number NOT LIKE 'BROUILLON-%' THEN
    UPDATE public.quotes SET status = 'final', updated_at = now() WHERE id = p_invoice_id;
    RETURN v_row.quote_number;
  END IF;

  v_issuer := coalesce(v_row.issuing_company_id, v_row.company_id)::text;
  IF v_issuer IS NULL THEN
    RAISE EXCEPTION 'Société émettrice inconnue : impossible de numéroter la facture.' USING ERRCODE = 'check_violation';
  END IF;

  -- The invoice date (quote_date's type differs between databases), else
  -- the creation day in Morocco.
  BEGIN
    v_day := left(btrim(v_row.quote_date::text), 10)::date;
  EXCEPTION WHEN others THEN
    v_day := NULL;
  END;
  v_day := coalesce(v_day, (v_row.created_at AT TIME ZONE 'Africa/Casablanca')::date);
  v_ym := to_char(v_day, 'YYMM');

  SELECT nullif(btrim(to_jsonb(c) ->> 'doc_prefix'), '') INTO v_prefix
  FROM public.companies c WHERE c.id::text = v_issuer;
  v_prefix := coalesce(v_prefix, 'FAC');

  -- One finalisation at a time per company and month, until commit.
  PERFORM pg_advisory_xact_lock(hashtext('stocky_invoice_series:' || v_issuer || ':' || v_ym));

  LOOP
    v_attempt := v_attempt + 1;
    IF v_attempt > 50 THEN
      RAISE EXCEPTION 'Numérotation impossible : la série % de % semble désynchronisée.', v_ym, v_prefix USING ERRCODE = 'check_violation';
    END IF;
    -- Untyped literals: next_document_number(uuid, text) and (text, text) both match.
    EXECUTE format('SELECT public.next_document_number(%L, %L)::text', v_issuer, 'invoice_' || v_ym) INTO v_raw;
    IF v_raw IS NULL OR v_raw !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'Numérotation impossible : compteur de factures invalide (%).', coalesce(v_raw, 'vide') USING ERRCODE = 'check_violation';
    END IF;
    v_number := v_prefix || v_ym || '-' || v_raw::integer;
    -- A number already in the series (typed by hand, counter behind) is skipped.
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.quotes q
      WHERE q.document_type = 'invoice' AND q.quote_number = v_number AND q.id <> p_invoice_id
        AND coalesce(q.issuing_company_id, q.company_id)::text = v_issuer
    );
  END LOOP;

  UPDATE public.quotes SET quote_number = v_number, status = 'final', updated_at = now() WHERE id = p_invoice_id;
  RETURN v_number;
END
$fn$;
REVOKE ALL ON FUNCTION public.stocky_finalize_invoice(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stocky_finalize_invoice(text) TO authenticated, service_role;

-- PostgREST picks up the new columns and function without a restart.
NOTIFY pgrst, 'reload schema';
