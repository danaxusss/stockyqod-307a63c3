-- Supplier invoices (factures fournisseurs), their payments and withholdings.
--
-- 1. SUPPLIERS (public.suppliers): one record per supplier and company: name,
--    ICE (15 digits), IF, RC, address, legal type (société / personne
--    physique), agreed payment delay (default 60 days, at most 120: loi
--    69-21), date of the attestation de régularité fiscale (valid six months,
--    CGI art. 117-IV). Purchase orders keep their supplier as text
--    (provider_name) and may now point to a record (purchase_orders.supplier_id).
--    Nothing existing is rewritten.
-- 2. SUPPLIER INVOICES (public.supplier_invoices + supplier_invoice_lines):
--    lines HT with their VAT rate and account; draft → validated (numbered
--    FF-<year>-0001 by validate_supplier_invoice, number locked) → partial /
--    paid, kept in step with the payments by a trigger. The same supplier
--    invoice number twice for a supplier is refused (spaces and case ignored).
-- 3. PAYMENTS (public.supplier_payments): date, cash paid, mode, VAT withheld
--    (0 / 75 / 100 % of the VAT, art. 117-IV and V), IR/IS withheld on fees,
--    and the amounts lost to the cash limits (art. 11-II and 106-II, worked
--    out by the app).
-- 4. BOOKED DOCUMENTS ARE FIXED, like customer invoices
--    (20261125120000_billing_compliance.sql): an invoice whose journal entry
--    is validated (journal_entries.source_id = 'sinv:<id>', status 'posted')
--    can no longer change supplier, number, dates, nature, lines or totals,
--    nor be deleted; a booked payment ('spay:<id>') can no longer change nor
--    be deleted. Reversing the entry frees them. Nothing is blocked when the
--    accounting tables do not exist.
-- 5. ACCOUNTS: 44525 (État - IR/IS retenus à la source sur rémunérations de
--    tiers) and 44581 (État - TVA retenue à la source), plus the recoverable
--    VAT accounts 34551 / 34552 when missing, in every chart already set up.
--
-- Who: super admins, admins, accountants (compta) and billing staff
-- (facturation) read and write supplier invoices and payments of their own
-- company (super admins: every company; billing staff and managers with
-- cross-branch reading read the others, like purchase orders). Never
-- resellers: these are purchase prices. Suppliers are also readable by the
-- company's other users (purchase orders pick them) and editable by managers.
--
-- Needs the secure-login step 3 helpers (20261119130000_role_company_rules.sql).
-- The front end works before this script is run (the pages say to run it).
-- Safe to run more than once. (No nested $-quotes: the Supabase SQL editor
-- rejects them.)

-- ── Tables ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (btrim(name) <> ''),
  first_name text,
  legal_type text NOT NULL DEFAULT 'societe' CHECK (legal_type IN ('societe', 'personne_physique')),
  ice text CHECK (ice IS NULL OR ice ~ '^[0-9]{15}$'),
  if_number text CHECK (if_number IS NULL OR if_number ~ '^[0-9]+$'),
  rc text,
  address text,
  city text,
  phone text,
  email text,
  payment_days integer NOT NULL DEFAULT 60 CHECK (payment_days BETWEEN 0 AND 120),
  tax_certificate_date date,
  notes text,
  provider_id uuid,
  active boolean NOT NULL DEFAULT true,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_suppliers_company ON public.suppliers (company_id, name);

