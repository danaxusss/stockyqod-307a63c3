-- UNDO for 20261119120000_signed_in_only.sql — puts back the rules and rights
-- the public (anon) key had before it, in one run.
--
-- NOT a migration: this folder is not applied automatically. Run it by hand in
-- the SQL editor only if signed-in-only access has to be rolled back.
--
-- With the backup kept by the migration (schema stocky_backup) every dropped
-- or moved rule and every revoked right comes back exactly as it was. Without
-- it (schema stocky_backup dropped), a generic fallback re-opens every table
-- that has `stocky_signed_in` to anon and signed-in users alike, and gives
-- anon back every sequence and function that signed-in users can use. The
-- fallback does not reopen storage rules.
--
-- Note: rules added later on the same tables (step 3) stay, but the old
-- permissive rules this restores are OR-ed with them, so those tables are as
-- open as before step 2.
--
-- Safe to run more than once. The final SELECT lists what was put back.

CREATE TEMP TABLE IF NOT EXISTS stocky_undo_report (kind text, item text, detail text);
TRUNCATE stocky_undo_report;

DO $$
DECLARE
  t          record;
  p          record;
  g          record;
  tbl        text;
  roles_sql  text;
  obj        text;
  have_backup boolean := to_regclass('stocky_backup.signed_in_only_tables') IS NOT NULL
                      AND to_regclass('stocky_backup.signed_in_only_policies') IS NOT NULL
                      AND to_regclass('stocky_backup.signed_in_only_grants') IS NOT NULL;
