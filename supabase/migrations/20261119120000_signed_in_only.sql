-- Secure login, step 2: the public key alone opens nothing.
--
-- Since step 1 every PIN login carries a real Supabase session, so the app's
-- requests run as `authenticated`. Until now ~100 tables were readable and
-- writable by anyone holding the public (anon) key, which is shipped inside
-- the website. After this file:
--
--   • anon: no table, view, sequence or function in `public`, and no storage
--     policy. Public share links, delivery tracking, the kiosk and the login
--     screen go through edge functions (service role) instead.
--   • authenticated: exactly the rules anon and signed-in users had before
--     (still permissive: finer per-company rules are step 3).
--
-- Per table in `public`:
--   OPEN    every rule was "true" (or RLS was off): all of them are replaced by
--           ONE policy `stocky_signed_in` FOR ALL TO authenticated. A command
--           that no rule allowed before (e.g. DELETE on business_sectors,
--           anything but SELECT on stock_postings) stays refused with a
--           restrictive policy `stocky_signed_in_no_<command>`.
--   CUSTOM  a rule has a real condition: the rules are kept as they are, only
--           moved from anon/public to authenticated. No `stocky_signed_in`.
--   LOCKED  RLS on and no rule for anon/public/authenticated, or no table
--           rights for authenticated (app_users, rate_limits, kiosk_*,
--           purchase_order_counters…): left locked.
-- Then every anon (and PUBLIC) right on tables, views, sequences and functions
-- in `public` is revoked; signed-in users and the service role keep theirs.
--
-- Everything removed is saved in schema `stocky_backup` first, so
-- undo/20261119120000_signed_in_only_UNDO.sql can put it back exactly.
--
-- Safe to run more than once: a table handled by an earlier run is never
-- reopened (a `stocky_signed_in` dropped later by step 3 is not recreated);
-- only rules added since for anon/public are removed (and saved).
--
-- The final SELECT lists whatever anon can still reach (expected: no rows).
-- What each table became:
--   SELECT * FROM stocky_backup.signed_in_only_tables ORDER BY mode, table_name;
--
-- Run it only once the public-share and public-tracking functions and the new
-- verify-pin are deployed and the web app with them is live.

-- ── 0. Where the previous rules are kept for the undo script ────────────────
CREATE SCHEMA IF NOT EXISTS stocky_backup;