CREATE TABLE IF NOT EXISTS public.supplier_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id),
  number text,
  supplier_invoice_number text NOT NULL CHECK (btrim(supplier_invoice_number) <> ''),
  invoice_date date NOT NULL,
  reception_date date,
  delivery_date date,
  due_date date NOT NULL,
  due_kind text NOT NULL DEFAULT 'legal' CHECK (due_kind IN ('legal', 'agreed')),
  nature text NOT NULL DEFAULT 'marchandises' CHECK (nature IN ('marchandises', 'immobilisation', 'services')),
  is_works boolean NOT NULL DEFAULT false,
  description text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'validated', 'partial', 'paid')),
  total_ht numeric(14,2) NOT NULL DEFAULT 0,
  total_vat numeric(14,2) NOT NULL DEFAULT 0,
  total_ttc numeric(14,2) NOT NULL DEFAULT 0,
  total_nondeductible_vat numeric(14,2) NOT NULL DEFAULT 0,
  paid_amount numeric(14,2) NOT NULL DEFAULT 0,
  ir_rate numeric CHECK (ir_rate IS NULL OR ir_rate BETWEEN 0 AND 100),
  ir_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (ir_amount >= 0),
  litigation_amount numeric(14,2) CHECK (litigation_amount IS NULL OR litigation_amount >= 0),
  litigation_date date,
  judgment_amount numeric(14,2) CHECK (judgment_amount IS NULL OR judgment_amount >= 0),
  judgment_date date,
  cash_over_limit boolean NOT NULL DEFAULT false,
  source_po_id uuid,
  source_receipt_id text,
  notes text,
  created_by text,
  validated_by text,
  validated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Loi 69-21: 120 days at most (the delay never starts after the invoice date).
  CONSTRAINT supplier_invoices_due_check CHECK (due_date >= invoice_date AND due_date <= invoice_date + 120)
);
CREATE UNIQUE INDEX IF NOT EXISTS supplier_invoices_supplier_number_key
  ON public.supplier_invoices (supplier_id, upper(regexp_replace(supplier_invoice_number, '\s', '', 'g')));
CREATE UNIQUE INDEX IF NOT EXISTS supplier_invoices_number_key
  ON public.supplier_invoices (coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid), number) WHERE number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_supplier_invoices_company ON public.supplier_invoices (company_id, invoice_date DESC);
CREATE INDEX IF NOT EXISTS idx_supplier_invoices_supplier ON public.supplier_invoices (supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_invoices_due ON public.supplier_invoices (company_id, due_date) WHERE status IN ('validated', 'partial');

CREATE TABLE IF NOT EXISTS public.supplier_invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.supplier_invoices(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  label text NOT NULL,
  barcode text,
  quantity numeric CHECK (quantity IS NULL OR quantity > 0),
  amount_ht numeric(14,2) NOT NULL,
  vat_rate numeric NOT NULL CHECK (vat_rate IN (0, 7, 10, 14, 20)),
  vat_amount numeric(14,2) NOT NULL DEFAULT 0,
  account_code text NOT NULL,
  vat_nondeductible boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_supplier_invoice_lines_invoice ON public.supplier_invoice_lines (invoice_id, position);
CREATE INDEX IF NOT EXISTS idx_supplier_invoice_lines_barcode ON public.supplier_invoice_lines (barcode) WHERE barcode IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.supplier_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES public.supplier_invoices(id),
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id),
  payment_date date NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount >= 0),
  mode text NOT NULL CHECK (mode IN ('virement', 'cheque', 'effet', 'carte', 'especes', 'versement', 'compensation')),
  reference text,
  bank text,
  vat_withholding_rate numeric NOT NULL DEFAULT 0 CHECK (vat_withholding_rate IN (0, 75, 100)),
  vat_withheld numeric(14,2) NOT NULL DEFAULT 0 CHECK (vat_withheld >= 0),
  ir_withheld numeric(14,2) NOT NULL DEFAULT 0 CHECK (ir_withheld >= 0),
  cash_vat_nondeductible numeric(14,2) NOT NULL DEFAULT 0 CHECK (cash_vat_nondeductible >= 0),
  cash_expense_nondeductible numeric(14,2) NOT NULL DEFAULT 0 CHECK (cash_expense_nondeductible >= 0),
  notes text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT supplier_payments_settles_check CHECK (amount + vat_withheld + ir_withheld > 0)
);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_invoice ON public.supplier_payments (invoice_id);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_company ON public.supplier_payments (company_id, payment_date);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_supplier ON public.supplier_payments (supplier_id, payment_date);

-- Yearly numbering per company: FF-2026-0001.
CREATE TABLE IF NOT EXISTS public.supplier_invoice_counters (
  company_key uuid NOT NULL,
  year integer NOT NULL,
  last_value integer NOT NULL DEFAULT 0,
  PRIMARY KEY (company_key, year)
);

