import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';
import { clientIp, guard } from '../_shared/security.ts';

// verify_jwt is false for this function (the browser calls it), so rate limits
// are the only thing standing between a stranger and push-spamming every user.
const LIMITS = {
  burst: { max: 30,  window: 60 },
  hour:  { max: 300, window: 60 * 60 },
};
// One call must not be able to blast the entire user base.
const MAX_RECIPIENTS = 500;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

interface PushPayload {
  user_ids: string[];
  title: string;
  body: string;
  task_id?: string | null;
  url?: string;
  tag?: string;
  requireInteraction?: boolean;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const blocked = await guard(req, [
      { bucket: 'send-push:ip', id: clientIp(req), max: LIMITS.burst.max, window: LIMITS.burst.window },
      { bucket: 'send-push:ip:hour', id: clientIp(req), max: LIMITS.hour.max, window: LIMITS.hour.window },
    ]);
    if (blocked) return blocked;

    const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY');
    const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY');
    const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') || 'mailto:admin@example.com';
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      throw new Error('VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be configured');
    }
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const payload = (await req.json()) as PushPayload;
    const userIds = Array.from(new Set((payload.user_ids || []).filter(Boolean))).slice(0, MAX_RECIPIENTS);
    if (!userIds.length) {
      return new Response(JSON.stringify({ success: true, sent: 0 }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { data: subs, error } = await supabase
      .from('push_subscriptions')
      .select('*')
      .in('user_id', userIds);
    if (error) throw error;

    const notification = JSON.stringify({
      title: payload.title || 'Notification',
      body: payload.body || '',
      task_id: payload.task_id || null,
      url: payload.url || '/tasks',
      tag: payload.tag || payload.task_id || undefined,
      requireInteraction: payload.requireInteraction || false,
    });

    let sent = 0;
    const stale: string[] = [];
    await Promise.all((subs || []).map(async (s: any) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          notification
        );
        sent++;
      } catch (e: any) {
        const code = e?.statusCode;
        if (code === 404 || code === 410) stale.push(s.endpoint);
        else console.error('push error', code, e?.body || e?.message);
      }
    }));

    if (stale.length) {
      await supabase.from('push_subscriptions').delete().in('endpoint', stale);
    }

    return new Response(JSON.stringify({ success: true, sent, pruned: stale.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('send-push error:', e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
