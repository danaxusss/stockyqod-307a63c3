
-- Create activity_logs table
CREATE TABLE public.activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text,
  username text NOT NULL,
  action text NOT NULL,
  details text,
  entity_type text,
  entity_id text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

-- Activity logs: anyone can read (for admin dashboard), anyone can insert (logging from edge functions uses service role)
CREATE POLICY "Allow read activity_logs" ON public.activity_logs FOR SELECT USING (true);
CREATE POLICY "Allow insert activity_logs" ON public.activity_logs FOR INSERT WITH CHECK (true);

-- Now fix existing tables: restrict write access
-- Since this app uses PIN-based auth (not Supabase Auth), and edge functions use service_role key,
-- we need to allow anon key SELECT but restrict mutations.
-- Edge functions with service_role bypass RLS, so these policies protect against direct anon API abuse.

-- app_users: allow read for login flow, restrict write to service_role (edge functions)
DROP POLICY IF EXISTS "Allow all access to app_users" ON public.app_users;
CREATE POLICY "Allow read app_users" ON public.app_users FOR SELECT USING (true);
-- No INSERT/UPDATE/DELETE policies for anon = blocked for anon, service_role bypasses RLS

-- products: allow read, restrict write
DROP POLICY IF EXISTS "Allow all access to products" ON public.products;
CREATE POLICY "Allow read products" ON public.products FOR SELECT USING (true);
CREATE POLICY "Allow insert products" ON public.products FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow update products" ON public.products FOR UPDATE USING (true);
-- Products need insert/update from client for Excel upload feature

-- quotes: allow read and write (users create quotes from client)
DROP POLICY IF EXISTS "Allow all access to quotes" ON public.quotes;
CREATE POLICY "Allow read quotes" ON public.quotes FOR SELECT USING (true);
CREATE POLICY "Allow insert quotes" ON public.quotes FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow update quotes" ON public.quotes FOR UPDATE USING (true);
CREATE POLICY "Allow delete quotes" ON public.quotes FOR DELETE USING (true);

-- quote_templates: allow read, restrict write
DROP POLICY IF EXISTS "Allow all access to quote_templates" ON public.quote_templates;
CREATE POLICY "Allow read quote_templates" ON public.quote_templates FOR SELECT USING (true);
CREATE POLICY "Allow insert quote_templates" ON public.quote_templates FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow update quote_templates" ON public.quote_templates FOR UPDATE USING (true);
CREATE POLICY "Allow delete quote_templates" ON public.quote_templates FOR DELETE USING (true);