-- Links to tables a database may not have (patch.sql / earlier migrations).
DO $$
BEGIN
  IF to_regclass('public.providers') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'suppliers_provider_id_fkey') THEN
    ALTER TABLE public.suppliers ADD CONSTRAINT suppliers_provider_id_fkey
      FOREIGN KEY (provider_id) REFERENCES public.providers(id) ON DELETE SET NULL;
  END IF;
  IF to_regclass('public.purchase_orders') IS NOT NULL THEN
    ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS supplier_id uuid;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_orders_supplier_id_fkey') THEN
      ALTER TABLE public.purchase_orders ADD CONSTRAINT purchase_orders_supplier_id_fkey
        FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_invoices_source_po_id_fkey') THEN
      ALTER TABLE public.supplier_invoices ADD CONSTRAINT supplier_invoices_source_po_id_fkey
        FOREIGN KEY (source_po_id) REFERENCES public.purchase_orders(id) ON DELETE SET NULL;
    END IF;
  END IF;
END $$;

-- ── Who may touch them ───────────────────────────────────────────────────
-- Billing and accounting roles, never resellers (purchase prices).
CREATE OR REPLACE FUNCTION public.stocky_is_purchase_staff()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT coalesce(public.stocky_role() IN ('super_admin', 'admin', 'compta', 'facturation'), false)
     AND NOT public.stocky_is_reseller();
$fn$;

-- A row of the caller's company, or of any company for those who read /
-- write across companies ('standard' scope, like purchase orders).
CREATE OR REPLACE FUNCTION public.stocky_purchase_in_scope(p_company_id uuid, p_write boolean)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT CASE WHEN p_write THEN public.stocky_writes_all_companies('standard') ELSE public.stocky_reads_all_companies('standard') END
      OR p_company_id = public.stocky_company_id()
      OR (p_company_id IS NULL AND public.stocky_has_no_company());
$fn$;

-- Is a supplier document booked (an entry with this source id is validated)?
-- SECURITY DEFINER: answers yes / no whatever the caller may read of the books.
CREATE OR REPLACE FUNCTION public.stocky_supplier_source_posted(p_source_id text)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF to_regclass('public.journal_entries') IS NULL THEN
    RETURN false;
  END IF;
  RETURN EXISTS (SELECT 1 FROM public.journal_entries e WHERE e.source_id = p_source_id AND e.status = 'posted');
END
$fn$;

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_invoice_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_invoice_counters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stocky_signed_in_only ON public.suppliers;
DROP POLICY IF EXISTS stocky_suppliers_select ON public.suppliers;
DROP POLICY IF EXISTS stocky_suppliers_insert ON public.suppliers;
DROP POLICY IF EXISTS stocky_suppliers_update ON public.suppliers;
DROP POLICY IF EXISTS stocky_suppliers_delete ON public.suppliers;
-- Restrictive: whatever permissive policy is added later, a request without a
-- known Stocky user gets nothing.
CREATE POLICY stocky_signed_in_only ON public.suppliers AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.stocky_is_user())) WITH CHECK ((SELECT public.stocky_is_user()));
CREATE POLICY stocky_suppliers_select ON public.suppliers FOR SELECT TO authenticated
  USING (NOT (SELECT public.stocky_is_reseller()) AND public.stocky_purchase_in_scope(company_id, false));
CREATE POLICY stocky_suppliers_insert ON public.suppliers FOR INSERT TO authenticated
  WITH CHECK (((SELECT public.stocky_is_purchase_staff()) OR (SELECT coalesce(public.stocky_role() = 'manager', false)))
              AND public.stocky_purchase_in_scope(company_id, true));
CREATE POLICY stocky_suppliers_update ON public.suppliers FOR UPDATE TO authenticated
  USING (((SELECT public.stocky_is_purchase_staff()) OR (SELECT coalesce(public.stocky_role() = 'manager', false)))
         AND public.stocky_purchase_in_scope(company_id, true))
  WITH CHECK (((SELECT public.stocky_is_purchase_staff()) OR (SELECT coalesce(public.stocky_role() = 'manager', false)))
              AND public.stocky_purchase_in_scope(company_id, true));
CREATE POLICY stocky_suppliers_delete ON public.suppliers FOR DELETE TO authenticated
  USING ((SELECT public.stocky_is_purchase_staff()) AND public.stocky_purchase_in_scope(company_id, true));

