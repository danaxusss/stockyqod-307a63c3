-- Secure login, step 3: the database enforces role and company rules.
--
-- Run AFTER step 2 (20261119120000_signed_in_only.sql). Step 2 gives the open
-- tables one policy, "stocky_signed_in" (any signed-in user, any row), plus a
-- RESTRICTIVE "stocky_signed_in_no_<command>" for a command nobody had before.
-- Here the tables that carry business rules get real policies instead: every
-- PERMISSIVE policy of such a table (stocky_signed_in or anything else) is
-- saved in stocky_backup.role_company_rules_policies and dropped; RESTRICTIVE
-- ones (the "no_<command>" refusals) are kept, so what was never allowed stays
-- refused. The undo script puts the saved policies back exactly. Safe to run
-- more than once; tables a database does not have are skipped.
--
-- Who is asking: requests carry the Supabase session opened at PIN login, whose
-- auth.uid() IS app_users.id. The stocky_* helpers below read app_users (which
-- signed-in users cannot read themselves) with the owner's rights. They read
-- the table on every request, not the JWT claims, so a role change or a moved
-- user applies at once, without waiting for the token to expire.
--
-- 1. PURCHASE PRICES — everyone sees them except resellers
--    (app_users.price_display_type = 'reseller'; super admins and admins are
--    never treated as resellers, they manage the prices).
--    Row rules cannot hide one column, so:
--    • products.buyprice can no longer be read with the public API at all
--      (column privileges: every other column stays readable). `select=*` on
--      products is therefore refused: the app lists its columns.
--    • purchase prices are read from the view product_costs (barcode,
--      buyprice), which returns rows only for non-resellers.
--    • they are written with stocky_set_product_costs(jsonb) (refused for
--      resellers), or with a plain UPDATE of products.buyprice. An upsert
--      (INSERT … ON CONFLICT DO UPDATE) cannot set buyprice any more: Postgres
--      needs read rights on a column to upsert it.
--    • a reseller's product edit never changes buyprice (trigger), and quote
--      lines no longer store the catalogue purchase price (trigger + one-time
--      clean-up), since every document line used to carry a copy of it.
--    • purchase orders, their lines and the stock movements that carry a cost
--      are hidden from resellers.
--    !! A migration that ADDS A COLUMN to products must end with
--       SELECT public.stocky_grant_product_columns();
--       or nobody can read the new column.
--
-- 2. COMPANIES — a user sees and changes the rows of their own company
--    (app_users.company_id). Super admins see and change every company.
--    Kept from the app's existing rules (supabaseCompanyFilter.ts bypassFilter):
--    • facturation users read and write every company's billing documents
--      (they invoice for the whole group: invoice issued by company B for a
--      proforma of company A) and read the other company tables;
--    • managers with cross_branch_read read (never write) every company.
--    Accounting, bank, assets and payroll are stricter: only super admins
--    cross companies there.
--    A document is also visible to the company that issued it
--    (quotes.issuing_company_id).
--    Rows without a company (legacy): super admins (and the cross-company
--    readers above); a user without a company sees only rows without a
--    company. The app already hid them from users who have a company.
--    Left shared on purpose (stocky_signed_in kept): products and the
--    catalogue reference data, clients (one client base for the group: the
--    phone number is unique across companies and the app looks clients up
--    across companies), tasks and delivery tracking (field staff work across
--    companies, many tasks have no company), kiosk tables (kiosk edge function
--    / SECURITY DEFINER functions only), photos, technical sheets, share links,
--    templates, activity logs, stock movements (one physical stock), counters.
--    companies itself: every signed-in user reads it (letterheads of the
--    issuing company, company names); only super admins change it.
--
-- 3. "USERS SEE ONLY THE DOCUMENTS THEY CREATED" — companies.restrict_docs_to_creator.
--    When true, in that company, everyone except super_admin, admin, manager,
--    facturation and compta (they supervise, bill or keep the books, so they
--    need all of the company's documents) sees only the documents (quotes
--    table: quotes, BL, proformas, invoices, credit notes, purchase orders)
--    they created (quotes.created_by = username) or that name them as seller
--    (customer_info.salesPerson = their seller name) — the app's rule in
--    src/utils/quoteOwnership.ts. Resellers always see only their own.
--    Always (setting on or off): salespeople (senior_sales, junior_sales) and
--    resellers change only their own documents. A colleague's quote opened
--    by link stays readable (read-only, PDF) while the setting is off.
--
-- Edge functions use the service role and are not affected by any of this.
-- Undo: supabase/migrations/undo/20261119130000_role_company_rules_UNDO.sql

