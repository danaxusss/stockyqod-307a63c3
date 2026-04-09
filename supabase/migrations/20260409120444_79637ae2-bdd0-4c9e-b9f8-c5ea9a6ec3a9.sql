
-- Create company_settings table
CREATE TABLE public.company_settings (
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

CREATE POLICY "Allow read company_settings" ON public.company_settings FOR SELECT USING (true);
CREATE POLICY "Allow insert company_settings" ON public.company_settings FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow update company_settings" ON public.company_settings FOR UPDATE USING (true);

-- Create trigger for updated_at
CREATE TRIGGER update_company_settings_updated_at
  BEFORE UPDATE ON public.company_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Insert default row
INSERT INTO public.company_settings (id) VALUES (gen_random_uuid());

-- Create storage bucket for company assets
INSERT INTO storage.buckets (id, name, public) VALUES ('company-assets', 'company-assets', true);

CREATE POLICY "Allow public read company-assets" ON storage.objects FOR SELECT USING (bucket_id = 'company-assets');
CREATE POLICY "Allow upload company-assets" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'company-assets');
CREATE POLICY "Allow update company-assets" ON storage.objects FOR UPDATE USING (bucket_id = 'company-assets');
CREATE POLICY "Allow delete company-assets" ON storage.objects FOR DELETE USING (bucket_id = 'company-assets');