CREATE TABLE IF NOT EXISTS stocky_backup.signed_in_only_tables (
  table_name      text PRIMARY KEY,           -- public.<table>, quoted
  mode            text NOT NULL,              -- OPEN | CUSTOM | LOCKED
  rls_was_enabled boolean NOT NULL,
  saved_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stocky_backup.signed_in_only_policies (
  schemaname  name NOT NULL,
  tablename   name NOT NULL,
  policyname  name NOT NULL,
  permissive  text NOT NULL,
  roles       name[] NOT NULL,
  cmd         text NOT NULL,
  qual        text,
  with_check  text,
  action      text NOT NULL,                  -- dropped | retargeted
  saved_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (schemaname, tablename, policyname)
);

CREATE TABLE IF NOT EXISTS stocky_backup.signed_in_only_grants (
  object_kind    text NOT NULL,               -- table | sequence | function | default
  object_name    text NOT NULL,               -- regclass / regprocedure / default ACL type
  grantee        text NOT NULL,               -- anon | PUBLIC
  privilege_type text NOT NULL,
  PRIMARY KEY (object_kind, object_name, grantee, privilege_type)
);

-- Statements the database refused (usually: the SQL editor role does not own
-- the object). Shown in the final report.
CREATE TABLE IF NOT EXISTS stocky_backup.signed_in_only_skipped (
  item    text PRIMARY KEY,
  reason  text NOT NULL,
  at      timestamptz NOT NULL DEFAULT now()
);

-- Not exposed through the API (only `public` is) and closed anyway.
ALTER TABLE stocky_backup.signed_in_only_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE stocky_backup.signed_in_only_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE stocky_backup.signed_in_only_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE stocky_backup.signed_in_only_skipped ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON SCHEMA stocky_backup FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA stocky_backup FROM PUBLIC;
DO $$
BEGIN
  EXECUTE 'REVOKE ALL ON SCHEMA stocky_backup FROM anon, authenticated';
  EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA stocky_backup FROM anon, authenticated';
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- A fresh run reports only what it could not do this time.
DELETE FROM stocky_backup.signed_in_only_skipped;

-- ── 1. Row-level rules of the tables in `public` ────────────────────────────
DO $$
DECLARE
  t          record;
  p          record;
  tbl        text;
  open_cmds  text[];
  cmd        text;
  mode       text;
  new_roles  text;
  processed  boolean;
  auth_rights boolean;
  has_rules  boolean;
  has_custom boolean;
  rel_roles  constant name[] := ARRAY['anon', 'public', 'authenticated']::name[];
  pub_roles  constant name[] := ARRAY['anon', 'public']::name[];
BEGIN
  FOR t IN
    SELECT c.oid, n.nspname, c.relname, c.relrowsecurity
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    ORDER BY c.relname
  LOOP
    tbl := format('%I.%I', t.nspname, t.relname);
    BEGIN
      processed := EXISTS (SELECT 1 FROM stocky_backup.signed_in_only_tables WHERE table_name = tbl);

      IF processed THEN
        -- Handled by an earlier run (maybe given stricter rules by step 3
        -- since): never reopen it. A rule added since for anon/public is
        -- removed (and saved), so it cannot widen the signed-in rules either.
        FOR p IN
          SELECT * FROM pg_policies
          WHERE schemaname = t.nspname AND tablename = t.relname AND roles && pub_roles
        LOOP
          INSERT INTO stocky_backup.signed_in_only_policies
            (schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check, action)
          VALUES (p.schemaname, p.tablename, p.policyname, p.permissive, p.roles, p.cmd, p.qual, p.with_check, 'dropped')
          ON CONFLICT DO NOTHING;
          EXECUTE format('DROP POLICY %I ON %s', p.policyname, tbl);
          RAISE NOTICE 'rule % on % (added for anon/public after the first run) removed', p.policyname, tbl;
        END LOOP;
        CONTINUE;
      END IF;

      auth_rights := has_table_privilege('authenticated', t.oid, 'SELECT')
                  OR has_table_privilege('authenticated', t.oid, 'INSERT')
                  OR has_table_privilege('authenticated', t.oid, 'UPDATE')
                  OR has_table_privilege('authenticated', t.oid, 'DELETE');

      SELECT count(*) > 0,
             coalesce(bool_or(NOT (CASE WHEN pol.cmd = 'INSERT'
                                        THEN coalesce(pol.with_check, 'true') = 'true'
                                        ELSE coalesce(pol.qual, '') = 'true' AND coalesce(pol.with_check, 'true') = 'true'
                                   END)), false)
        INTO has_rules, has_custom
      FROM pg_policies pol
      WHERE pol.schemaname = t.nspname AND pol.tablename = t.relname
        AND pol.permissive = 'PERMISSIVE' AND pol.roles && rel_roles;

      IF NOT auth_rights OR (t.relrowsecurity AND NOT has_rules) THEN
        mode := 'LOCKED';
      ELSIF t.relrowsecurity AND has_custom THEN
        mode := 'CUSTOM';
      ELSE
        mode := 'OPEN';
      END IF;

      INSERT INTO stocky_backup.signed_in_only_tables (table_name, mode, rls_was_enabled)
      VALUES (tbl, mode, t.relrowsecurity);

      IF mode = 'CUSTOM' THEN
        FOR p IN
          SELECT * FROM pg_policies
          WHERE schemaname = t.nspname AND tablename = t.relname AND roles && pub_roles
        LOOP
          INSERT INTO stocky_backup.signed_in_only_policies
            (schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check, action)
          VALUES (p.schemaname, p.tablename, p.policyname, p.permissive, p.roles, p.cmd, p.qual, p.with_check, 'retargeted')
          ON CONFLICT DO NOTHING;
          SELECT string_agg(quote_ident(r), ', ') INTO new_roles
          FROM (SELECT DISTINCT r FROM unnest(array_remove(array_remove(p.roles, 'anon'::name), 'public'::name) || 'authenticated'::name) AS r) s;
          EXECUTE format('ALTER POLICY %I ON %s TO %s', p.policyname, tbl, new_roles);
        END LOOP;
        RAISE NOTICE '% kept its own rules (now signed-in users only)', tbl;

      ELSIF mode = 'OPEN' THEN
        -- Which commands the old rules allowed (all of them when RLS was off).
        IF NOT t.relrowsecurity THEN
          open_cmds := ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'];
        ELSE
          SELECT coalesce(array_agg(DISTINCT c), '{}') INTO open_cmds
          FROM pg_policies pol,
               unnest(CASE WHEN pol.cmd = 'ALL' THEN ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] ELSE ARRAY[pol.cmd] END) AS c
          WHERE pol.schemaname = t.nspname AND pol.tablename = t.relname
            AND pol.permissive = 'PERMISSIVE' AND pol.roles && rel_roles;
        END IF;

        -- Drop the old open rules (with RLS off they did nothing anyway).
        FOR p IN
          SELECT * FROM pg_policies
          WHERE schemaname = t.nspname AND tablename = t.relname
            AND permissive = 'PERMISSIVE' AND roles && rel_roles
            AND policyname NOT LIKE 'stocky\_signed\_in%'
        LOOP
          INSERT INTO stocky_backup.signed_in_only_policies
            (schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check, action)
          VALUES (p.schemaname, p.tablename, p.policyname, p.permissive, p.roles, p.cmd, p.qual, p.with_check, 'dropped')
          ON CONFLICT DO NOTHING;
          EXECUTE format('DROP POLICY %I ON %s', p.policyname, tbl);
        END LOOP;

        EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', tbl);
        EXECUTE format('DROP POLICY IF EXISTS stocky_signed_in ON %s', tbl);
        EXECUTE format('CREATE POLICY stocky_signed_in ON %s AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true)', tbl);

        FOREACH cmd IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
          IF NOT (cmd = ANY (open_cmds)) THEN
            EXECUTE format('DROP POLICY IF EXISTS %I ON %s', 'stocky_signed_in_no_' || lower(cmd), tbl);
            EXECUTE format('CREATE POLICY %I ON %s AS RESTRICTIVE FOR %s TO authenticated %s',
              'stocky_signed_in_no_' || lower(cmd), tbl, cmd,
              CASE WHEN cmd = 'INSERT' THEN 'WITH CHECK (false)' ELSE 'USING (false)' END);
          END IF;
        END LOOP;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO stocky_backup.signed_in_only_skipped (item, reason)
      VALUES ('table ' || tbl, SQLERRM)
      ON CONFLICT (item) DO UPDATE SET reason = EXCLUDED.reason, at = now();
      RAISE NOTICE 'table % not changed: %', tbl, SQLERRM;
    END;
  END LOOP;
