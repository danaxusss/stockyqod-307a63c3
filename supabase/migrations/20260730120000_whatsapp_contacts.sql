-- ============================================================================
-- WhatsApp Marketing — Phase 2: contacts, tags/segments
--
-- wa_contacts is the audience book (one row per phone per company). Opt-out is
-- still enforced via wa_opt_outs (phase 1) — a contact is "reachable" only if
-- its phone is NOT in that list. Segments are saved filter definitions used to
-- build campaign audiences later.
-- ============================================================================

CREATE TABLE public.wa_contacts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,                            -- E.164, normalized on import
  name TEXT,
  email TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  custom JSONB NOT NULL DEFAULT '{}'::jsonb,       -- arbitrary mapped columns
  source TEXT NOT NULL DEFAULT 'manual',           -- 'manual' | 'import' | 'inbound'
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, phone)
);
CREATE INDEX idx_wa_contacts_company ON public.wa_contacts(company_id);
CREATE INDEX idx_wa_contacts_tags ON public.wa_contacts USING GIN (tags);

-- Saved audience filters (dynamic segments)
CREATE TABLE public.wa_segments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  filter JSONB NOT NULL DEFAULT '{}'::jsonb,        -- { tagsAny, tagsAll, tagsNone, search, hasField }
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);
CREATE INDEX idx_wa_segments_company ON public.wa_segments(company_id);

ALTER TABLE public.wa_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wa_segments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all wa_contacts" ON public.wa_contacts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all wa_segments" ON public.wa_segments FOR ALL USING (true) WITH CHECK (true);

CREATE TRIGGER update_wa_contacts_updated_at BEFORE UPDATE ON public.wa_contacts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_wa_segments_updated_at BEFORE UPDATE ON public.wa_segments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
