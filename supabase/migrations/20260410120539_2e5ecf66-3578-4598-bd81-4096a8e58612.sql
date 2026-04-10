
CREATE TABLE public.product_name_overrides (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('brand', 'provider')),
  original_name TEXT NOT NULL,
  custom_name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (type, original_name)
);

ALTER TABLE public.product_name_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow read product_name_overrides" ON public.product_name_overrides FOR SELECT USING (true);
CREATE POLICY "Allow insert product_name_overrides" ON public.product_name_overrides FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow update product_name_overrides" ON public.product_name_overrides FOR UPDATE USING (true);
CREATE POLICY "Allow delete product_name_overrides" ON public.product_name_overrides FOR DELETE USING (true);