END $$;

-- ── 2. Table, view and sequence rights: none for anon ───────────────────────
DO $$
DECLARE
  r        record;
  obj      text;
  kind     text;
  privs    text[];
  priv     text;
  keepers  text[];
  role     text;
  had      jsonb;
  holds    boolean;
BEGIN
  SELECT array_agg(rolname::text) INTO keepers
  FROM pg_roles WHERE rolname IN ('authenticated', 'service_role');

  FOR r IN
    SELECT c.oid, c.relkind, c.relowner, c.relacl, format('%I.%I', n.nspname, c.relname) AS name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
    ORDER BY c.relname
  LOOP
    obj := r.name;
    kind := CASE WHEN r.relkind = 'S' THEN 'sequence' ELSE 'table' END;
    privs := CASE WHEN r.relkind = 'S' THEN ARRAY['USAGE', 'SELECT', 'UPDATE']
                  ELSE ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] END;
    BEGIN
      -- Save what anon and PUBLIC hold, for the undo script.
      INSERT INTO stocky_backup.signed_in_only_grants (object_kind, object_name, grantee, privilege_type)
      SELECT kind, obj, CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE 'anon' END, a.privilege_type
      FROM aclexplode(coalesce(r.relacl, acldefault(CASE WHEN r.relkind = 'S' THEN 's' ELSE 'r' END::"char", r.relowner))) a
      WHERE a.grantee = 0 OR a.grantee = 'anon'::regrole
      ON CONFLICT DO NOTHING;

      -- What signed-in users and the service role can do now, so a right they
      -- only had through PUBLIC is granted to them directly.
      had := '{}'::jsonb;
      FOREACH role IN ARRAY coalesce(keepers, '{}') LOOP
        FOREACH priv IN ARRAY privs LOOP
          IF kind = 'sequence' THEN
            holds := has_sequence_privilege(role, r.oid, priv);
          ELSE
            holds := has_table_privilege(role, r.oid, priv);
          END IF;
          IF holds THEN
            had := had || jsonb_build_object(role || ':' || priv, true);
          END IF;
        END LOOP;
      END LOOP;

      EXECUTE format('REVOKE ALL ON %s %s FROM anon', CASE WHEN kind = 'sequence' THEN 'SEQUENCE' ELSE 'TABLE' END, obj);
      IF EXISTS (SELECT 1 FROM aclexplode(coalesce(r.relacl, acldefault(CASE WHEN r.relkind = 'S' THEN 's' ELSE 'r' END::"char", r.relowner))) a WHERE a.grantee = 0) THEN
        EXECUTE format('REVOKE ALL ON %s %s FROM PUBLIC', CASE WHEN kind = 'sequence' THEN 'SEQUENCE' ELSE 'TABLE' END, obj);
        FOREACH role IN ARRAY coalesce(keepers, '{}') LOOP
          FOREACH priv IN ARRAY privs LOOP
            IF had ? (role || ':' || priv) THEN
              EXECUTE format('GRANT %s ON %s %s TO %I', priv, CASE WHEN kind = 'sequence' THEN 'SEQUENCE' ELSE 'TABLE' END, obj, role);
            END IF;
          END LOOP;
        END LOOP;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO stocky_backup.signed_in_only_skipped (item, reason)
      VALUES (kind || ' rights ' || obj, SQLERRM)
      ON CONFLICT (item) DO UPDATE SET reason = EXCLUDED.reason, at = now();
      RAISE NOTICE '% % rights not changed: %', kind, obj, SQLERRM;
    END;
  END LOOP;