-- ── Settings column ──────────────────────────────────────────────────────
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS restrict_docs_to_creator boolean NOT NULL DEFAULT false;

-- ── Who is asking ────────────────────────────────────────────────────────
-- All helpers: SECURITY DEFINER (they read app_users), STABLE, fixed
-- search_path. They return NULL / false for a request without a known user.

CREATE OR REPLACE FUNCTION public.stocky_current_user()
RETURNS public.app_users
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u FROM public.app_users u WHERE u.id = auth.uid();
$$;

-- The app's role, as useAuth derives it: the is_superadmin / is_admin flags
-- win over new_role; users from before roles default like patch.sql did.
CREATE OR REPLACE FUNCTION public.stocky_role()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN u.is_superadmin OR u.new_role = 'super_admin' THEN 'super_admin'
    WHEN u.is_admin THEN 'admin'
    WHEN u.new_role IS NOT NULL THEN u.new_role::text
    WHEN u.is_compta THEN 'compta'
    ELSE 'senior_sales'
  END
  FROM public.app_users u WHERE u.id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.stocky_is_user()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.app_users u WHERE u.id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.stocky_is_superadmin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(public.stocky_role() = 'super_admin', false);
$$;

CREATE OR REPLACE FUNCTION public.stocky_company_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.company_id FROM public.app_users u WHERE u.id = auth.uid();
$$;

-- A signed-in user who belongs to no company (sees only rows without one).
CREATE OR REPLACE FUNCTION public.stocky_has_no_company()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.app_users u WHERE u.id = auth.uid() AND u.company_id IS NULL);
$$;

CREATE OR REPLACE FUNCTION public.stocky_is_reseller()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((
    SELECT u.price_display_type = 'reseller' AND public.stocky_role() NOT IN ('super_admin', 'admin')
    FROM public.app_users u WHERE u.id = auth.uid()
  ), false);
$$;

CREATE OR REPLACE FUNCTION public.stocky_can_see_costs()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.stocky_is_user() AND NOT public.stocky_is_reseller();
$$;

-- p_scope: 'docs' (billing documents), 'standard' (other company data),
-- 'strict' (accounting, bank, assets, payroll).
CREATE OR REPLACE FUNCTION public.stocky_reads_all_companies(p_scope text DEFAULT 'standard')
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((
    SELECT CASE
      WHEN r.role = 'super_admin' THEN true
      WHEN p_scope = 'strict' THEN false
      WHEN r.role = 'facturation' THEN true
      WHEN r.role = 'manager' THEN coalesce(u.cross_branch_read, false)
      ELSE false
    END
    FROM public.app_users u, LATERAL (SELECT public.stocky_role() AS role) r
    WHERE u.id = auth.uid()
  ), false);
$$;

CREATE OR REPLACE FUNCTION public.stocky_writes_all_companies(p_scope text DEFAULT 'standard')
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN public.stocky_role() = 'super_admin' THEN true
    WHEN p_scope = 'docs' THEN coalesce(public.stocky_role() = 'facturation', false)
    ELSE false
  END;
$$;

-- Lower-case, trimmed: the same matching as src/utils/quoteOwnership.ts.
CREATE OR REPLACE FUNCTION public.stocky_username()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT nullif(lower(btrim(u.username)), '') FROM public.app_users u WHERE u.id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.stocky_seller_name()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT nullif(lower(btrim(coalesce(nullif(btrim(u.custom_seller_name), ''), u.username))), '')
  FROM public.app_users u WHERE u.id = auth.uid();
$$;

-- Sees only their own documents: resellers always; everyone but the roles
-- that supervise or bill when their company turned the setting on.
CREATE OR REPLACE FUNCTION public.stocky_own_documents_only()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.stocky_is_reseller() OR coalesce((
    SELECT c.restrict_docs_to_creator
    FROM public.app_users u JOIN public.companies c ON c.id = u.company_id
    WHERE u.id = auth.uid()
      AND public.stocky_role() NOT IN ('super_admin', 'admin', 'manager', 'facturation', 'compta')
  ), false);
$$;

