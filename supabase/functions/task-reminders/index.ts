import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// How long an in-app notification can sit unread before we push a reminder.
const REMIND_AFTER_MINUTES = 15;
const REMINDABLE_TYPES = ['task_assigned', 'task_reassigned', 'priority_changed', 'status_changed', 'location_request'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY');
    const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY');
    const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') || 'mailto:admin@example.com';
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) throw new Error('VAPID keys must be configured');
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const cutoff = new Date(Date.now() - REMIND_AFTER_MINUTES * 60 * 1000).toISOString();
    const { data: due, error } = await supabase
      .from('task_notifications')
      .select('*')
      .eq('is_read', false)
      .is('reminded_at', null)
      .lt('created_at', cutoff)
      .in('type', REMINDABLE_TYPES)
      .limit(200);
    if (error) throw error;
    if (!due || due.length === 0) {
      return new Response(JSON.stringify({ success: true, reminded: 0 }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const userIds = Array.from(new Set(due.map((n: any) => n.user_id)));
    const { data: subs } = await supabase.from('push_subscriptions').select('*').in('user_id', userIds);
    const subsByUser: Record<string, any[]> = {};
    (subs || []).forEach((s: any) => { (subsByUser[s.user_id] ||= []).push(s); });

    const stale: string[] = [];
    let reminded = 0;

    for (const n of due) {
      const userSubs = subsByUser[n.user_id] || [];
      const notification = JSON.stringify({
        title: `Rappel · ${n.title}`,
        body: n.message,
        task_id: n.task_id || null,
        url: '/tasks',
        tag: n.task_id || n.id,
        requireInteraction: true,
      });
      await Promise.all(userSubs.map(async (s) => {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, notification);
        } catch (e: any) {
          if (e?.statusCode === 404 || e?.statusCode === 410) stale.push(s.endpoint);
        }
      }));
      reminded++;
    }

    // Mark these notifications as reminded so we nudge only once.
    await supabase.from('task_notifications').update({ reminded_at: new Date().toISOString() }).in('id', due.map((n: any) => n.id));
    if (stale.length) await supabase.from('push_subscriptions').delete().in('endpoint', stale);

    return new Response(JSON.stringify({ success: true, reminded, pruned: stale.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('task-reminders error:', e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
