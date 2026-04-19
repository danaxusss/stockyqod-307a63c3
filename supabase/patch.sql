-- ============================================================
-- Stocky QOD — idempotent schema patch
-- Safe to run on existing DB: uses IF NOT EXISTS / OR REPLACE
-- ============================================================

-- ── activity_logs ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text,
  username text NOT NULL,
  action text NOT NULL,
  details text,
  entity_type text,
  entity_id text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow read activity_logs" ON public.activity_logs;
DROP POLICY IF EXISTS "Allow insert activity_logs" ON public.activity_logs;

-- ── company_settings ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.company_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  website text NOT NULL DEFAULT '',
  ice text NOT NULL DEFAULT '',
  logo_url text,
  quote_visible_fields jsonb NOT NULL DEFAULT '{
    "showLogo": true,
    "showCompanyAddress": true,
    "showCompanyPhone": true,
    "showCompanyEmail": true,
    "showCompanyWebsite": false,
    "showCompanyICE": true,
    "showClientICE": true,
    "showTVA": true,
    "showNotes": true,
    "showPaymentTerms": true,
    "showValidityDate": true
  }'::jsonb,
  payment_terms text NOT NULL DEFAULT '30 jours',
  tva_rate numeric NOT NULL DEFAULT 20,
  quote_validity_days integer NOT NULL DEFAULT 30,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.company_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow read company_settings" ON public.company_settings;
DROP POLICY IF EXISTS "Allow insert company_settings" ON public.company_settings;
DROP POLICY IF EXISTS "Allow update company_settings" ON public.company_settings;
CREATE POLICY "Allow read company_settings" ON public.company_settings FOR SELECT USING (true);
CREATE POLICY "Allow insert company_settings" ON public.company_settings FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow update company_settings" ON public.company_settings FOR UPDATE USING (true);
DROP TRIGGER IF EXISTS update_company_settings_updated_at ON public.company_settings;
CREATE TRIGGER update_company_settings_updated_at
  BEFORE UPDATE ON public.company_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
INSERT INTO public.company_settings (id) SELECT gen_random_uuid() WHERE NOT EXISTS (SELECT 1 FROM public.company_settings);

-- Additional company_settings columns
ALTER TABLE public.company_settings ADD COLUMN IF NOT EXISTS quote_style jsonb NOT NULL DEFAULT '{"accentColor": "#3B82F6", "fontFamily": "helvetica", "showBorders": true, "borderRadius": 1, "headerSize": "large", "totalsStyle": "highlighted"}'::jsonb;
ALTER TABLE public.company_settings ADD COLUMN IF NOT EXISTS rc text NOT NULL DEFAULT '';
ALTER TABLE public.company_settings ADD COLUMN IF NOT EXISTS if_number text NOT NULL DEFAULT '';
ALTER TABLE public.company_settings ADD COLUMN IF NOT EXISTS cnss text NOT NULL DEFAULT '';
ALTER TABLE public.company_settings ADD COLUMN IF NOT EXISTS patente text NOT NULL DEFAULT '';
ALTER TABLE public.company_settings ADD COLUMN IF NOT EXISTS phone2 text NOT NULL DEFAULT '';
ALTER TABLE public.company_settings ADD COLUMN IF NOT EXISTS phone_dir text NOT NULL DEFAULT '';
ALTER TABLE public.company_settings ADD COLUMN IF NOT EXISTS phone_gsm text NOT NULL DEFAULT '';
ALTER TABLE public.company_settings ADD COLUMN IF NOT EXISTS logo_size text NOT NULL DEFAULT 'medium';

