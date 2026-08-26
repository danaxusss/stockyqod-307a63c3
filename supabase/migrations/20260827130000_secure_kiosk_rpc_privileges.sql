-- Kiosk RPCs are internal implementation details of the kiosk Edge Function.
-- Supabase default privileges may grant EXECUTE directly to API roles, so
-- revoking only PUBLIC is insufficient on an existing project.

REVOKE ALL ON FUNCTION public.kiosk_catalog_search(uuid, text, uuid, integer, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_kiosk_request(uuid, text, text, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kiosk_admin_product_search(uuid, text, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kiosk_company_brands(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_kiosk_request(uuid, text, text, text, text, text, uuid, uuid, text, jsonb, uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.convert_kiosk_request(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.kiosk_catalog_search(uuid, text, uuid, integer, integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.create_kiosk_request(uuid, text, text, text, text, jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.kiosk_admin_product_search(uuid, text, integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.kiosk_company_brands(uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.update_kiosk_request(uuid, text, text, text, text, text, uuid, uuid, text, jsonb, uuid, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.convert_kiosk_request(uuid, uuid, text)
  TO service_role;