-- Changes only their own documents (the app's read-only rule for a
-- colleague's quote).
CREATE OR REPLACE FUNCTION public.stocky_edits_own_documents_only()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(public.stocky_role() IN ('senior_sales', 'junior_sales'), false)
      OR public.stocky_own_documents_only();
$$;

DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'stocky_current_user()', 'stocky_role()', 'stocky_is_user()', 'stocky_is_superadmin()',
    'stocky_company_id()', 'stocky_has_no_company()', 'stocky_is_reseller()', 'stocky_can_see_costs()',
    'stocky_reads_all_companies(text)', 'stocky_writes_all_companies(text)', 'stocky_username()',
    'stocky_seller_name()', 'stocky_own_documents_only()', 'stocky_edits_own_documents_only()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', fn);
  END LOOP;
END $$;

-- ── What this migration replaces, kept for the undo script ───────────────
CREATE SCHEMA IF NOT EXISTS stocky_backup;
REVOKE ALL ON SCHEMA stocky_backup FROM PUBLIC;
CREATE TABLE IF NOT EXISTS stocky_backup.role_company_rules_tables (
  table_name text PRIMARY KEY,                 -- public table name
  saved_at   timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS stocky_backup.role_company_rules_policies (
  tablename  name NOT NULL,
  policyname name NOT NULL,
  permissive text NOT NULL,
  roles      name[] NOT NULL,
  cmd        text NOT NULL,
  qual       text,
  with_check text,
  saved_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tablename, policyname)
);
ALTER TABLE stocky_backup.role_company_rules_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE stocky_backup.role_company_rules_policies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON stocky_backup.role_company_rules_tables, stocky_backup.role_company_rules_policies FROM PUBLIC;
DO $$
BEGIN
  EXECUTE 'REVOKE ALL ON SCHEMA stocky_backup FROM anon, authenticated';
  EXECUTE 'REVOKE ALL ON stocky_backup.role_company_rules_tables, stocky_backup.role_company_rules_policies FROM anon, authenticated';
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- The policies this migration creates (dropped and re-created on a re-run,
-- never saved as "previous").
CREATE OR REPLACE FUNCTION public.stocky_is_step3_policy(p_name text)
RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT p_name ~ '^stocky_(company|documents|companies)_(select|insert|update|delete)$'
      OR p_name IN ('stocky_parent_rows', 'stocky_movements');
$$;
REVOKE ALL ON FUNCTION public.stocky_is_step3_policy(text) FROM PUBLIC, anon;

-- ── Policy helpers (used by this migration) ──────────────────────────────
-- Remove every PERMISSIVE policy of a table (step 2's "stocky_signed_in", or
-- any other: one left would re-open what is restricted here), saving it first.
-- RESTRICTIVE policies only ever narrow access: kept (step 2's refusals of a
-- command nobody had, e.g. stocky_signed_in_no_delete).
CREATE OR REPLACE FUNCTION public.stocky_drop_policies(p_table text)
RETURNS void
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE pol record;
BEGIN
  INSERT INTO stocky_backup.role_company_rules_tables (table_name) VALUES (p_table) ON CONFLICT DO NOTHING;
  FOR pol IN SELECT * FROM pg_policies
             WHERE schemaname = 'public' AND tablename = p_table AND permissive = 'PERMISSIVE' LOOP
    IF NOT public.stocky_is_step3_policy(pol.policyname) THEN
      INSERT INTO stocky_backup.role_company_rules_policies (tablename, policyname, permissive, roles, cmd, qual, with_check)
      VALUES (pol.tablename, pol.policyname, pol.permissive, pol.roles, pol.cmd, pol.qual, pol.with_check)
      ON CONFLICT DO NOTHING;
    END IF;
    EXECUTE format('DROP POLICY %I ON public.%I', pol.policyname, p_table);
  END LOOP;
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', p_table);
END $$;
REVOKE ALL ON FUNCTION public.stocky_drop_policies(text) FROM PUBLIC, anon, authenticated;

-- Company scope of a row, as SQL text. Every call is wrapped in (SELECT …) so
-- Postgres evaluates it once per query, not once per row.
CREATE OR REPLACE FUNCTION public.stocky_scope_sql(p_scope text, p_write boolean, p_cols text[] DEFAULT ARRAY['company_id'])
RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  clause text := format('(SELECT public.%s(%L))', CASE WHEN p_write THEN 'stocky_writes_all_companies' ELSE 'stocky_reads_all_companies' END, p_scope);
  col text;
  nulls text := '';