-- ── app_users: migrate jsonb columns → text[], add missing column ──
DO $$
BEGIN
  -- Convert allowed_stock_locations jsonb → text[]
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'app_users' AND column_name = 'allowed_stock_locations' AND data_type = 'jsonb'
  ) THEN
    ALTER TABLE public.app_users ADD COLUMN allowed_stock_locations_tmp text[] NOT NULL DEFAULT '{}';
    UPDATE public.app_users SET allowed_stock_locations_tmp = (
      SELECT COALESCE(array_agg(v), '{}') FROM jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(allowed_stock_locations) = 'array' THEN allowed_stock_locations ELSE '[]'::jsonb END
      ) AS t(v)
    );
    ALTER TABLE public.app_users DROP COLUMN allowed_stock_locations;
    ALTER TABLE public.app_users RENAME COLUMN allowed_stock_locations_tmp TO allowed_stock_locations;
  END IF;

  -- Convert allowed_brands jsonb → text[]
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'app_users' AND column_name = 'allowed_brands' AND data_type = 'jsonb'
  ) THEN
    ALTER TABLE public.app_users ADD COLUMN allowed_brands_tmp text[] NOT NULL DEFAULT '{}';
    UPDATE public.app_users SET allowed_brands_tmp = (
      SELECT COALESCE(array_agg(v), '{}') FROM jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(allowed_brands) = 'array' THEN allowed_brands ELSE '[]'::jsonb END
      ) AS t(v)
    );
    ALTER TABLE public.app_users DROP COLUMN allowed_brands;
    ALTER TABLE public.app_users RENAME COLUMN allowed_brands_tmp TO allowed_brands;
  END IF;
END $$;

ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS custom_seller_name text NOT NULL DEFAULT '';