BEGIN
  IF have_backup THEN
    -- An empty backup means nothing to undo (never run, or already undone).
    -- 1. The rules this migration created.
    FOR t IN SELECT * FROM stocky_backup.signed_in_only_tables LOOP
      IF to_regclass(t.table_name) IS NULL THEN CONTINUE; END IF;
      BEGIN
        IF t.mode = 'OPEN' THEN
          EXECUTE format('DROP POLICY IF EXISTS stocky_signed_in ON %s', t.table_name);
          EXECUTE format('DROP POLICY IF EXISTS stocky_signed_in_no_select ON %s', t.table_name);
          EXECUTE format('DROP POLICY IF EXISTS stocky_signed_in_no_insert ON %s', t.table_name);
          EXECUTE format('DROP POLICY IF EXISTS stocky_signed_in_no_update ON %s', t.table_name);
          EXECUTE format('DROP POLICY IF EXISTS stocky_signed_in_no_delete ON %s', t.table_name);
          IF NOT t.rls_was_enabled THEN
            EXECUTE format('ALTER TABLE %s DISABLE ROW LEVEL SECURITY', t.table_name);
          END IF;
          INSERT INTO stocky_undo_report VALUES ('table', t.table_name, 'signed-in-only rules removed');
        END IF;
      EXCEPTION WHEN OTHERS THEN
        INSERT INTO stocky_undo_report VALUES ('NOT RESTORED', t.table_name, SQLERRM);
      END;
    END LOOP;

    -- 2. The previous rules, exactly as they were.
    FOR p IN SELECT * FROM stocky_backup.signed_in_only_policies ORDER BY schemaname, tablename, policyname LOOP
      tbl := format('%I.%I', p.schemaname, p.tablename);
      IF to_regclass(tbl) IS NULL THEN CONTINUE; END IF;
      SELECT string_agg(CASE WHEN r = 'public' THEN 'PUBLIC' ELSE quote_ident(r) END, ', ') INTO roles_sql
      FROM unnest(p.roles) AS r;
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = p.schemaname AND tablename = p.tablename AND policyname = p.policyname) THEN
          EXECUTE format('ALTER POLICY %I ON %s TO %s', p.policyname, tbl, roles_sql);
        ELSE
          EXECUTE format('CREATE POLICY %I ON %s AS %s FOR %s TO %s%s%s',
            p.policyname, tbl, p.permissive, p.cmd, roles_sql,
            CASE WHEN p.qual IS NOT NULL THEN ' USING (' || p.qual || ')' ELSE '' END,
            CASE WHEN p.with_check IS NOT NULL THEN ' WITH CHECK (' || p.with_check || ')' ELSE '' END);
        END IF;
        INSERT INTO stocky_undo_report VALUES ('policy', tbl || ' — ' || p.policyname, 'back for ' || array_to_string(p.roles, ', '));
      EXCEPTION WHEN OTHERS THEN
        INSERT INTO stocky_undo_report VALUES ('NOT RESTORED', tbl || ' — ' || p.policyname, SQLERRM);
      END;
    END LOOP;

    -- 3. The rights anon and PUBLIC held.
    FOR g IN SELECT * FROM stocky_backup.signed_in_only_grants ORDER BY object_kind, object_name LOOP
      BEGIN
        obj := g.object_name;
        IF g.object_kind = 'table' THEN
          IF to_regclass(obj) IS NULL THEN CONTINUE; END IF;
          EXECUTE format('GRANT %s ON TABLE %s TO %s', g.privilege_type, obj, CASE WHEN g.grantee = 'PUBLIC' THEN 'PUBLIC' ELSE quote_ident(g.grantee) END);
        ELSIF g.object_kind = 'sequence' THEN
          IF to_regclass(obj) IS NULL THEN CONTINUE; END IF;
          EXECUTE format('GRANT %s ON SEQUENCE %s TO %s', g.privilege_type, obj, CASE WHEN g.grantee = 'PUBLIC' THEN 'PUBLIC' ELSE quote_ident(g.grantee) END);
        ELSIF g.object_kind = 'function' THEN
          IF to_regprocedure(obj) IS NULL THEN CONTINUE; END IF;
          EXECUTE format('GRANT EXECUTE ON ROUTINE %s TO %s', obj, CASE WHEN g.grantee = 'PUBLIC' THEN 'PUBLIC' ELSE quote_ident(g.grantee) END);
        ELSIF g.object_kind = 'default' THEN
          EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT %s ON %s TO %I', g.privilege_type, obj, g.grantee);
        END IF;
      EXCEPTION WHEN OTHERS THEN
        INSERT INTO stocky_undo_report VALUES ('NOT RESTORED', g.object_kind || ' ' || obj || ' ' || g.privilege_type, SQLERRM);
      END;
    END LOOP;
    INSERT INTO stocky_undo_report
    SELECT 'rights', object_kind, count(*) || ' rights given back to anon/PUBLIC'
    FROM stocky_backup.signed_in_only_grants GROUP BY object_kind;

    -- The migration can be run again from a clean slate.
    DELETE FROM stocky_backup.signed_in_only_policies;
    DELETE FROM stocky_backup.signed_in_only_grants;
    DELETE FROM stocky_backup.signed_in_only_tables;
  ELSE
    -- Fallback without a backup: open again what signed-in users can reach.
    FOR t IN
      SELECT DISTINCT format('%I.%I', schemaname, tablename) AS name
      FROM pg_policies WHERE schemaname = 'public' AND policyname = 'stocky_signed_in'
    LOOP
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE format('%I.%I', schemaname, tablename) = t.name AND policyname = 'stocky_undo_open') THEN
          EXECUTE format('CREATE POLICY stocky_undo_open ON %s FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)', t.name);
        END IF;
        -- Commands refused before stay refused, for anon too.
        FOR p IN SELECT policyname FROM pg_policies
                 WHERE format('%I.%I', schemaname, tablename) = t.name AND policyname LIKE 'stocky\_signed\_in\_no\_%' LOOP
          EXECUTE format('ALTER POLICY %I ON %s TO anon, authenticated', p.policyname, t.name);
        END LOOP;
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %s TO anon', t.name);
        INSERT INTO stocky_undo_report VALUES ('table (fallback)', t.name, 'open to anon and signed-in users');
      EXCEPTION WHEN OTHERS THEN
        INSERT INTO stocky_undo_report VALUES ('NOT RESTORED', t.name, SQLERRM);
      END;
    END LOOP;
    FOR g IN
      SELECT c.oid::regclass::text AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND CASE WHEN c.relkind = 'S' THEN has_sequence_privilege('authenticated', c.oid, 'USAGE') ELSE false END
    LOOP
      EXECUTE format('GRANT USAGE, SELECT, UPDATE ON SEQUENCE %s TO anon', g.name);
    END LOOP;
    FOR g IN
      SELECT pr.oid::regprocedure::text AS signature FROM pg_proc pr JOIN pg_namespace n ON n.oid = pr.pronamespace
      WHERE n.nspname = 'public' AND has_function_privilege('authenticated', pr.oid, 'EXECUTE')
        AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = pr.oid AND d.deptype = 'e')
    LOOP
      BEGIN
        EXECUTE format('GRANT EXECUTE ON ROUTINE %s TO anon', g.signature);
        INSERT INTO stocky_undo_report VALUES ('function (fallback)', g.signature, 'callable by anon again');
      EXCEPTION WHEN OTHERS THEN
        INSERT INTO stocky_undo_report VALUES ('NOT RESTORED', g.signature, SQLERRM);
      END;
    END LOOP;
    BEGIN
      EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon';
      EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon';
      EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon';
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO stocky_undo_report VALUES ('NOT RESTORED', 'default rights', SQLERRM);
    END;
  END IF;
END $$;

SELECT kind, item, detail FROM stocky_undo_report ORDER BY (kind = 'NOT RESTORED') DESC, kind, item;