DROP POLICY IF EXISTS stocky_signed_in_only ON public.supplier_invoices;
DROP POLICY IF EXISTS stocky_supplier_invoices_select ON public.supplier_invoices;
DROP POLICY IF EXISTS stocky_supplier_invoices_insert ON public.supplier_invoices;
DROP POLICY IF EXISTS stocky_supplier_invoices_update ON public.supplier_invoices;
DROP POLICY IF EXISTS stocky_supplier_invoices_delete ON public.supplier_invoices;
CREATE POLICY stocky_signed_in_only ON public.supplier_invoices AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.stocky_is_user())) WITH CHECK ((SELECT public.stocky_is_user()));
CREATE POLICY stocky_supplier_invoices_select ON public.supplier_invoices FOR SELECT TO authenticated
  USING ((SELECT public.stocky_is_purchase_staff()) AND public.stocky_purchase_in_scope(company_id, false));
-- New invoices are drafts: numbering and payment state belong to the functions below.
CREATE POLICY stocky_supplier_invoices_insert ON public.supplier_invoices FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.stocky_is_purchase_staff()) AND public.stocky_purchase_in_scope(company_id, true)
              AND status = 'draft' AND number IS NULL AND paid_amount = 0);
CREATE POLICY stocky_supplier_invoices_update ON public.supplier_invoices FOR UPDATE TO authenticated
  USING ((SELECT public.stocky_is_purchase_staff()) AND public.stocky_purchase_in_scope(company_id, true))
  WITH CHECK ((SELECT public.stocky_is_purchase_staff()) AND public.stocky_purchase_in_scope(company_id, true));
CREATE POLICY stocky_supplier_invoices_delete ON public.supplier_invoices FOR DELETE TO authenticated
  USING ((SELECT public.stocky_is_purchase_staff()) AND public.stocky_purchase_in_scope(company_id, true));

-- Lines follow their invoice. Reading: the invoice is visible to the caller
-- (its own SELECT rule applies inside EXISTS). Writing needs more than that:
-- being able to READ another company's invoice (cross-company readers) must
-- not allow changing its lines, so every write also requires purchase staff
-- with WRITE scope on the invoice's company - the rule of the invoice itself.
DROP POLICY IF EXISTS stocky_parent_rows ON public.supplier_invoice_lines;
DROP POLICY IF EXISTS stocky_signed_in_only ON public.supplier_invoice_lines;
DROP POLICY IF EXISTS stocky_supplier_invoice_lines_select ON public.supplier_invoice_lines;
DROP POLICY IF EXISTS stocky_supplier_invoice_lines_insert ON public.supplier_invoice_lines;
DROP POLICY IF EXISTS stocky_supplier_invoice_lines_update ON public.supplier_invoice_lines;
DROP POLICY IF EXISTS stocky_supplier_invoice_lines_delete ON public.supplier_invoice_lines;
CREATE POLICY stocky_signed_in_only ON public.supplier_invoice_lines AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.stocky_is_user())) WITH CHECK ((SELECT public.stocky_is_user()));
CREATE POLICY stocky_supplier_invoice_lines_select ON public.supplier_invoice_lines FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.supplier_invoices i WHERE i.id = invoice_id));
CREATE POLICY stocky_supplier_invoice_lines_insert ON public.supplier_invoice_lines FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.stocky_is_purchase_staff())
              AND EXISTS (SELECT 1 FROM public.supplier_invoices i
                          WHERE i.id = invoice_id AND public.stocky_purchase_in_scope(i.company_id, true)));
CREATE POLICY stocky_supplier_invoice_lines_update ON public.supplier_invoice_lines FOR UPDATE TO authenticated
  USING ((SELECT public.stocky_is_purchase_staff())
         AND EXISTS (SELECT 1 FROM public.supplier_invoices i
                     WHERE i.id = invoice_id AND public.stocky_purchase_in_scope(i.company_id, true)))
  WITH CHECK ((SELECT public.stocky_is_purchase_staff())
              AND EXISTS (SELECT 1 FROM public.supplier_invoices i
                          WHERE i.id = invoice_id AND public.stocky_purchase_in_scope(i.company_id, true)));
