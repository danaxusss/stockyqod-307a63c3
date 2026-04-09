
-- Grant execute on all the new secure functions to anon and authenticated roles
GRANT EXECUTE ON FUNCTION public.get_app_users_safe() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_app_user_by_id_safe(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_app_user_by_username_safe(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.insert_activity_log(text, text, text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_recent_activity_logs(integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_activity_logs_by_user(text, integer) TO anon, authenticated;
