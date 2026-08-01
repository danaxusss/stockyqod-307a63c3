-- ============================================================================
-- WhatsApp Marketing — Phase 1: sessions, outbox (test sends), events, opt-outs
--
-- Control plane lives in Supabase; the OpenWA runner (office PC / VPS) polls
-- wa_outbox, updates wa_sessions (status/QR/heartbeat) and writes wa_events.
-- Company-scoped like the rest of Stocky, permissive RLS (PIN-based auth).
-- ============================================================================

-- ── Sessions: one row per linked WhatsApp number ────────────────────────────
CREATE TABLE public.wa_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT 'Session principale',
  phone_number TEXT,                              -- filled by runner once linked
  status TEXT NOT NULL DEFAULT 'disconnected'
    CHECK (status IN ('disconnected', 'pairing', 'connected')),
  qr_data_url TEXT,                               -- QR png (data URL) while pairing
  paused BOOLEAN NOT NULL DEFAULT false,          -- manual pause from the UI
  runner_seen_at TIMESTAMPTZ,                     -- heartbeat; stale ⇒ runner offline
  daily_cap INTEGER NOT NULL DEFAULT 50,          -- max sends/day (number warm-up)
  quiet_start INTEGER NOT NULL DEFAULT 21,        -- no sends from 21h…
  quiet_end INTEGER NOT NULL DEFAULT 9,           -- …to 9h (local runner time)
  delay_mean_sec INTEGER NOT NULL DEFAULT 45,     -- humanized Gaussian delay
  delay_std_sec INTEGER NOT NULL DEFAULT 15,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_wa_sessions_company ON public.wa_sessions(company_id);

-- ── Outbox: the send queue (test sends now, campaigns later) ────────────────
CREATE TABLE public.wa_outbox (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES public.wa_sessions(id) ON DELETE CASCADE,
  to_phone TEXT NOT NULL,                         -- E.164, e.g. +2126XXXXXXXX
  body TEXT NOT NULL,
  media_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'cancelled', 'blocked')),
  ack INTEGER NOT NULL DEFAULT 0,                 -- 1 sent, 2 delivered, 3 read
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  wa_message_id TEXT,
  source TEXT NOT NULL DEFAULT 'test',            -- 'test' | 'campaign' (later)
  campaign_id UUID,                               -- FK added in the campaigns phase
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_wa_outbox_pending ON public.wa_outbox(session_id, status, scheduled_at);
CREATE INDEX idx_wa_outbox_company ON public.wa_outbox(company_id, created_at DESC);

-- ── Events: raw runner events (acks, inbound, connexion) ────────────────────
CREATE TABLE public.wa_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  session_id UUID REFERENCES public.wa_sessions(id) ON DELETE CASCADE,
  type TEXT NOT NULL,                             -- 'ack'|'inbound'|'connected'|'disconnected'|'optout'|'error'
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_wa_events_company ON public.wa_events(company_id, created_at DESC);

-- ── Opt-outs: enforced before ANY send, from day one ────────────────────────
CREATE TABLE public.wa_opt_outs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,                            -- E.164
  reason TEXT NOT NULL DEFAULT 'manual',          -- 'manual' | 'keyword' | 'import'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, phone)
);
CREATE INDEX idx_wa_opt_outs_lookup ON public.wa_opt_outs(company_id, phone);

-- ── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.wa_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wa_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wa_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wa_opt_outs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all wa_sessions" ON public.wa_sessions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all wa_outbox" ON public.wa_outbox FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all wa_events" ON public.wa_events FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all wa_opt_outs" ON public.wa_opt_outs FOR ALL USING (true) WITH CHECK (true);

CREATE TRIGGER update_wa_sessions_updated_at BEFORE UPDATE ON public.wa_sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_wa_outbox_updated_at BEFORE UPDATE ON public.wa_outbox
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