CREATE POLICY stocky_supplier_invoice_lines_delete ON public.supplier_invoice_lines FOR DELETE TO authenticated
  USING ((SELECT public.stocky_is_purchase_staff())
         AND EXISTS (SELECT 1 FROM public.supplier_invoices i
                     WHERE i.id = invoice_id AND public.stocky_purchase_in_scope(i.company_id, true)));

DROP POLICY IF EXISTS stocky_signed_in_only ON public.supplier_payments;
DROP POLICY IF EXISTS stocky_supplier_payments_select ON public.supplier_payments;
DROP POLICY IF EXISTS stocky_supplier_payments_write ON public.supplier_payments;
CREATE POLICY stocky_signed_in_only ON public.supplier_payments AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.stocky_is_user())) WITH CHECK ((SELECT public.stocky_is_user()));
CREATE POLICY stocky_supplier_payments_select ON public.supplier_payments FOR SELECT TO authenticated
  USING ((SELECT public.stocky_is_purchase_staff()) AND public.stocky_purchase_in_scope(company_id, false));
CREATE POLICY stocky_supplier_payments_write ON public.supplier_payments FOR ALL TO authenticated
  USING ((SELECT public.stocky_is_purchase_staff()) AND public.stocky_purchase_in_scope(company_id, true))
  WITH CHECK ((SELECT public.stocky_is_purchase_staff()) AND public.stocky_purchase_in_scope(company_id, true));

-- Counters: only validate_supplier_invoice uses them (no policy = no direct access).
REVOKE ALL ON public.supplier_invoice_counters FROM anon, authenticated, PUBLIC;
REVOKE ALL ON public.suppliers, public.supplier_invoices, public.supplier_invoice_lines, public.supplier_payments FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.suppliers, public.supplier_invoices, public.supplier_invoice_lines, public.supplier_payments TO authenticated;
GRANT ALL ON public.suppliers, public.supplier_invoices, public.supplier_invoice_lines, public.supplier_payments, public.supplier_invoice_counters TO service_role;

-- ── Guards ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.stocky_supplier_status(p_draft boolean, p_ttc numeric, p_paid numeric)
RETURNS text
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT CASE
    WHEN p_draft THEN 'draft'
    WHEN coalesce(p_paid, 0) > 0 AND coalesce(p_paid, 0) >= coalesce(p_ttc, 0) - 0.005 THEN 'paid'
    WHEN coalesce(p_paid, 0) > 0 THEN 'partial'
    ELSE 'validated'
  END;
$fn$;

-- Number and payment state change only through validation and payments
-- (depth > 1: the payments trigger and cascades from a deleted company). A
-- booked invoice keeps what the entry was made from.
CREATE OR REPLACE FUNCTION public.stocky_supplier_invoices_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_booked boolean;
  v_payments boolean;