-- ── RPCs ──────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.get_app_users_safe();
CREATE FUNCTION public.get_app_users_safe()
RETURNS TABLE(id uuid, username text, is_admin boolean, can_create_quote boolean,
  allowed_stock_locations text[], allowed_brands text[], price_display_type text,
  custom_seller_name text, created_at timestamptz, updated_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT id, username, is_admin, can_create_quote, allowed_stock_locations, allowed_brands,
    price_display_type, custom_seller_name, created_at, updated_at
  FROM public.app_users ORDER BY created_at DESC;
$$;

DROP FUNCTION IF EXISTS public.get_app_user_by_id_safe(uuid);
CREATE FUNCTION public.get_app_user_by_id_safe(p_id uuid)
RETURNS TABLE(id uuid, username text, is_admin boolean, can_create_quote boolean,
  allowed_stock_locations text[], allowed_brands text[], price_display_type text,
  custom_seller_name text, created_at timestamptz, updated_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT id, username, is_admin, can_create_quote, allowed_stock_locations, allowed_brands,
    price_display_type, custom_seller_name, created_at, updated_at
  FROM public.app_users WHERE app_users.id = p_id;
$$;

DROP FUNCTION IF EXISTS public.get_app_user_by_username_safe(text);
CREATE FUNCTION public.get_app_user_by_username_safe(p_username text)
RETURNS TABLE(id uuid, username text, is_admin boolean, can_create_quote boolean,
  allowed_stock_locations text[], allowed_brands text[], price_display_type text,
  custom_seller_name text, created_at timestamptz, updated_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT id, username, is_admin, can_create_quote, allowed_stock_locations, allowed_brands,
    price_display_type, custom_seller_name, created_at, updated_at
  FROM public.app_users WHERE app_users.username = p_username;
$$;

CREATE OR REPLACE FUNCTION public.insert_activity_log(
  p_user_id text DEFAULT NULL, p_username text DEFAULT 'unknown',
  p_action text DEFAULT '', p_details text DEFAULT NULL,
  p_entity_type text DEFAULT NULL, p_entity_id text DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  INSERT INTO public.activity_logs (user_id, username, action, details, entity_type, entity_id)
  VALUES (p_user_id, p_username, p_action, p_details, p_entity_type, p_entity_id);
$$;

CREATE OR REPLACE FUNCTION public.get_recent_activity_logs(p_limit integer DEFAULT 50)
RETURNS TABLE(id uuid, user_id text, username text, action text, details text,
  entity_type text, entity_id text, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT id, user_id, username, action, details, entity_type, entity_id, created_at
  FROM public.activity_logs ORDER BY created_at DESC LIMIT p_limit;
$$;

CREATE OR REPLACE FUNCTION public.get_activity_logs_by_user(p_username text, p_limit integer DEFAULT 50)
RETURNS TABLE(id uuid, user_id text, username text, action text, details text,
  entity_type text, entity_id text, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT id, user_id, username, action, details, entity_type, entity_id, created_at
  FROM public.activity_logs WHERE activity_logs.username = p_username
  ORDER BY created_at DESC LIMIT p_limit;
$$;

-- Grant execute to anon/authenticated
GRANT EXECUTE ON FUNCTION public.get_app_users_safe() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_app_user_by_id_safe(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_app_user_by_username_safe(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.insert_activity_log(text,text,text,text,text,text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_recent_activity_logs(integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_activity_logs_by_user(text,integer) TO anon, authenticated;

-- ── clients ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.clients (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  full_name TEXT NOT NULL DEFAULT '',
  phone_number TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  ice TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow read clients" ON public.clients;
DROP POLICY IF EXISTS "Allow insert clients" ON public.clients;
DROP POLICY IF EXISTS "Allow update clients" ON public.clients;
CREATE POLICY "Allow read clients" ON public.clients FOR SELECT USING (true);
CREATE POLICY "Allow insert clients" ON public.clients FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow update clients" ON public.clients FOR UPDATE USING (true);
DROP TRIGGER IF EXISTS update_clients_updated_at ON public.clients;
CREATE TRIGGER update_clients_updated_at
  BEFORE UPDATE ON public.clients FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ── storage buckets ───────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public) VALUES ('company-assets', 'company-assets', true) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('techsheets', 'techsheets', true) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('technical-sheets', 'technical-sheets', true) ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Allow public read company-assets" ON storage.objects;
DROP POLICY IF EXISTS "Allow upload company-assets" ON storage.objects;
DROP POLICY IF EXISTS "Allow update company-assets" ON storage.objects;
DROP POLICY IF EXISTS "Allow delete company-assets" ON storage.objects;
CREATE POLICY "Allow public read company-assets" ON storage.objects FOR SELECT USING (bucket_id = 'company-assets');
CREATE POLICY "Allow upload company-assets" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'company-assets');
CREATE POLICY "Allow update company-assets" ON storage.objects FOR UPDATE USING (bucket_id = 'company-assets');
CREATE POLICY "Allow delete company-assets" ON storage.objects FOR DELETE USING (bucket_id = 'company-assets');

DROP POLICY IF EXISTS "Public read techsheets" ON storage.objects;
DROP POLICY IF EXISTS "Public upload techsheets" ON storage.objects;
DROP POLICY IF EXISTS "Public update techsheets" ON storage.objects;
DROP POLICY IF EXISTS "Public delete techsheets" ON storage.objects;
CREATE POLICY "Public read techsheets" ON storage.objects FOR SELECT USING (bucket_id = 'techsheets');
CREATE POLICY "Public upload techsheets" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'techsheets');
CREATE POLICY "Public update techsheets" ON storage.objects FOR UPDATE USING (bucket_id = 'techsheets');
CREATE POLICY "Public delete techsheets" ON storage.objects FOR DELETE USING (bucket_id = 'techsheets');

DROP POLICY IF EXISTS "Public read technical-sheets" ON storage.objects;
DROP POLICY IF EXISTS "Public upload technical-sheets" ON storage.objects;
DROP POLICY IF EXISTS "Public update technical-sheets" ON storage.objects;
DROP POLICY IF EXISTS "Public delete technical-sheets" ON storage.objects;
CREATE POLICY "Public read technical-sheets" ON storage.objects FOR SELECT USING (bucket_id = 'technical-sheets');
CREATE POLICY "Public upload technical-sheets" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'technical-sheets');
CREATE POLICY "Public update technical-sheets" ON storage.objects FOR UPDATE USING (bucket_id = 'technical-sheets');
CREATE POLICY "Public delete technical-sheets" ON storage.objects FOR DELETE USING (bucket_id = 'technical-sheets');

-- ── technical_sheets ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.technical_sheets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  manufacturer TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  sector TEXT NOT NULL DEFAULT '',
  file_url TEXT NOT NULL DEFAULT '',
  file_size BIGINT NOT NULL DEFAULT 0,
  file_type TEXT NOT NULL DEFAULT 'application/pdf',
  view_count INTEGER NOT NULL DEFAULT 0,
  download_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
ALTER TABLE public.technical_sheets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow read technical_sheets" ON public.technical_sheets;
DROP POLICY IF EXISTS "Allow insert technical_sheets" ON public.technical_sheets;
DROP POLICY IF EXISTS "Allow update technical_sheets" ON public.technical_sheets;
DROP POLICY IF EXISTS "Allow delete technical_sheets" ON public.technical_sheets;
CREATE POLICY "Allow read technical_sheets" ON public.technical_sheets FOR SELECT USING (true);
CREATE POLICY "Allow insert technical_sheets" ON public.technical_sheets FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow update technical_sheets" ON public.technical_sheets FOR UPDATE USING (true);
CREATE POLICY "Allow delete technical_sheets" ON public.technical_sheets FOR DELETE USING (true);
DROP TRIGGER IF EXISTS update_technical_sheets_updated_at ON public.technical_sheets;
CREATE TRIGGER update_technical_sheets_updated_at
  BEFORE UPDATE ON public.technical_sheets FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.technical_sheet_products (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sheet_id UUID NOT NULL REFERENCES public.technical_sheets(id) ON DELETE CASCADE,
  product_barcode TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(sheet_id, product_barcode)
);
ALTER TABLE public.technical_sheet_products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow read technical_sheet_products" ON public.technical_sheet_products;
DROP POLICY IF EXISTS "Allow insert technical_sheet_products" ON public.technical_sheet_products;
DROP POLICY IF EXISTS "Allow update technical_sheet_products" ON public.technical_sheet_products;
DROP POLICY IF EXISTS "Allow delete technical_sheet_products" ON public.technical_sheet_products;
CREATE POLICY "Allow read technical_sheet_products" ON public.technical_sheet_products FOR SELECT USING (true);
CREATE POLICY "Allow insert technical_sheet_products" ON public.technical_sheet_products FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow update technical_sheet_products" ON public.technical_sheet_products FOR UPDATE USING (true);
CREATE POLICY "Allow delete technical_sheet_products" ON public.technical_sheet_products FOR DELETE USING (true);

CREATE TABLE IF NOT EXISTS public.sheet_share_links (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  title TEXT,
  sheet_ids UUID[] NOT NULL DEFAULT '{}',
  expires_at TIMESTAMP WITH TIME ZONE,
  view_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
ALTER TABLE public.sheet_share_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow read sheet_share_links" ON public.sheet_share_links;
DROP POLICY IF EXISTS "Allow insert sheet_share_links" ON public.sheet_share_links;
DROP POLICY IF EXISTS "Allow update sheet_share_links" ON public.sheet_share_links;
DROP POLICY IF EXISTS "Allow delete sheet_share_links" ON public.sheet_share_links;
CREATE POLICY "Allow read sheet_share_links" ON public.sheet_share_links FOR SELECT USING (true);
CREATE POLICY "Allow insert sheet_share_links" ON public.sheet_share_links FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow update sheet_share_links" ON public.sheet_share_links FOR UPDATE USING (true);
CREATE POLICY "Allow delete sheet_share_links" ON public.sheet_share_links FOR DELETE USING (true);

-- ── product_name_overrides ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.product_name_overrides (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('brand', 'provider')),
  original_name TEXT NOT NULL,
  custom_name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (type, original_name)
);
ALTER TABLE public.product_name_overrides ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow read product_name_overrides" ON public.product_name_overrides;
DROP POLICY IF EXISTS "Allow insert product_name_overrides" ON public.product_name_overrides;
DROP POLICY IF EXISTS "Allow update product_name_overrides" ON public.product_name_overrides;
DROP POLICY IF EXISTS "Allow delete product_name_overrides" ON public.product_name_overrides;
CREATE POLICY "Allow read product_name_overrides" ON public.product_name_overrides FOR SELECT USING (true);
CREATE POLICY "Allow insert product_name_overrides" ON public.product_name_overrides FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow update product_name_overrides" ON public.product_name_overrides FOR UPDATE USING (true);
CREATE POLICY "Allow delete product_name_overrides" ON public.product_name_overrides FOR DELETE USING (true);

-- ── quotes status constraint (add 'pending') ──────────────────
ALTER TABLE public.quotes DROP CONSTRAINT IF EXISTS quotes_status_check;
ALTER TABLE public.quotes ADD CONSTRAINT quotes_status_check
  CHECK (status = ANY (ARRAY['draft'::text, 'pending'::text, 'final'::text]));

-- ── companies (sub-company support) ──────────────────────────
CREATE TABLE IF NOT EXISTS public.companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  phone2 text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  website text NOT NULL DEFAULT '',
  ice text NOT NULL DEFAULT '',
  rc text NOT NULL DEFAULT '',
  if_number text NOT NULL DEFAULT '',
  cnss text NOT NULL DEFAULT '',
  patente text NOT NULL DEFAULT '',
  logo_url text,
  logo_size text NOT NULL DEFAULT 'medium',
  accent_color text NOT NULL DEFAULT '#3B82F6',
  font_family text NOT NULL DEFAULT 'helvetica',
  tva_rate numeric NOT NULL DEFAULT 20,
  quote_validity_days integer NOT NULL DEFAULT 30,
  payment_terms text NOT NULL DEFAULT '',
  share_templates jsonb NOT NULL DEFAULT '{}',
  quote_visible_fields jsonb NOT NULL DEFAULT '{}',
  quote_style jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow read companies" ON public.companies;
DROP POLICY IF EXISTS "Allow insert companies" ON public.companies;
DROP POLICY IF EXISTS "Allow update companies" ON public.companies;
DROP POLICY IF EXISTS "Allow delete companies" ON public.companies;
CREATE POLICY "Allow read companies" ON public.companies FOR SELECT USING (true);
CREATE POLICY "Allow insert companies" ON public.companies FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow update companies" ON public.companies FOR UPDATE USING (true);
CREATE POLICY "Allow delete companies" ON public.companies FOR DELETE USING (true);
DROP TRIGGER IF EXISTS update_companies_updated_at ON public.companies;
CREATE TRIGGER update_companies_updated_at
  BEFORE UPDATE ON public.companies FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Seed one default company from existing company_settings (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.companies) THEN
    INSERT INTO public.companies (name, address, phone, email, website, ice)
      SELECT
        COALESCE(NULLIF(company_name, ''), 'Ma Société'),
        COALESCE(address, ''),
        COALESCE(phone, ''),
        COALESCE(email, ''),
        COALESCE(website, ''),
        COALESCE(ice, '')
      FROM public.company_settings LIMIT 1;
  END IF;
END $$;

-- Add is_superadmin and company_id to app_users
ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS is_superadmin boolean NOT NULL DEFAULT false;
ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;

-- Assign all existing users without a company to the default company
UPDATE public.app_users
  SET company_id = (SELECT id FROM public.companies ORDER BY created_at LIMIT 1)
  WHERE company_id IS NULL;

-- Add company_id to clients
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;

-- Assign existing clients to default company
UPDATE public.clients
  SET company_id = (SELECT id FROM public.companies ORDER BY created_at LIMIT 1)
  WHERE company_id IS NULL;

-- Add company_id to quotes (quotes table may use a different schema)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'quotes' AND table_schema = 'public') THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'quotes' AND column_name = 'company_id' AND table_schema = 'public') THEN
      ALTER TABLE public.quotes ADD COLUMN company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;
    END IF;
    UPDATE public.quotes SET company_id = (SELECT id FROM public.companies ORDER BY created_at LIMIT 1) WHERE company_id IS NULL;
  END IF;
END $$;

-- Update RPCs to include is_superadmin and company_id
DROP FUNCTION IF EXISTS public.get_app_users_safe();
CREATE FUNCTION public.get_app_users_safe()
RETURNS TABLE(id uuid, username text, is_admin boolean, is_superadmin boolean, company_id uuid,
  can_create_quote boolean, allowed_stock_locations text[], allowed_brands text[],
  price_display_type text, custom_seller_name text, created_at timestamptz, updated_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT id, username, is_admin, is_superadmin, company_id, can_create_quote,
    allowed_stock_locations, allowed_brands, price_display_type, custom_seller_name,
    created_at, updated_at
  FROM public.app_users ORDER BY created_at DESC;
$$;

DROP FUNCTION IF EXISTS public.get_app_user_by_id_safe(uuid);
CREATE FUNCTION public.get_app_user_by_id_safe(p_id uuid)
RETURNS TABLE(id uuid, username text, is_admin boolean, is_superadmin boolean, company_id uuid,
  can_create_quote boolean, allowed_stock_locations text[], allowed_brands text[],
  price_display_type text, custom_seller_name text, created_at timestamptz, updated_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT id, username, is_admin, is_superadmin, company_id, can_create_quote,
    allowed_stock_locations, allowed_brands, price_display_type, custom_seller_name,
    created_at, updated_at
  FROM public.app_users WHERE app_users.id = p_id;
$$;

DROP FUNCTION IF EXISTS public.get_app_user_by_username_safe(text);
CREATE FUNCTION public.get_app_user_by_username_safe(p_username text)
RETURNS TABLE(id uuid, username text, is_admin boolean, is_superadmin boolean, company_id uuid,
  can_create_quote boolean, allowed_stock_locations text[], allowed_brands text[],
  price_display_type text, custom_seller_name text, created_at timestamptz, updated_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT id, username, is_admin, is_superadmin, company_id, can_create_quote,
    allowed_stock_locations, allowed_brands, price_display_type, custom_seller_name,
    created_at, updated_at
  FROM public.app_users WHERE app_users.username = p_username;
$$;

GRANT EXECUTE ON FUNCTION public.get_app_users_safe() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_app_user_by_id_safe(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_app_user_by_username_safe(text) TO anon, authenticated;

-- Add clients DELETE policy (needed for client deletion to work)
DROP POLICY IF EXISTS "Allow delete clients" ON public.clients;
CREATE POLICY "Allow delete clients" ON public.clients FOR DELETE USING (true);

-- ── companies: stamp + AI columns ────────────────────────────
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS stamp_url text;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS stamp_size text NOT NULL DEFAULT 'medium';
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS use_stamp boolean NOT NULL DEFAULT false;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS ai_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS ai_model text NOT NULL DEFAULT 'deepseek/deepseek-chat-v3-0324:free';
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS ai_system_prompt text NOT NULL DEFAULT '';

-- ── quotes: created_by ────────────────────────────────────────
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS created_by text;

-- ── quotes: RLS policies (allow anon CRUD — app uses PIN auth not Supabase auth) ──
ALTER TABLE public.quotes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow read quotes" ON public.quotes;
DROP POLICY IF EXISTS "Allow insert quotes" ON public.quotes;
DROP POLICY IF EXISTS "Allow update quotes" ON public.quotes;
DROP POLICY IF EXISTS "Allow delete quotes" ON public.quotes;
CREATE POLICY "Allow read quotes"   ON public.quotes FOR SELECT USING (true);
CREATE POLICY "Allow insert quotes" ON public.quotes FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow update quotes" ON public.quotes FOR UPDATE USING (true);
CREATE POLICY "Allow delete quotes" ON public.quotes FOR DELETE USING (true);

-- ── Clear stale shared logo URLs (each company must re-upload) ─
UPDATE public.companies SET logo_url = NULL WHERE logo_url IS NOT NULL AND logo_url NOT LIKE '%/companies/%';

-- ══════════════════════════════════════════════════════════════
-- FINANCIAL DOCUMENT PIPELINE — compta role
-- ══════════════════════════════════════════════════════════════

-- ── app_users: compta role flag ───────────────────────────────
ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS is_compta boolean NOT NULL DEFAULT false;

-- Update RPCs to include is_compta
DROP FUNCTION IF EXISTS public.get_app_users_safe();
CREATE FUNCTION public.get_app_users_safe()
RETURNS TABLE(id uuid, username text, is_admin boolean, is_superadmin boolean, is_compta boolean,
  company_id uuid, can_create_quote boolean, allowed_stock_locations text[], allowed_brands text[],
  price_display_type text, custom_seller_name text, created_at timestamptz, updated_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT id, username, is_admin, is_superadmin, is_compta, company_id, can_create_quote,
    allowed_stock_locations, allowed_brands, price_display_type, custom_seller_name,
    created_at, updated_at
  FROM public.app_users ORDER BY created_at DESC;
$$;

DROP FUNCTION IF EXISTS public.get_app_user_by_id_safe(uuid);
CREATE FUNCTION public.get_app_user_by_id_safe(p_id uuid)
RETURNS TABLE(id uuid, username text, is_admin boolean, is_superadmin boolean, is_compta boolean,
  company_id uuid, can_create_quote boolean, allowed_stock_locations text[], allowed_brands text[],
  price_display_type text, custom_seller_name text, created_at timestamptz, updated_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT id, username, is_admin, is_superadmin, is_compta, company_id, can_create_quote,
    allowed_stock_locations, allowed_brands, price_display_type, custom_seller_name,
    created_at, updated_at
  FROM public.app_users WHERE app_users.id = p_id;
$$;

DROP FUNCTION IF EXISTS public.get_app_user_by_username_safe(text);
CREATE FUNCTION public.get_app_user_by_username_safe(p_username text)
RETURNS TABLE(id uuid, username text, is_admin boolean, is_superadmin boolean, is_compta boolean,
  company_id uuid, can_create_quote boolean, allowed_stock_locations text[], allowed_brands text[],
  price_display_type text, custom_seller_name text, created_at timestamptz, updated_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT id, username, is_admin, is_superadmin, is_compta, company_id, can_create_quote,
    allowed_stock_locations, allowed_brands, price_display_type, custom_seller_name,
    created_at, updated_at
  FROM public.app_users WHERE app_users.username = p_username;
$$;

GRANT EXECUTE ON FUNCTION public.get_app_users_safe() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_app_user_by_id_safe(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_app_user_by_username_safe(text) TO anon, authenticated;

-- ── quotes: drop global unique constraint on quote_number ────
-- Numbers are sequential per-company; global uniqueness breaks multi-company setups.
-- Documents are identified by UUID id, not by quote_number.
ALTER TABLE public.quotes DROP CONSTRAINT IF EXISTS quotes_quote_number_key;

-- ── quotes: document pipeline columns ────────────────────────
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS document_type text NOT NULL DEFAULT 'quote';
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS parent_document_id uuid REFERENCES public.quotes(id) ON DELETE SET NULL;
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS source_bl_ids uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS paid_amount numeric NOT NULL DEFAULT 0;
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS issuing_company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;

-- Extend status constraint to include 'solde'
ALTER TABLE public.quotes DROP CONSTRAINT IF EXISTS quotes_status_check;
ALTER TABLE public.quotes ADD CONSTRAINT quotes_status_check
  CHECK (status = ANY (ARRAY['draft'::text, 'pending'::text, 'final'::text, 'solde'::text]));

-- Add document_type constraint
ALTER TABLE public.quotes DROP CONSTRAINT IF EXISTS quotes_document_type_check;
ALTER TABLE public.quotes ADD CONSTRAINT quotes_document_type_check
  CHECK (document_type = ANY (ARRAY['quote'::text, 'bl'::text, 'proforma'::text, 'invoice'::text]));

-- ── document_counters: atomic sequential numbering per company ─
CREATE TABLE IF NOT EXISTS public.document_counters (
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  document_type text NOT NULL,
  last_number integer NOT NULL DEFAULT 0,
  PRIMARY KEY (company_id, document_type)
);
ALTER TABLE public.document_counters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all document_counters" ON public.document_counters;
CREATE POLICY "Allow all document_counters" ON public.document_counters
  FOR ALL USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.next_document_number(p_company_id uuid, p_doc_type text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_next integer;
BEGIN
  INSERT INTO public.document_counters (company_id, document_type, last_number)
    VALUES (p_company_id, p_doc_type, 1)
  ON CONFLICT (company_id, document_type)
    DO UPDATE SET last_number = document_counters.last_number + 1
  RETURNING last_number INTO v_next;
  RETURN v_next;
END;
$$;
GRANT EXECUTE ON FUNCTION public.next_document_number(uuid, text) TO anon, authenticated;
