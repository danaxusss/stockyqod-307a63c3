// wa-link — public click-tracking redirect for WhatsApp campaign CTAs.
//
// GET /functions/v1/wa-link?c=<code>  →  logs a click, 302-redirects to the
// link's target URL. Deploy with JWT verification off so bare clicks work:
//
//   supabase functions deploy wa-link --no-verify-jwt
//
import { createClient } from 'jsr:@supabase/supabase-js@2';

Deno.serve(async (req) => {
  const code = new URL(req.url).searchParams.get('c') || '';
  if (!code) return new Response('Missing code', { status: 400 });

  const db = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: link } = await db.from('wa_links')
    .select('id, target_url').eq('code', code).maybeSingle();
  if (!link) return new Response('Unknown link', { status: 404 });

  // best-effort logging — never block the redirect on it
  db.from('wa_link_clicks').insert({
    link_id: link.id,
    user_agent: req.headers.get('user-agent')?.slice(0, 200) || null,
  }).then(() => {}, () => {});

  return Response.redirect(link.target_url, 302);
});
