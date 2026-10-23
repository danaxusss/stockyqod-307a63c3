-- Per-user permission to edit products (name, prices, supplier, kiosk type,
-- sectors, images). Super admins, admins and managers can always edit; this
-- flag lets an admin open product editing to any other user, e.g. someone
-- working only on product photos. Off by default.

ALTER TABLE public.app_users
  ADD COLUMN IF NOT EXISTS can_edit_products boolean NOT NULL DEFAULT false;

-- The "safe" user RPCs must return the new column: User Management loads
-- users through them and writes the form back, so a missing column would
-- silently reset the permission on every save. Same full column list as
-- 20260627150000_safe_rpc_full_columns.sql, plus can_edit_products.

DROP FUNCTION IF EXISTS public.get_app_users_safe();
DROP FUNCTION IF EXISTS public.get_app_user_by_id_safe(uuid);
DROP FUNCTION IF EXISTS public.get_app_user_by_username_safe(text);

CREATE FUNCTION public.get_app_users_safe()
 RETURNS TABLE(id uuid, username text, is_admin boolean, is_superadmin boolean, is_compta boolean, new_role text, cross_branch_read boolean, company_id uuid, can_create_quote boolean, can_edit_products boolean, allowed_stock_locations text[], allowed_brands text[], price_display_type text, custom_seller_name text, phone text, tasks_role text, tasks_only boolean, created_at timestamptz, updated_at timestamptz)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT id, username, is_admin, is_superadmin, is_compta, new_role::text, cross_branch_read, company_id, can_create_quote, can_edit_products, allowed_stock_locations, allowed_brands, price_display_type, custom_seller_name, phone, tasks_role, tasks_only, created_at, updated_at
  FROM public.app_users ORDER BY created_at DESC;
$$;

CREATE FUNCTION public.get_app_user_by_id_safe(p_id uuid)
 RETURNS TABLE(id uuid, username text, is_admin boolean, is_superadmin boolean, is_compta boolean, new_role text, cross_branch_read boolean, company_id uuid, can_create_quote boolean, can_edit_products boolean, allowed_stock_locations text[], allowed_brands text[], price_display_type text, custom_seller_name text, phone text, tasks_role text, tasks_only boolean, created_at timestamptz, updated_at timestamptz)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT id, username, is_admin, is_superadmin, is_compta, new_role::text, cross_branch_read, company_id, can_create_quote, can_edit_products, allowed_stock_locations, allowed_brands, price_display_type, custom_seller_name, phone, tasks_role, tasks_only, created_at, updated_at
  FROM public.app_users WHERE app_users.id = p_id;
$$;

CREATE FUNCTION public.get_app_user_by_username_safe(p_username text)
 RETURNS TABLE(id uuid, username text, is_admin boolean, is_superadmin boolean, is_compta boolean, new_role text, cross_branch_read boolean, company_id uuid, can_create_quote boolean, can_edit_products boolean, allowed_stock_locations text[], allowed_brands text[], price_display_type text, custom_seller_name text, phone text, tasks_role text, tasks_only boolean, created_at timestamptz, updated_at timestamptz)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT id, username, is_admin, is_superadmin, is_compta, new_role::text, cross_branch_read, company_id, can_create_quote, can_edit_products, allowed_stock_locations, allowed_brands, price_display_type, custom_seller_name, phone, tasks_role, tasks_only, created_at, updated_at
  FROM public.app_users WHERE app_users.username = p_username;
$$;

GRANT EXECUTE ON FUNCTION public.get_app_users_safe()              TO anon;
GRANT EXECUTE ON FUNCTION public.get_app_user_by_id_safe(uuid)     TO anon;
GRANT EXECUTE ON FUNCTION public.get_app_user_by_username_safe(text) TO anon;

NOTIFY pgrst, 'reload schema';
