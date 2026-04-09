
-- Create products table
CREATE TABLE public.products (
  barcode TEXT NOT NULL PRIMARY KEY,
  name TEXT NOT NULL,
  brand TEXT NOT NULL DEFAULT '',
  techsheet TEXT NOT NULL DEFAULT '',
  price NUMERIC NOT NULL DEFAULT 0,
  buyprice NUMERIC NOT NULL DEFAULT 0,
  reseller_price NUMERIC NOT NULL DEFAULT 0,
  provider TEXT NOT NULL DEFAULT '',
  stock_levels JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create app_users table
CREATE TABLE public.app_users (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  pin TEXT NOT NULL,
  is_admin BOOLEAN NOT NULL DEFAULT false,
  can_create_quote BOOLEAN NOT NULL DEFAULT true,
  allowed_stock_locations TEXT[] NOT NULL DEFAULT '{}',
  allowed_brands TEXT[] NOT NULL DEFAULT '{}',
  price_display_type TEXT NOT NULL DEFAULT 'normal' CHECK (price_display_type IN ('normal', 'reseller', 'buy', 'calculated')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create quotes table
CREATE TABLE public.quotes (
  id TEXT NOT NULL PRIMARY KEY,
  quote_number TEXT NOT NULL,
  command_number TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'final')),
  customer_info JSONB NOT NULL DEFAULT '{}'::jsonb,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_amount NUMERIC NOT NULL DEFAULT 0,
  notes TEXT
);

-- Create quote_templates table
CREATE TABLE public.quote_templates (
  id TEXT NOT NULL PRIMARY KEY,
  name TEXT NOT NULL,
  file_data BYTEA NOT NULL,
  file_type TEXT NOT NULL,
  uploaded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  is_active BOOLEAN NOT NULL DEFAULT false
);

-- Enable RLS on all tables
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_templates ENABLE ROW LEVEL SECURITY;

-- Open access policies (PIN-based auth, not Supabase auth)
CREATE POLICY "Allow all access to products" ON public.products FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to app_users" ON public.app_users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to quotes" ON public.quotes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to quote_templates" ON public.quote_templates FOR ALL USING (true) WITH CHECK (true);

-- Timestamp update function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Triggers for auto-updating timestamps
CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_app_users_updated_at BEFORE UPDATE ON public.app_users FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_quotes_updated_at BEFORE UPDATE ON public.quotes FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Index for faster searches
CREATE INDEX idx_products_name ON public.products USING gin(to_tsvector('french', name));
CREATE INDEX idx_products_brand ON public.products (brand);
CREATE INDEX idx_quotes_quote_number ON public.quotes (quote_number);
CREATE INDEX idx_quotes_status ON public.quotes (status);
CREATE INDEX idx_app_users_username ON public.app_users (username);
