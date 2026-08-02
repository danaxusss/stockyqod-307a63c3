-- ============================================================================
-- WhatsApp Marketing — Phase 4: growth features
--
--  • Number validation: contacts remember whether their phone is actually on
--    WhatsApp (wa_status), checked by the runner via a command queue.
--  • wa_commands: generic app → runner work queue (first use: validate_numbers).
--  • Auto-replies: keyword → response rules executed by the runner on inbound.
--  • Link tracking: short redirect links (served by the wa-link edge function)
--    with one click row per hit, aggregated per campaign.
-- ============================================================================

-- contact validation state, written by the runner
ALTER TABLE public.wa_contacts
  ADD COLUMN IF NOT EXISTS wa_status TEXT,            -- 'valid' | 'invalid' | NULL = unchecked
  ADD COLUMN IF NOT EXISTS wa_checked_at TIMESTAMPTZ;

-- app → runner command queue
CREATE TABLE public.wa_commands (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES public.wa_sessions(id) ON DELETE CASCADE,
  type TEXT NOT NULL,                                  -- 'validate_numbers'
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,          -- { phones: [...] }
  status TEXT NOT NULL DEFAULT 'pending',              -- pending|running|done|failed
  result JSONB,                                        -- { checked, valid, invalid }
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_wa_commands_pending ON public.wa_commands(session_id, status);

-- keyword auto-replies, executed by the runner on inbound messages
CREATE TABLE public.wa_auto_replies (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  keyword TEXT NOT NULL,                               -- matched case/accent-insensitively
  match_type TEXT NOT NULL DEFAULT 'exact',            -- 'exact' | 'contains'
  reply_body TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  cooldown_hours INTEGER NOT NULL DEFAULT 24,          -- per contact, per rule
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, keyword)
);
CREATE INDEX idx_wa_auto_replies_company ON public.wa_auto_replies(company_id);

-- tracked short links (redirect served by the wa-link edge function)
CREATE TABLE public.wa_links (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  campaign_id UUID REFERENCES public.wa_campaigns(id) ON DELETE CASCADE,
  code TEXT NOT NULL UNIQUE,
  target_url TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_wa_links_campaign ON public.wa_links(campaign_id);

CREATE TABLE public.wa_link_clicks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  link_id UUID NOT NULL REFERENCES public.wa_links(id) ON DELETE CASCADE,
  clicked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_agent TEXT
);
CREATE INDEX idx_wa_link_clicks_link ON public.wa_link_clicks(link_id);

-- per-campaign opt-in for click tracking (links only rewritten when enabled)
ALTER TABLE public.wa_campaigns
  ADD COLUMN IF NOT EXISTS track_clicks BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.wa_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wa_auto_replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wa_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wa_link_clicks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all wa_commands" ON public.wa_commands FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all wa_auto_replies" ON public.wa_auto_replies FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all wa_links" ON public.wa_links FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all wa_link_clicks" ON public.wa_link_clicks FOR ALL USING (true) WITH CHECK (true);

CREATE TRIGGER update_wa_commands_updated_at BEFORE UPDATE ON public.wa_commands
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_wa_auto_replies_updated_at BEFORE UPDATE ON public.wa_auto_replies
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
