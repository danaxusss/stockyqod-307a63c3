-- FIX: earlier migrations that added tasks_role/tasks_only to the "safe" user
-- RPCs accidentally returned only a subset of columns, dropping is_superadmin,
-- is_compta, new_role, cross_branch_read, company_id and phone. That made the
-- User Management list load users without their role, so saving an edit wrote
-- back empty values and demoted accounts (e.g. the super admin).
-- This restores the full column set the client expects (SafeAppUserRow).

DROP FUNCTION IF EXISTS public.get_app_users_safe();
DROP FUNCTION IF EXISTS public.get_app_user_by_id_safe(uuid);
DROP FUNCTION IF EXISTS public.get_app_user_by_username_safe(text);

CREATE FUNCTION public.get_app_users_safe()
 RETURNS TABLE(id uuid, username text, is_admin boolean, is_superadmin boolean, is_compta boolean, new_role text, cross_branch_read boolean, company_id uuid, can_create_quote boolean, allowed_stock_locations text[], allowed_brands text[], price_display_type text, custom_seller_name text, phone text, tasks_role text, tasks_only boolean, created_at timestamptz, updated_at timestamptz)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT id, username, is_admin, is_superadmin, is_compta, new_role::text, cross_branch_read, company_id, can_create_quote, allowed_stock_locations, allowed_brands, price_display_type, custom_seller_name, phone, tasks_role, tasks_only, created_at, updated_at
  FROM public.app_users ORDER BY created_at DESC;
$$;

CREATE FUNCTION public.get_app_user_by_id_safe(p_id uuid)
 RETURNS TABLE(id uuid, username text, is_admin boolean, is_superadmin boolean, is_compta boolean, new_role text, cross_branch_read boolean, company_id uuid, can_create_quote boolean, allowed_stock_locations text[], allowed_brands text[], price_display_type text, custom_seller_name text, phone text, tasks_role text, tasks_only boolean, created_at timestamptz, updated_at timestamptz)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT id, username, is_admin, is_superadmin, is_compta, new_role::text, cross_branch_read, company_id, can_create_quote, allowed_stock_locations, allowed_brands, price_display_type, custom_seller_name, phone, tasks_role, tasks_only, created_at, updated_at
  FROM public.app_users WHERE app_users.id = p_id;
$$;

CREATE FUNCTION public.get_app_user_by_username_safe(p_username text)
 RETURNS TABLE(id uuid, username text, is_admin boolean, is_superadmin boolean, is_compta boolean, new_role text, cross_branch_read boolean, company_id uuid, can_create_quote boolean, allowed_stock_locations text[], allowed_brands text[], price_display_type text, custom_seller_name text, phone text, tasks_role text, tasks_only boolean, created_at timestamptz, updated_at timestamptz)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT id, username, is_admin, is_superadmin, is_compta, new_role::text, cross_branch_read, company_id, can_create_quote, allowed_stock_locations, allowed_brands, price_display_type, custom_seller_name, phone, tasks_role, tasks_only, created_at, updated_at
  FROM public.app_users WHERE app_users.username = p_username;
$$;

GRANT EXECUTE ON FUNCTION public.get_app_users_safe()              TO anon;
GRANT EXECUTE ON FUNCTION public.get_app_user_by_id_safe(uuid)     TO anon;
GRANT EXECUTE ON FUNCTION public.get_app_user_by_username_safe(text) TO anon;

NOTIFY pgrst, 'reload schema';
