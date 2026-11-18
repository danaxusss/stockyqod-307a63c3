-- UNDO of 20261119130000_role_company_rules.sql (secure login, step 3).
--
-- Puts every table it restricted back exactly as step 2 left it: its own
-- policies are dropped and the policies it replaced (step 2's
-- "stocky_signed_in", or whatever the table had), saved in
-- stocky_backup.role_company_rules_policies, are re-created. The RESTRICTIVE
-- "stocky_signed_in_no_<command>" refusals were never touched and stay.
-- Signed-in users get the whole products table back (purchase price
-- included); the view, functions and triggers it added are removed.
-- Safe to run more than once. Run it BEFORE step 2's undo, if both are undone.
--
-- Not undone, on purpose:
--   • companies.restrict_docs_to_creator stays (nothing reads it any more;
--     dropping it would lose the setting). To remove it:
--       ALTER TABLE public.companies DROP COLUMN IF EXISTS restrict_docs_to_creator;
--   • purchase prices removed from saved document lines are not put back
--     (the app reads them from the catalogue when it opens a document).
--   • create_catalogue_product_master keeps its explicit-columns body (same
--     behaviour).

DO $$
DECLARE
  t record;
  p record;
  sql text;
BEGIN
  IF to_regclass('stocky_backup.role_company_rules_tables') IS NULL THEN
    RAISE NOTICE 'nothing to undo: step 3 was not applied';
    RETURN;
  END IF;

  FOR t IN SELECT table_name FROM stocky_backup.role_company_rules_tables ORDER BY 1 LOOP
    IF to_regclass('public.' || quote_ident(t.table_name)) IS NULL THEN CONTINUE; END IF;

    -- Step 3's policies.
    FOR p IN SELECT policyname FROM pg_policies
             WHERE schemaname = 'public' AND tablename = t.table_name
               AND (policyname ~ '^stocky_(company|documents|companies)_(select|insert|update|delete)$'
                    OR policyname IN ('stocky_parent_rows', 'stocky_movements')) LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, t.table_name);
    END LOOP;

    -- The policies they replaced, exactly as they were.
    FOR p IN SELECT * FROM stocky_backup.role_company_rules_policies WHERE tablename = t.table_name LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p.policyname, t.table_name);
      sql := format('CREATE POLICY %I ON public.%I AS %s FOR %s TO %s',
        p.policyname, t.table_name, p.permissive, p.cmd,
        (SELECT string_agg(CASE WHEN r = 'public' THEN 'PUBLIC' ELSE quote_ident(r) END, ', ') FROM unnest(p.roles) AS r));
      IF p.qual IS NOT NULL AND p.cmd <> 'INSERT' THEN sql := sql || format(' USING (%s)', p.qual); END IF;
      IF p.with_check IS NOT NULL AND p.cmd IN ('ALL', 'INSERT', 'UPDATE') THEN sql := sql || format(' WITH CHECK (%s)', p.with_check); END IF;
      EXECUTE sql;
    END LOOP;
  END LOOP;

  -- Restored: a later run of step 3 saves the then-current policies afresh.
  DELETE FROM stocky_backup.role_company_rules_policies;
  DELETE FROM stocky_backup.role_company_rules_tables;
END $$;

-- Triggers
DROP TRIGGER IF EXISTS stocky_quotes_before_write ON public.quotes;
DROP TRIGGER IF EXISTS stocky_products_keep_cost ON public.products;

-- Purchase prices: signed-in users read the whole products table again
-- (table-level grant, as after step 2; anon stays without rights).
DROP VIEW IF EXISTS public.product_costs;
REVOKE SELECT ON public.products FROM authenticated;   -- also clears the column list
GRANT SELECT ON public.products TO authenticated;

-- Functions (no policy uses them any more).
DROP FUNCTION IF EXISTS public.stocky_set_product_costs(jsonb);
DROP FUNCTION IF EXISTS public.stocky_products_keep_cost();
DROP FUNCTION IF EXISTS public.stocky_quotes_before_write();
DROP FUNCTION IF EXISTS public.stocky_strip_purchase_costs(jsonb);
DROP FUNCTION IF EXISTS public.stocky_grant_product_columns();
DROP FUNCTION IF EXISTS public.stocky_scope_sql(text, boolean, text[]);
DROP FUNCTION IF EXISTS public.stocky_drop_policies(text);
DROP FUNCTION IF EXISTS public.stocky_is_step3_policy(text);
DROP FUNCTION IF EXISTS public.stocky_edits_own_documents_only();
DROP FUNCTION IF EXISTS public.stocky_own_documents_only();
DROP FUNCTION IF EXISTS public.stocky_seller_name();
DROP FUNCTION IF EXISTS public.stocky_username();
DROP FUNCTION IF EXISTS public.stocky_writes_all_companies(text);
DROP FUNCTION IF EXISTS public.stocky_reads_all_companies(text);
DROP FUNCTION IF EXISTS public.stocky_can_see_costs();
DROP FUNCTION IF EXISTS public.stocky_is_reseller();
DROP FUNCTION IF EXISTS public.stocky_has_no_company();
DROP FUNCTION IF EXISTS public.stocky_company_id();
DROP FUNCTION IF EXISTS public.stocky_is_superadmin();
DROP FUNCTION IF EXISTS public.stocky_is_user();
DROP FUNCTION IF EXISTS public.stocky_role();
DROP FUNCTION IF EXISTS public.stocky_current_user();

NOTIFY pgrst, 'reload schema';

-- Expected: no rows (no step-3 policy left anywhere).
SELECT tablename, policyname FROM pg_policies
WHERE schemaname = 'public'
  AND (policyname ~ '^stocky_(company|documents|companies)_(select|insert|update|delete)$'
       OR policyname IN ('stocky_parent_rows', 'stocky_movements'))
ORDER BY 1, 2;
