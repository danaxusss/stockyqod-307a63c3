-- Share links remember their company, so the client's page can put that
-- company's logo and contact details on the one-file download of the sheets.
ALTER TABLE public.sheet_share_links ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;