BEGIN
  IF pg_trigger_depth() > 1 OR coalesce(current_setting('stocky.supplier_invoice_posting', true), '') = 'on' THEN
    IF TG_OP = 'UPDATE' THEN NEW.updated_at := now(); END IF;
    RETURN coalesce(NEW, OLD);
  END IF;
  v_booked := public.stocky_supplier_source_posted('sinv:' || OLD.id::text);
  v_payments := EXISTS (SELECT 1 FROM public.supplier_payments p WHERE p.invoice_id = OLD.id);
  IF TG_OP = 'DELETE' THEN
    IF v_booked THEN
      RAISE EXCEPTION 'Cette facture fournisseur est comptabilisée. Extournez son écriture dans Comptabilité pour la modifier.'
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_payments THEN
      RAISE EXCEPTION 'Cette facture a des règlements : supprimez-les avant de supprimer la facture.'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.number IS DISTINCT FROM OLD.number OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.paid_amount IS DISTINCT FROM OLD.paid_amount OR NEW.validated_at IS DISTINCT FROM OLD.validated_at
     OR NEW.company_id IS DISTINCT FROM OLD.company_id THEN
    RAISE EXCEPTION 'Le numéro et le statut d''une facture fournisseur changent par sa validation et ses règlements.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_booked AND (NEW.supplier_id, NEW.supplier_invoice_number, NEW.invoice_date, NEW.nature, NEW.is_works,
                   NEW.total_ht, NEW.total_vat, NEW.total_ttc, NEW.total_nondeductible_vat, NEW.ir_rate, NEW.ir_amount)
       IS DISTINCT FROM (OLD.supplier_id, OLD.supplier_invoice_number, OLD.invoice_date, OLD.nature, OLD.is_works,
                   OLD.total_ht, OLD.total_vat, OLD.total_ttc, OLD.total_nondeductible_vat, OLD.ir_rate, OLD.ir_amount) THEN
    RAISE EXCEPTION 'Cette facture fournisseur est comptabilisée. Extournez son écriture dans Comptabilité pour la modifier.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_payments AND NEW.supplier_id IS DISTINCT FROM OLD.supplier_id THEN
    RAISE EXCEPTION 'Cette facture a des règlements : son fournisseur ne change plus.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.total_ttc < OLD.paid_amount - 0.005 THEN
    RAISE EXCEPTION 'Le total TTC (%) ne peut pas être inférieur aux règlements déjà enregistrés (%).', NEW.total_ttc, OLD.paid_amount
      USING ERRCODE = 'check_violation';
  END IF;
  -- A changed total moves a validated invoice between partial and paid.
  NEW.status := public.stocky_supplier_status(OLD.status = 'draft', NEW.total_ttc, NEW.paid_amount);
  NEW.updated_at := now();
  RETURN NEW;
END
$fn$;

CREATE OR REPLACE FUNCTION public.stocky_supplier_invoice_lines_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN coalesce(NEW, OLD);
  END IF;
  -- A line stays on its invoice: moving it would change two invoices at once.
  IF TG_OP = 'UPDATE' AND NEW.invoice_id IS DISTINCT FROM OLD.invoice_id THEN
    RAISE EXCEPTION 'Une ligne ne change pas de facture.' USING ERRCODE = 'check_violation';
  END IF;
  IF public.stocky_supplier_source_posted('sinv:' || coalesce(NEW.invoice_id, OLD.invoice_id)::text)
     OR (TG_OP = 'UPDATE' AND public.stocky_supplier_source_posted('sinv:' || OLD.invoice_id::text)) THEN
    RAISE EXCEPTION 'Cette facture fournisseur est comptabilisée. Extournez son écriture dans Comptabilité pour la modifier.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN coalesce(NEW, OLD);
END
$fn$;

-- A payment belongs to a validated invoice of the same supplier and company,
-- never settles more than what remains, and is fixed once booked (the
-- cash-limit amounts the app recomputes still pass).
CREATE OR REPLACE FUNCTION public.stocky_supplier_payments_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_inv public.supplier_invoices%ROWTYPE;
  v_other numeric;
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN coalesce(NEW, OLD);
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') AND public.stocky_supplier_source_posted('spay:' || OLD.id::text) THEN
    IF TG_OP = 'DELETE'
       OR (NEW.invoice_id, NEW.supplier_id, NEW.company_id, NEW.payment_date, NEW.amount, NEW.mode, NEW.reference, NEW.bank,
           NEW.vat_withholding_rate, NEW.vat_withheld, NEW.ir_withheld)
          IS DISTINCT FROM
          (OLD.invoice_id, OLD.supplier_id, OLD.company_id, OLD.payment_date, OLD.amount, OLD.mode, OLD.reference, OLD.bank,
           OLD.vat_withholding_rate, OLD.vat_withheld, OLD.ir_withheld) THEN
      RAISE EXCEPTION 'Ce règlement est comptabilisé. Extournez son écriture dans Comptabilité pour le modifier.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  SELECT * INTO v_inv FROM public.supplier_invoices WHERE id = NEW.invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Facture fournisseur introuvable.';
  END IF;
  IF v_inv.status = 'draft' THEN
    RAISE EXCEPTION 'Validez la facture avant d''enregistrer un règlement.' USING ERRCODE = 'check_violation';
  END IF;
  NEW.supplier_id := v_inv.supplier_id;
  NEW.company_id := v_inv.company_id;
  SELECT coalesce(sum(p.amount + p.vat_withheld + p.ir_withheld), 0) INTO v_other
    FROM public.supplier_payments p WHERE p.invoice_id = NEW.invoice_id AND p.id IS DISTINCT FROM NEW.id;
  IF v_other + NEW.amount + NEW.vat_withheld + NEW.ir_withheld > v_inv.total_ttc + 0.01 THEN
    RAISE EXCEPTION 'Le règlement dépasse le reste à payer de la facture (% restants).', round(v_inv.total_ttc - v_other, 2)
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$fn$;

