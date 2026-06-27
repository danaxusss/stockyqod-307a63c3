-- Standalone Tasks-only accounts (technician/driver with no main-app access).
-- Modeled as a boolean flag so we never write unsupported values into the
-- constrained new_role column. A tasks-only user has new_role = NULL,
-- tasks_only = true, and tasks_role in ('technician','driver').

ALTER TABLE public.app_users
  ADD COLUMN IF NOT EXISTS tasks_only BOOLEAN NOT NULL DEFAULT false;

-- Expose tasks_only (and tasks_role) through the "safe" read RPCs.
DROP FUNCTION IF EXISTS public.get_app_users_safe();
DROP FUNCTION IF EXISTS public.get_app_user_by_id_safe(uuid);
DROP FUNCTION IF EXISTS public.get_app_user_by_username_safe(text);

CREATE FUNCTION public.get_app_users_safe()
 RETURNS TABLE(id uuid, username text, is_admin boolean, can_create_quote boolean, allowed_stock_locations text[], allowed_brands text[], price_display_type text, custom_seller_name text, tasks_role text, tasks_only boolean, created_at timestamptz, updated_at timestamptz)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT id, username, is_admin, can_create_quote, allowed_stock_locations, allowed_brands, price_display_type, custom_seller_name, tasks_role, tasks_only, created_at, updated_at FROM public.app_users ORDER BY created_at DESC; $$;

CREATE FUNCTION public.get_app_user_by_id_safe(p_id uuid)
 RETURNS TABLE(id uuid, username text, is_admin boolean, can_create_quote boolean, allowed_stock_locations text[], allowed_brands text[], price_display_type text, custom_seller_name text, tasks_role text, tasks_only boolean, created_at timestamptz, updated_at timestamptz)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT id, username, is_admin, can_create_quote, allowed_stock_locations, allowed_brands, price_display_type, custom_seller_name, tasks_role, tasks_only, created_at, updated_at FROM public.app_users WHERE app_users.id = p_id; $$;

CREATE FUNCTION public.get_app_user_by_username_safe(p_username text)
 RETURNS TABLE(id uuid, username text, is_admin boolean, can_create_quote boolean, allowed_stock_locations text[], allowed_brands text[], price_display_type text, custom_seller_name text, tasks_role text, tasks_only boolean, created_at timestamptz, updated_at timestamptz)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT id, username, is_admin, can_create_quote, allowed_stock_locations, allowed_brands, price_display_type, custom_seller_name, tasks_role, tasks_only, created_at, updated_at FROM public.app_users WHERE app_users.username = p_username; $$;

GRANT EXECUTE ON FUNCTION public.get_app_users_safe()              TO anon;
GRANT EXECUTE ON FUNCTION public.get_app_user_by_id_safe(uuid)     TO anon;
GRANT EXECUTE ON FUNCTION public.get_app_user_by_username_safe(text) TO anon;

NOTIFY pgrst, 'reload schema';
