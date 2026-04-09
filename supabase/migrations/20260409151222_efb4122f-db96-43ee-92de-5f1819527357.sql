
-- 1. SECURE APP_USERS: Drop public SELECT policy (verify-pin uses service_role, unaffected)
DROP POLICY IF EXISTS "Allow read app_users" ON public.app_users;

-- 2. Create RPC to list users without pin column
CREATE OR REPLACE FUNCTION public.get_app_users_safe()
RETURNS TABLE (
  id uuid, username text, is_admin boolean, can_create_quote boolean,
  allowed_stock_locations text[], allowed_brands text[],
  price_display_type text, created_at timestamptz, updated_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT id, username, is_admin, can_create_quote, allowed_stock_locations, allowed_brands, price_display_type, created_at, updated_at
  FROM public.app_users
  ORDER BY created_at DESC;
$$;

-- 3. Create RPC to get single user by ID (safe)
CREATE OR REPLACE FUNCTION public.get_app_user_by_id_safe(p_id uuid)
RETURNS TABLE (
  id uuid, username text, is_admin boolean, can_create_quote boolean,
  allowed_stock_locations text[], allowed_brands text[],
  price_display_type text, created_at timestamptz, updated_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT id, username, is_admin, can_create_quote, allowed_stock_locations, allowed_brands, price_display_type, created_at, updated_at
  FROM public.app_users
  WHERE app_users.id = p_id;
$$;

-- 4. Create RPC to get single user by username (safe)
CREATE OR REPLACE FUNCTION public.get_app_user_by_username_safe(p_username text)
RETURNS TABLE (
  id uuid, username text, is_admin boolean, can_create_quote boolean,
  allowed_stock_locations text[], allowed_brands text[],
  price_display_type text, created_at timestamptz, updated_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT id, username, is_admin, can_create_quote, allowed_stock_locations, allowed_brands, price_display_type, created_at, updated_at
  FROM public.app_users
  WHERE app_users.username = p_username;
$$;

-- 5. SECURE ACTIVITY_LOGS: Drop public INSERT policy
DROP POLICY IF EXISTS "Allow insert activity_logs" ON public.activity_logs;

-- 6. Create secure insert function for activity logs
CREATE OR REPLACE FUNCTION public.insert_activity_log(
  p_user_id text DEFAULT NULL,
  p_username text DEFAULT 'unknown',
  p_action text DEFAULT '',
  p_details text DEFAULT NULL,
  p_entity_type text DEFAULT NULL,
  p_entity_id text DEFAULT NULL
)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  INSERT INTO public.activity_logs (user_id, username, action, details, entity_type, entity_id)
  VALUES (p_user_id, p_username, p_action, p_details, p_entity_type, p_entity_id);
$$;

-- 7. Drop public SELECT on activity_logs, replace with restricted read function
DROP POLICY IF EXISTS "Allow read activity_logs" ON public.activity_logs;

-- 8. Create secure read functions for activity logs
CREATE OR REPLACE FUNCTION public.get_recent_activity_logs(p_limit integer DEFAULT 50)
RETURNS TABLE (
  id uuid, user_id text, username text, action text, details text,
  entity_type text, entity_id text, created_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT id, user_id, username, action, details, entity_type, entity_id, created_at
  FROM public.activity_logs
  ORDER BY created_at DESC
  LIMIT p_limit;
$$;

CREATE OR REPLACE FUNCTION public.get_activity_logs_by_user(p_username text, p_limit integer DEFAULT 50)
RETURNS TABLE (
  id uuid, user_id text, username text, action text, details text,
  entity_type text, entity_id text, created_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT id, user_id, username, action, details, entity_type, entity_id, created_at
  FROM public.activity_logs
  WHERE activity_logs.username = p_username
  ORDER BY created_at DESC
  LIMIT p_limit;
$$;