-- After each payment change: settled amount and status of the invoice.
CREATE OR REPLACE FUNCTION public.stocky_supplier_payments_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_id uuid;
  v_paid numeric;
BEGIN
  FOREACH v_id IN ARRAY ARRAY[CASE WHEN TG_OP <> 'INSERT' THEN OLD.invoice_id END, CASE WHEN TG_OP <> 'DELETE' THEN NEW.invoice_id END] LOOP
    IF v_id IS NULL THEN CONTINUE; END IF;
    SELECT coalesce(sum(p.amount + p.vat_withheld + p.ir_withheld), 0) INTO v_paid
      FROM public.supplier_payments p WHERE p.invoice_id = v_id;
    UPDATE public.supplier_invoices i
       SET paid_amount = v_paid,
           status = public.stocky_supplier_status(i.status = 'draft', i.total_ttc, v_paid)
     WHERE i.id = v_id AND (i.paid_amount IS DISTINCT FROM v_paid
                            OR i.status IS DISTINCT FROM public.stocky_supplier_status(i.status = 'draft', i.total_ttc, v_paid));
  END LOOP;
  RETURN NULL;
END
$fn$;

CREATE OR REPLACE FUNCTION public.stocky_suppliers_touch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS stocky_suppliers_touch ON public.suppliers;
CREATE TRIGGER stocky_suppliers_touch BEFORE UPDATE ON public.suppliers
  FOR EACH ROW EXECUTE FUNCTION public.stocky_suppliers_touch();
DROP TRIGGER IF EXISTS stocky_supplier_invoices_guard ON public.supplier_invoices;
CREATE TRIGGER stocky_supplier_invoices_guard BEFORE UPDATE OR DELETE ON public.supplier_invoices
  FOR EACH ROW EXECUTE FUNCTION public.stocky_supplier_invoices_guard();
DROP TRIGGER IF EXISTS stocky_supplier_invoice_lines_guard ON public.supplier_invoice_lines;
CREATE TRIGGER stocky_supplier_invoice_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON public.supplier_invoice_lines
  FOR EACH ROW EXECUTE FUNCTION public.stocky_supplier_invoice_lines_guard();
DROP TRIGGER IF EXISTS stocky_supplier_payments_guard ON public.supplier_payments;
CREATE TRIGGER stocky_supplier_payments_guard BEFORE INSERT OR UPDATE OR DELETE ON public.supplier_payments
  FOR EACH ROW EXECUTE FUNCTION public.stocky_supplier_payments_guard();
DROP TRIGGER IF EXISTS stocky_supplier_payments_sync ON public.supplier_payments;
CREATE TRIGGER stocky_supplier_payments_sync AFTER INSERT OR UPDATE OR DELETE ON public.supplier_payments
  FOR EACH ROW EXECUTE FUNCTION public.stocky_supplier_payments_sync();