BEGIN
  FOREACH col IN ARRAY p_cols LOOP
    clause := clause || format(' OR %I = (SELECT public.stocky_company_id())', col);
    nulls := nulls || format('%I IS NULL AND ', col);
  END LOOP;
  RETURN '(' || clause || ' OR (' || nulls || '(SELECT public.stocky_has_no_company())))';
END $$;
REVOKE ALL ON FUNCTION public.stocky_scope_sql(text, boolean, text[]) FROM PUBLIC, anon, authenticated;

-- ── 2. Company tables ────────────────────────────────────────────────────
DO $$
DECLARE
  t record;
  extra text;
  r text; w text;
BEGIN
  FOR t IN
    SELECT * FROM (VALUES
      -- billing documents besides quotes
      ('returns', 'docs'), ('document_counters', 'docs'),
      -- other company data (the app's bypassFilter rule)
      ('purchase_orders', 'standard'), ('stock_locations', 'standard'), ('providers', 'standard'),
      ('product_stock_settings', 'standard'), ('catalog_families', 'standard'), ('catalog_products', 'standard'),
      ('wa_sessions', 'standard'), ('wa_contacts', 'standard'), ('wa_segments', 'standard'),
      ('wa_templates', 'standard'), ('wa_campaigns', 'standard'), ('wa_campaign_recipients', 'standard'),
      ('wa_links', 'standard'), ('wa_auto_replies', 'standard'), ('wa_commands', 'standard'),
      ('wa_events', 'standard'), ('wa_outbox', 'standard'), ('wa_opt_outs', 'standard'),
      -- accounting, bank, assets, payroll
      ('accounts', 'strict'), ('journals', 'strict'), ('accounting_fiscal_years', 'strict'),
      ('journal_entries', 'strict'), ('journal_entry_lines', 'strict'), ('vat_declarations', 'strict'),
      ('bank_accounts', 'strict'), ('bank_statements', 'strict'), ('bank_statement_lines', 'strict'),
      ('fixed_assets', 'strict'), ('fixed_asset_depreciations', 'strict'),
      ('employees', 'strict'), ('employee_loans', 'strict'), ('leave_requests', 'strict'),
      ('payroll_settings', 'strict'), ('payroll_rubriques', 'strict'), ('payroll_runs', 'strict'),
      ('payslips', 'strict'), ('payslip_variables', 'strict'), ('payroll_cumuls', 'strict')
    ) AS v(tbl, scope)
  LOOP
    IF to_regclass('public.' || t.tbl) IS NULL THEN CONTINUE; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = t.tbl AND column_name = 'company_id') THEN
      RAISE NOTICE 'skipped %: no company_id column', t.tbl;
      CONTINUE;
    END IF;
    PERFORM public.stocky_drop_policies(t.tbl);
    -- Purchase orders are purchase prices: not for resellers.
    extra := CASE WHEN t.tbl = 'purchase_orders' THEN ' AND NOT (SELECT public.stocky_is_reseller())' ELSE '' END;
    r := public.stocky_scope_sql(t.scope, false) || extra;
    w := public.stocky_scope_sql(t.scope, true) || extra;
    EXECUTE format('CREATE POLICY stocky_company_select ON public.%I FOR SELECT TO authenticated USING (%s)', t.tbl, r);
    EXECUTE format('CREATE POLICY stocky_company_insert ON public.%I FOR INSERT TO authenticated WITH CHECK (%s)', t.tbl, w);
    EXECUTE format('CREATE POLICY stocky_company_update ON public.%I FOR UPDATE TO authenticated USING (%s) WITH CHECK (%s)', t.tbl, w, w);
    EXECUTE format('CREATE POLICY stocky_company_delete ON public.%I FOR DELETE TO authenticated USING (%s)', t.tbl, w);
  END LOOP;

  -- Lines follow their parent (the parent's own rules apply inside EXISTS).
  FOR t IN
    SELECT * FROM (VALUES ('purchase_order_items', 'purchase_orders', 'po_id'),
                          ('payslip_items', 'payslips', 'payslip_id')) AS v(tbl, parent, fk)
  LOOP
    IF to_regclass('public.' || t.tbl) IS NULL OR to_regclass('public.' || t.parent) IS NULL THEN CONTINUE; END IF;
    PERFORM public.stocky_drop_policies(t.tbl);
    r := format('EXISTS (SELECT 1 FROM public.%I p WHERE p.id = %I.%I)', t.parent, t.tbl, t.fk);
    EXECUTE format('CREATE POLICY stocky_parent_rows ON public.%I FOR ALL TO authenticated USING (%s) WITH CHECK (%s)', t.tbl, r, r);
  END LOOP;
END $$;

-- ── Documents (quotes table: quotes, BL, proformas, invoices, credit notes,
--    purchase orders to suppliers) ────────────────────────────────────────
-- Purchase prices are no longer kept in document lines: the line's product is
-- a copy of the catalogue product, purchase price included, and every reader
-- of the document received it. Lines of products that are not in the
-- catalogue (typed by hand in the quote) keep their estimated cost.
CREATE OR REPLACE FUNCTION public.stocky_strip_purchase_costs(p_items jsonb)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN jsonb_typeof(p_items) <> 'array' THEN p_items ELSE coalesce((
    SELECT jsonb_agg(
      CASE WHEN jsonb_typeof(e -> 'product') = 'object' AND (e -> 'product') ? 'buyprice'
                AND EXISTS (SELECT 1 FROM public.products p WHERE p.barcode = e -> 'product' ->> 'barcode')
           THEN jsonb_set(e, '{product}', (e -> 'product') - 'buyprice')
           ELSE e END
      ORDER BY o)
    FROM jsonb_array_elements(p_items) WITH ORDINALITY AS x(e, o)
  ), '[]'::jsonb) END;
$$;
REVOKE ALL ON FUNCTION public.stocky_strip_purchase_costs(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stocky_strip_purchase_costs(jsonb) TO authenticated, service_role;

-- SECURITY DEFINER: it reads app_users, which the caller cannot.
CREATE OR REPLACE FUNCTION public.stocky_quotes_before_write()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.items IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.items IS DISTINCT FROM OLD.items) THEN
    NEW.items := public.stocky_strip_purchase_costs(NEW.items);
  END IF;
  -- A document saved without its author (copies, imports) belongs to whoever
  -- saved it: "only the documents they created" then still finds it.
  IF TG_OP = 'INSERT' AND nullif(btrim(NEW.created_by), '') IS NULL THEN
    NEW.created_by := (SELECT u.username FROM public.app_users u WHERE u.id = auth.uid());
  END IF;
  RETURN NEW;
END $$;

DO $$
DECLARE
  owned text := '(lower(btrim(created_by)) = (SELECT public.stocky_username())'
             || ' OR lower(btrim(customer_info ->> ''salesPerson'')) = (SELECT public.stocky_seller_name()))';
  r text; w text;
  trg record;
  disabled text[] := '{}';
BEGIN
  IF to_regclass('public.quotes') IS NULL THEN RETURN; END IF;

  PERFORM public.stocky_drop_policies('quotes');
  r := public.stocky_scope_sql('docs', false, ARRAY['company_id', 'issuing_company_id'])
       || ' AND (NOT (SELECT public.stocky_own_documents_only()) OR ' || owned || ')';
  w := public.stocky_scope_sql('docs', true, ARRAY['company_id', 'issuing_company_id'])
       || ' AND (NOT (SELECT public.stocky_edits_own_documents_only()) OR ' || owned || ')';
  EXECUTE format('CREATE POLICY stocky_documents_select ON public.quotes FOR SELECT TO authenticated USING (%s)', r);
  EXECUTE format('CREATE POLICY stocky_documents_insert ON public.quotes FOR INSERT TO authenticated WITH CHECK (%s)', w);
  EXECUTE format('CREATE POLICY stocky_documents_update ON public.quotes FOR UPDATE TO authenticated USING (%s) WITH CHECK (%s)', w, w);
  EXECUTE format('CREATE POLICY stocky_documents_delete ON public.quotes FOR DELETE TO authenticated USING (%s)', w);

  DROP TRIGGER IF EXISTS stocky_quotes_before_write ON public.quotes;
  CREATE TRIGGER stocky_quotes_before_write
    BEFORE INSERT OR UPDATE ON public.quotes
    FOR EACH ROW EXECUTE FUNCTION public.stocky_quotes_before_write();

  -- One-time clean-up of the lines already saved. The table's own triggers
  -- (updated_at, …) are paused so documents keep their dates.
  FOR trg IN SELECT tgname FROM pg_trigger
             WHERE tgrelid = 'public.quotes'::regclass AND NOT tgisinternal AND tgenabled <> 'D' LOOP
    EXECUTE format('ALTER TABLE public.quotes DISABLE TRIGGER %I', trg.tgname);
    disabled := disabled || trg.tgname::text;
  END LOOP;
  UPDATE public.quotes SET items = public.stocky_strip_purchase_costs(items)
  WHERE jsonb_typeof(items) = 'array' AND items::text LIKE '%"buyprice"%'
    AND items IS DISTINCT FROM public.stocky_strip_purchase_costs(items);
  FOR i IN 1 .. coalesce(array_length(disabled, 1), 0) LOOP
    EXECUTE format('ALTER TABLE public.quotes ENABLE TRIGGER %I', disabled[i]);
  END LOOP;
END $$;

-- ── companies: everyone reads, super admins change ───────────────────────
DO $$
BEGIN
  PERFORM public.stocky_drop_policies('companies');
  CREATE POLICY stocky_companies_select ON public.companies FOR SELECT TO authenticated USING ((SELECT public.stocky_is_user()));
  CREATE POLICY stocky_companies_insert ON public.companies FOR INSERT TO authenticated WITH CHECK ((SELECT public.stocky_is_superadmin()));
  CREATE POLICY stocky_companies_update ON public.companies FOR UPDATE TO authenticated
    USING ((SELECT public.stocky_is_superadmin())) WITH CHECK ((SELECT public.stocky_is_superadmin()));
  CREATE POLICY stocky_companies_delete ON public.companies FOR DELETE TO authenticated USING ((SELECT public.stocky_is_superadmin()));
END $$;

-- ── 1. Purchase prices ───────────────────────────────────────────────────
-- Every products column but the purchase price is readable when signed in.
CREATE OR REPLACE FUNCTION public.stocky_grant_product_columns()
RETURNS void
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE cols text;
BEGIN
  REVOKE SELECT ON public.products FROM anon, authenticated;
  REVOKE SELECT (buyprice) ON public.products FROM anon, authenticated;
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO cols
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'products' AND column_name <> 'buyprice';
  EXECUTE format('GRANT SELECT (%s) ON public.products TO authenticated', cols);
END $$;
REVOKE ALL ON FUNCTION public.stocky_grant_product_columns() FROM PUBLIC, anon, authenticated;
SELECT public.stocky_grant_product_columns();

-- Purchase prices, for everyone but resellers (owner's rights: the view can
-- read the column the caller cannot). A reseller gets no rows, not an error.
CREATE OR REPLACE VIEW public.product_costs WITH (security_barrier = true) AS
  SELECT p.barcode, p.buyprice FROM public.products p WHERE public.stocky_can_see_costs();
REVOKE ALL ON public.product_costs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.product_costs TO authenticated, service_role;
COMMENT ON VIEW public.product_costs IS 'Purchase prices (products.buyprice); empty for resellers. See 20261119130000_role_company_rules.sql.';

-- Set purchase prices in bulk: [{"barcode": "…", "buyprice": 12.5}, …].
-- Returns how many products changed.
CREATE OR REPLACE FUNCTION public.stocky_set_product_costs(p_costs jsonb)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  IF NOT public.stocky_can_see_costs() THEN
    RAISE EXCEPTION 'Les prix d''achat ne sont pas accessibles pour ce compte' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_costs) <> 'array' THEN
    RAISE EXCEPTION 'p_costs must be a JSON array' USING ERRCODE = '22023';
  END IF;
  UPDATE public.products p
  SET buyprice = c.buyprice, updated_at = now()
  FROM (
    SELECT DISTINCT ON (e ->> 'barcode') e ->> 'barcode' AS barcode, coalesce((e ->> 'buyprice')::numeric, 0) AS buyprice
    FROM jsonb_array_elements(p_costs) WITH ORDINALITY AS x(e, o)
    WHERE nullif(e ->> 'barcode', '') IS NOT NULL
    ORDER BY e ->> 'barcode', o DESC
  ) c
  WHERE p.barcode = c.barcode AND p.buyprice IS DISTINCT FROM c.buyprice;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.stocky_set_product_costs(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stocky_set_product_costs(jsonb) TO authenticated, service_role;

-- A reseller editing a product (name, prices, image…) never changes, nor
-- wipes, its purchase price: their form never had it. Only direct requests
-- (current_user = authenticated): the stock functions (SECURITY DEFINER, run
-- as their owner) still update the weighted average cost on a reception.
CREATE OR REPLACE FUNCTION public.stocky_products_keep_cost()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_user = 'authenticated' AND public.stocky_is_reseller() THEN
    IF TG_OP = 'UPDATE' THEN
      NEW.buyprice := OLD.buyprice;
    ELSE
      NEW.buyprice := 0;
    END IF;
  END IF;
  RETURN NEW;
END $$;
-- Trigger functions run whatever EXECUTE says; nobody needs to call them.
REVOKE ALL ON FUNCTION public.stocky_products_keep_cost() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.stocky_quotes_before_write() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS stocky_products_keep_cost ON public.products;
CREATE TRIGGER stocky_products_keep_cost
  BEFORE INSERT OR UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.stocky_products_keep_cost();

-- Purchase order lines: see the purchase_orders rules above (lines follow
-- their order, which resellers cannot see). Stock movements stay shared, but
-- those carrying a unit cost are not shown to resellers.
DO $$
BEGIN
  IF to_regclass('public.stock_movements') IS NULL THEN RETURN; END IF;
  PERFORM public.stocky_drop_policies('stock_movements');
  CREATE POLICY stocky_movements ON public.stock_movements FOR ALL TO authenticated
    USING ((SELECT public.stocky_is_user()) AND (unit_cost IS NULL OR NOT (SELECT public.stocky_is_reseller())))
    WITH CHECK ((SELECT public.stocky_is_user()) AND (unit_cost IS NULL OR NOT (SELECT public.stocky_is_reseller())));
END $$;

-- The catalogue editor's "new product" function read the whole products row,
-- which signed-in users can no longer do: same function, explicit columns.
DO $$
BEGIN
  IF to_regprocedure('public.create_catalogue_product_master(uuid,text,uuid,text,numeric,numeric,text,boolean,integer)') IS NULL THEN
    RETURN;
  END IF;
  EXECUTE $fn$
CREATE OR REPLACE FUNCTION public.create_catalogue_product_master(
  p_company_id uuid,
  p_ref text,
  p_family_id uuid DEFAULT NULL,
  p_designation text DEFAULT NULL,
  p_price numeric DEFAULT 0,
  p_price_pro numeric DEFAULT 0,
  p_image text DEFAULT NULL,
  p_hidden boolean DEFAULT false,
  p_sort_order integer DEFAULT 0
)
RETURNS public.catalog_products
LANGUAGE plpgsql
SET search_path = public
AS $body$
DECLARE
  v_ref text := btrim(p_ref);
  v_name text;
  v_price numeric;
  v_reseller_price numeric;
  v_image text;
  v_catalog public.catalog_products%ROWTYPE;
BEGIN
  IF v_ref = '' THEN
    RAISE EXCEPTION 'Product reference is required';
  END IF;

  INSERT INTO public.products (
    barcode, name, brand, image, techsheet, price, buyprice,
    reseller_price, provider, stock_levels
  ) VALUES (
    v_ref, coalesce(nullif(btrim(p_designation), ''), v_ref), '', p_image, '',
    coalesce(p_price, 0), 0, coalesce(p_price_pro, 0), '', '{}'::jsonb
  )
  ON CONFLICT (barcode) DO NOTHING;

  SELECT name, price, reseller_price, image INTO v_name, v_price, v_reseller_price, v_image
  FROM public.products
  WHERE barcode = v_ref;

  INSERT INTO public.catalog_products (
    company_id, family_id, ref, designation, price, price_pro,
    image, hidden, sort_order
  ) VALUES (
    p_company_id, p_family_id, v_ref, v_name, v_price,
    v_reseller_price, v_image, p_hidden, p_sort_order
  )
  RETURNING * INTO v_catalog;

  RETURN v_catalog;
END;
$body$;
$fn$;
END $$;

-- The policy helpers are only for this migration (stocky_is_step3_policy is
-- kept: the undo script uses it).
DROP FUNCTION IF EXISTS public.stocky_scope_sql(text, boolean, text[]);
DROP FUNCTION IF EXISTS public.stocky_drop_policies(text);

NOTIFY pgrst, 'reload schema';

-- What each restricted table holds now (its new policies, plus any refusal
-- kept from step 2, e.g. stocky_signed_in_no_delete).
SELECT tablename, string_agg(policyname || CASE WHEN permissive = 'RESTRICTIVE' THEN ' (restrictive)' ELSE '' END, ', ' ORDER BY policyname) AS policies
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (SELECT table_name FROM stocky_backup.role_company_rules_tables)
GROUP BY tablename ORDER BY tablename;