END $$;

-- ── 3. Functions: none for anon (and none through PUBLIC) ───────────────────
-- Functions belonging to an extension are left alone. Triggers keep firing:
-- running a trigger function does not check EXECUTE.
DO $$
DECLARE
  f        record;
  role     text;
  keepers  text[];
  keep     text[];
BEGIN
  SELECT array_agg(rolname::text) INTO keepers
  FROM pg_roles WHERE rolname IN ('authenticated', 'service_role', 'supabase_auth_admin', 'dashboard_user');

  FOR f IN
    SELECT p.oid, p.oid::regprocedure::text AS signature, p.proowner, p.proacl
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND NOT EXISTS (SELECT 1 FROM pg_depend d
                      WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
    ORDER BY 2
  LOOP
    BEGIN
      INSERT INTO stocky_backup.signed_in_only_grants (object_kind, object_name, grantee, privilege_type)
      SELECT 'function', f.signature, CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE 'anon' END, a.privilege_type
      FROM aclexplode(coalesce(f.proacl, acldefault('f', f.proowner))) a
      WHERE a.grantee = 0 OR a.grantee = 'anon'::regrole
      ON CONFLICT DO NOTHING;

      IF has_function_privilege('anon', f.oid, 'EXECUTE')
         OR EXISTS (SELECT 1 FROM aclexplode(coalesce(f.proacl, acldefault('f', f.proowner))) a WHERE a.grantee = 0) THEN
        keep := '{}';
        FOREACH role IN ARRAY coalesce(keepers, '{}') LOOP
          IF has_function_privilege(role, f.oid, 'EXECUTE') THEN keep := keep || role; END IF;
        END LOOP;
        EXECUTE format('REVOKE EXECUTE ON ROUTINE %s FROM PUBLIC, anon', f.signature);
        FOREACH role IN ARRAY keep LOOP
          EXECUTE format('GRANT EXECUTE ON ROUTINE %s TO %I', f.signature, role);
        END LOOP;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO stocky_backup.signed_in_only_skipped (item, reason)
      VALUES ('function ' || f.signature, SQLERRM)
      ON CONFLICT (item) DO UPDATE SET reason = EXCLUDED.reason, at = now();
      RAISE NOTICE 'function % not changed: %', f.signature, SQLERRM;
    END;
  END LOOP;
END $$;

-- ── 4. New tables, sequences and functions: no automatic anon rights ────────
-- Supabase grants anon everything on objects created later in `public`
-- (and new tables start with RLS off). Only the defaults of the role running
-- this script can be changed; others are reported.
DO $$
DECLARE
  d     record;
  label text;
BEGIN
  FOR d IN
    SELECT da.defaclobjtype AS objtype, da.defaclacl
    FROM pg_default_acl da
    WHERE da.defaclrole = (SELECT oid FROM pg_roles WHERE rolname = current_user)
      AND da.defaclnamespace = 'public'::regnamespace
      AND da.defaclobjtype IN ('r', 'S', 'f')
  LOOP
    label := CASE d.objtype WHEN 'r' THEN 'TABLES' WHEN 'S' THEN 'SEQUENCES' ELSE 'FUNCTIONS' END;
    BEGIN
      INSERT INTO stocky_backup.signed_in_only_grants (object_kind, object_name, grantee, privilege_type)
      SELECT 'default', label, 'anon', a.privilege_type
      FROM aclexplode(d.defaclacl) a
      WHERE a.grantee = 'anon'::regrole
      ON CONFLICT DO NOTHING;
      IF EXISTS (SELECT 1 FROM aclexplode(d.defaclacl) a WHERE a.grantee = 'anon'::regrole) THEN
        EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON %s FROM anon', label);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO stocky_backup.signed_in_only_skipped (item, reason)
      VALUES ('default rights ' || label, SQLERRM)
      ON CONFLICT (item) DO UPDATE SET reason = EXCLUDED.reason, at = now();
    END;
  END LOOP;
END $$;

-- ── 5. Storage: files only for signed-in users ──────────────────────────────
-- Every bucket the app uses (company-assets, technical-sheets, techsheets,
-- product-photos, task-proofs) is a PUBLIC bucket: the public file links shown
-- on the share page, the kiosk and in PDFs are served without these rules, so
-- anonymous visitors still see the files. Listing, uploading, replacing and
-- deleting now need a signed-in user. Each rule keeps its bucket condition.
-- The SQL editor role may not own storage tables: refusals are reported.
DO $$
DECLARE
  p         record;
  new_roles text;
BEGIN
  FOR p IN
    SELECT * FROM pg_policies
    WHERE schemaname = 'storage' AND roles && ARRAY['anon', 'public']::name[]
  LOOP
    BEGIN
      INSERT INTO stocky_backup.signed_in_only_policies
        (schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check, action)
      VALUES (p.schemaname, p.tablename, p.policyname, p.permissive, p.roles, p.cmd, p.qual, p.with_check, 'retargeted')
      ON CONFLICT DO NOTHING;
      SELECT string_agg(quote_ident(r), ', ') INTO new_roles
      FROM (SELECT DISTINCT r FROM unnest(array_remove(array_remove(p.roles, 'anon'::name), 'public'::name) || 'authenticated'::name) AS r) s;
      EXECUTE format('ALTER POLICY %I ON %I.%I TO %s', p.policyname, p.schemaname, p.tablename, new_roles);
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO stocky_backup.signed_in_only_skipped (item, reason)
      VALUES (format('storage policy %s on %s.%s', p.policyname, p.schemaname, p.tablename), SQLERRM)
      ON CONFLICT (item) DO UPDATE SET reason = EXCLUDED.reason, at = now();
      RAISE NOTICE 'storage policy % on %.% not changed: %', p.policyname, p.schemaname, p.tablename, SQLERRM;
    END;
  END LOOP;
END $$;

-- ── Report: what the public key alone can still reach (expected: no rows) ───
SELECT 'table or view' AS kind, n.nspname || '.' || c.relname AS item,
       'anon can still ' || concat_ws(', ',
         CASE WHEN has_table_privilege('anon', c.oid, 'SELECT') THEN 'read' END,
         CASE WHEN has_table_privilege('anon', c.oid, 'INSERT') THEN 'insert' END,
         CASE WHEN has_table_privilege('anon', c.oid, 'UPDATE') THEN 'update' END,
         CASE WHEN has_table_privilege('anon', c.oid, 'DELETE') THEN 'delete' END) AS detail
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND CASE WHEN c.relkind IN ('r', 'p', 'v', 'm', 'f') THEN has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE') ELSE false END
UNION ALL
SELECT 'sequence', n.nspname || '.' || c.relname, 'anon can still use it'
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND CASE WHEN c.relkind = 'S' THEN has_sequence_privilege('anon', c.oid, 'USAGE, SELECT, UPDATE') ELSE false END
UNION ALL
SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
            THEN 'extension function (left as is)' ELSE 'function' END,
       p.oid::regprocedure::text, 'anon can still call it'
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND has_function_privilege('anon', p.oid, 'EXECUTE')
UNION ALL
SELECT 'storage policy', schemaname || '.' || tablename || ' — ' || policyname, 'still applies to ' || array_to_string(roles, ', ')
FROM pg_policies
WHERE schemaname = 'storage' AND roles && ARRAY['anon', 'public']::name[]
UNION ALL
SELECT 'not changed', item, reason
FROM stocky_backup.signed_in_only_skipped
ORDER BY 1, 2;
