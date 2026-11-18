-- Secure login, step 1: signed-in requests must keep every right the public
-- key has today.
--
-- After a PIN login the app now sends a Supabase session, so its requests run
-- as the `authenticated` role instead of `anon`. Anything that was granted to
-- `anon` only (a dashboard-made policy, a table grant, a function) would start
-- failing. This gives `authenticated` the same rights as `anon` wherever it
-- has fewer. It only ADDS rights to signed-in users, who are a subset of
-- everyone holding the public key, so it opens nothing new.
--
-- Safe to run more than once. The final SELECT lists anything it could not fix
-- (expected: no rows).

DO $$
DECLARE
  r record;
  priv text;
BEGIN
  -- 1. Row-level policies that name anon but not authenticated (or public).
  FOR r IN
    SELECT schemaname, tablename, policyname, roles
    FROM pg_policies
    WHERE schemaname IN ('public', 'storage')
      AND 'anon' = ANY (roles)
      AND NOT ('authenticated' = ANY (roles))
      AND NOT ('public' = ANY (roles))
  LOOP
    BEGIN
      EXECUTE format(
        'ALTER POLICY %I ON %I.%I TO %s',
        r.policyname, r.schemaname, r.tablename,
        (SELECT string_agg(quote_ident(role_name), ', ') FROM unnest(r.roles || ARRAY['authenticated']::name[]) AS role_name)
      );
      RAISE NOTICE 'policy % on %.% now also applies to authenticated', r.policyname, r.schemaname, r.tablename;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'policy % on %.% not changed: %', r.policyname, r.schemaname, r.tablename, SQLERRM;
    END;
  END LOOP;

  -- 2. Table, view and sequence privileges.
  FOR r IN
    SELECT c.oid, n.nspname, c.relname, c.relkind
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
  LOOP
    IF r.relkind = 'S' THEN
      FOREACH priv IN ARRAY ARRAY['USAGE', 'SELECT', 'UPDATE'] LOOP
        IF has_sequence_privilege('anon', r.oid, priv) AND NOT has_sequence_privilege('authenticated', r.oid, priv) THEN
          EXECUTE format('GRANT %s ON SEQUENCE %I.%I TO authenticated', priv, r.nspname, r.relname);
        END IF;
      END LOOP;
    ELSE
      FOREACH priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
        IF has_table_privilege('anon', r.oid, priv) AND NOT has_table_privilege('authenticated', r.oid, priv) THEN
          EXECUTE format('GRANT %s ON %I.%I TO authenticated', priv, r.nspname, r.relname);
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  -- 3. Functions callable by anon but not by authenticated.
  FOR r IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.signature);
  END LOOP;
END $$;

-- Anything still reachable with the public key but not when signed in.
SELECT 'policy' AS kind, schemaname || '.' || tablename || ' — ' || policyname AS item
FROM pg_policies
WHERE schemaname IN ('public', 'storage')
  AND 'anon' = ANY (roles) AND NOT ('authenticated' = ANY (roles)) AND NOT ('public' = ANY (roles))
UNION ALL
SELECT 'table', n.nspname || '.' || c.relname
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
  AND (   (has_table_privilege('anon', c.oid, 'SELECT') AND NOT has_table_privilege('authenticated', c.oid, 'SELECT'))
       OR (has_table_privilege('anon', c.oid, 'INSERT') AND NOT has_table_privilege('authenticated', c.oid, 'INSERT'))
       OR (has_table_privilege('anon', c.oid, 'UPDATE') AND NOT has_table_privilege('authenticated', c.oid, 'UPDATE'))
       OR (has_table_privilege('anon', c.oid, 'DELETE') AND NOT has_table_privilege('authenticated', c.oid, 'DELETE')))
UNION ALL
SELECT 'function', p.oid::regprocedure::text
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND has_function_privilege('anon', p.oid, 'EXECUTE')
  AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE');
