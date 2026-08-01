-- ============================================================================
-- WhatsApp Marketing — Phase 3: templates + campaigns
--
-- Campaigns materialize recipients from a segment (minus opt-outs), enqueue
-- personalized messages into wa_outbox (which the runner already paces with
-- humanized delays / daily cap / quiet hours / last-mile opt-out re-check).
-- at-most-once per contact per campaign is enforced by a UNIQUE on recipients.
-- ============================================================================

CREATE TABLE public.wa_templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',                 -- may contain {{name}}, {{phone}}, {{customField}}
  media_url TEXT,
  cta_label TEXT,
  cta_url TEXT,                                  -- plain link now; tracked short-link in the analytics phase
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_wa_templates_company ON public.wa_templates(company_id);

CREATE TABLE public.wa_campaigns (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  session_id UUID REFERENCES public.wa_sessions(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  media_url TEXT,
  cta_label TEXT,
  cta_url TEXT,
  segment_filter JSONB NOT NULL DEFAULT '{}'::jsonb,   -- snapshot of the audience filter
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'scheduled', 'running', 'paused', 'done', 'cancelled')),
  scheduled_at TIMESTAMPTZ,
  total_recipients INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_wa_campaigns_company ON public.wa_campaigns(company_id, created_at DESC);

CREATE TABLE public.wa_campaign_recipients (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id UUID NOT NULL REFERENCES public.wa_campaigns(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES public.wa_contacts(id) ON DELETE SET NULL,
  phone TEXT NOT NULL,
  name TEXT,
  body TEXT NOT NULL,                            -- personalized at launch
  outbox_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, phone)                    -- at-most-once per contact per campaign
);
CREATE INDEX idx_wa_campaign_recipients_campaign ON public.wa_campaign_recipients(campaign_id);

-- link the phase-1 outbox column to campaigns now that the table exists
ALTER TABLE public.wa_outbox
  ADD CONSTRAINT wa_outbox_campaign_fk FOREIGN KEY (campaign_id)
  REFERENCES public.wa_campaigns(id) ON DELETE SET NULL;
CREATE INDEX idx_wa_outbox_campaign ON public.wa_outbox(campaign_id);

ALTER TABLE public.wa_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wa_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wa_campaign_recipients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all wa_templates" ON public.wa_templates FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all wa_campaigns" ON public.wa_campaigns FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all wa_campaign_recipients" ON public.wa_campaign_recipients FOR ALL USING (true) WITH CHECK (true);

CREATE TRIGGER update_wa_templates_updated_at BEFORE UPDATE ON public.wa_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_wa_campaigns_updated_at BEFORE UPDATE ON public.wa_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