-- ── Validate ─────────────────────────────────────────────────────────────
-- Checks the draft, recomputes its totals from its lines, gives it the next
-- number of its year and locks the number.
CREATE OR REPLACE FUNCTION public.validate_supplier_invoice(p_invoice_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v public.supplier_invoices%ROWTYPE;
  v_user text := (SELECT u.username FROM public.app_users u WHERE u.id = auth.uid());
  v_bad record;
  v_ht numeric;
  v_vat numeric;
  v_nd numeric;
  v_year integer;
  v_seq integer;
  v_number text;
BEGIN
  SELECT * INTO v FROM public.supplier_invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND OR NOT (public.stocky_is_purchase_staff() AND public.stocky_purchase_in_scope(v.company_id, true)) THEN
    RAISE EXCEPTION 'Facture introuvable ou accès refusé.';
  END IF;
  IF v.status <> 'draft' THEN
    RAISE EXCEPTION 'Cette facture est déjà validée (%).', v.number;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.supplier_invoice_lines WHERE invoice_id = v.id) THEN
    RAISE EXCEPTION 'Ajoutez au moins une ligne.';
  END IF;
  -- Goods lines name the product and the quantity (counted per product later).
  SELECT position, label INTO v_bad FROM public.supplier_invoice_lines
   WHERE invoice_id = v.id AND account_code LIKE '6111%'
     AND (nullif(btrim(coalesce(barcode, '')), '') IS NULL OR quantity IS NULL OR quantity <= 0)
   ORDER BY position LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Ligne % (%) : une ligne de marchandises doit indiquer l''article et la quantité.', v_bad.position + 1, v_bad.label;
  END IF;
  SELECT coalesce(sum(amount_ht), 0), coalesce(sum(vat_amount), 0), coalesce(sum(vat_amount) FILTER (WHERE vat_nondeductible), 0)
    INTO v_ht, v_vat, v_nd
    FROM public.supplier_invoice_lines WHERE invoice_id = v.id;
  IF v_ht + v_vat = 0 THEN
    RAISE EXCEPTION 'Le total de la facture est nul.';
  END IF;
  IF v.ir_amount > v_ht + 0.005 THEN
    RAISE EXCEPTION 'La retenue IR/IS dépasse le montant HT.';
  END IF;

  v_year := extract(year FROM v.invoice_date)::integer;
  INSERT INTO public.supplier_invoice_counters (company_key, year, last_value)
    VALUES (coalesce(v.company_id, '00000000-0000-0000-0000-000000000000'::uuid), v_year, 1)
    ON CONFLICT (company_key, year) DO UPDATE SET last_value = supplier_invoice_counters.last_value + 1
    RETURNING last_value INTO v_seq;
  v_number := 'FF-' || v_year || '-' || lpad(v_seq::text, 4, '0');

  PERFORM set_config('stocky.supplier_invoice_posting', 'on', true);
  UPDATE public.supplier_invoices
     SET status = 'validated', number = v_number, total_ht = v_ht, total_vat = v_vat,
         total_ttc = v_ht + v_vat, total_nondeductible_vat = v_nd,
         validated_by = v_user, validated_at = now(), updated_at = now()
   WHERE id = v.id;
  PERFORM set_config('stocky.supplier_invoice_posting', 'off', true);

  RETURN jsonb_build_object('number', v_number, 'total_ttc', v_ht + v_vat);
END
$fn$;

REVOKE ALL ON FUNCTION public.validate_supplier_invoice(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.validate_supplier_invoice(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.stocky_is_purchase_staff() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.stocky_purchase_in_scope(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.stocky_supplier_source_posted(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stocky_is_purchase_staff() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.stocky_purchase_in_scope(uuid, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.stocky_supplier_source_posted(text) TO authenticated, service_role;
-- Trigger functions run whatever EXECUTE says; nobody needs to call them.
REVOKE ALL ON FUNCTION public.stocky_supplier_invoices_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.stocky_supplier_invoice_lines_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.stocky_supplier_payments_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.stocky_supplier_payments_sync() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.stocky_suppliers_touch() FROM PUBLIC, anon, authenticated;

-- ── Accounts in the charts already set up ────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.accounts') IS NULL THEN
    RETURN;
  END IF;
  INSERT INTO public.accounts (company_id, code, label, class, type, is_system)
  SELECT c.company_id, v.code, v.label, v.class, v.type, true
  FROM (SELECT DISTINCT company_id FROM public.accounts) c
  CROSS JOIN (VALUES
    ('34551', 'État - TVA récupérable sur immobilisations', 3, 'bilan_actif'),
    ('34552', 'État - TVA récupérable sur charges', 3, 'bilan_actif'),
    ('44525', 'État - IR/IS retenus à la source sur rémunérations de tiers', 4, 'bilan_passif'),
    ('44581', 'État - TVA retenue à la source (art. 117 CGI)', 4, 'bilan_passif')
  ) AS v(code, label, class, type)
  ON CONFLICT (company_id, code) DO NOTHING;
END $$;

-- PostgREST picks up the new tables and function without a restart.
NOTIFY pgrst, 'reload schema';
