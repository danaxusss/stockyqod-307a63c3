-- ============================================================================
-- WhatsApp Marketing — remove features that can't be delivered reliably on the
-- whatsapp-web.js channel, so the UI never promises what it can't keep:
--
--  • Auto-replies (wa_auto_replies): a keyword bot on a personal number is
--    fragile and raises ban risk; dropped.
--  • Click tracking (wa_links / wa_link_clicks / wa_campaigns.track_clicks):
--    required a separately-deployed edge function and silently recorded zero
--    otherwise; dropped.
--
-- KEPT: wa_commands and wa_contacts.wa_status — number validation is reliable
-- and stays. IF EXISTS makes this safe whether or not the growth migration
-- (20260802120000) was ever applied.
-- ============================================================================

DROP TABLE IF EXISTS public.wa_link_clicks;
DROP TABLE IF EXISTS public.wa_links;
DROP TABLE IF EXISTS public.wa_auto_replies;

ALTER TABLE public.wa_campaigns DROP COLUMN IF EXISTS track_clicks;
