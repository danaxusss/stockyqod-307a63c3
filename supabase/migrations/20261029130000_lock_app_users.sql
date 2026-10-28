-- Users and PINs can only be read and written by the server.
--
-- User management now goes through the admin-users edge function (signed
-- session, superadmin only, PINs hashed server-side). Direct table access
-- with the public anon key would let anyone promote themselves to superadmin
-- or download every PIN hash, so it is removed whatever policies a database
-- picked up over time. Reads go through the existing *_safe functions, which
-- never return the PIN.

DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'app_users' LOOP
    EXECUTE format('DROP POLICY %I ON public.app_users', pol.policyname);
  END LOOP;
END;
$$;

ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.app_users FROM anon, authenticated;

-- The public delivery tracking page shows the driver's phone: only for a
-- live tracking link, and only that one column.
CREATE OR REPLACE FUNCTION public.get_tracking_driver_phone(p_token TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT nullif(u.phone, '')
  FROM public.tracking_sessions s
  JOIN public.app_users u ON u.id::text = s.driver_id
  WHERE s.token = p_token AND s.is_active AND s.expires_at > now()
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_tracking_driver_phone(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tracking_driver_phone(TEXT) TO anon, authenticated;
