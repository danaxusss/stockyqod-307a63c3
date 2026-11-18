// Public share links (/share/<token>): technical sheets and product photos of
// a quote, sent to a client who has no Stocky login.
//
// The page used to read sheet_share_links, technical_sheets and the company
// settings with the public key. Since secure login step 2 that key opens
// nothing, so this function (service role) checks the link and returns only
// what the page shows. verify_jwt = false: visitors are anonymous.
//
// Actions (POST JSON):
//   { action: "get", token }                      → link, sheets, photos, company (counts one view)
//   { action: "downloaded", token, sheet_ids }    → counts one download per sheet of this link

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { clientIp, corsHeaders, guard, json } from "../_shared/security.ts";
import { isLinkToken, publicCompany, publicImages, publicSheet, shareLinkStatus } from "../_shared/publicLinks.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, { error: "POST required" }, 405);
  if (Number(req.headers.get("content-length") || 0) > 20_000) return json(req, { error: "Request too large" }, 413);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
  const ip = clientIp(req);

  try {
    const body = await req.json().catch(() => ({}));
    const action = typeof body?.action === "string" ? body.action : "";
    const token = body?.token;
    if (action !== "get" && action !== "downloaded") return json(req, { error: "Invalid action" }, 400);

    // Random tokens: guessing them is the only attack, so cap tries per IP.
    const blocked = await guard(req, [
      { bucket: `public-share:${action}:ip`, id: ip, max: 600, window: 60 * 60 },
      ...(isLinkToken(token) ? [{ bucket: `public-share:${action}:token`, id: token, max: 2000, window: 60 * 60 }] : []),
    ]);
    if (blocked) return blocked;
    if (!isLinkToken(token)) return json(req, { status: "missing" });

    const { data: link, error: linkError } = await supabase
      .from("sheet_share_links")
      .select("*")
      .eq("token", token)
      .maybeSingle();
    if (linkError) throw linkError;
    const status = shareLinkStatus(link);
    if (status !== "ok" || !link) return json(req, { status });

    const linkSheetIds: string[] = Array.isArray(link.sheet_ids) ? link.sheet_ids.map(String) : [];

    if (action === "downloaded") {
      const wanted: string[] = Array.isArray(body.sheet_ids) ? body.sheet_ids.map(String).filter((id: string) => UUID_RE.test(id)) : [];
      const ids = [...new Set(wanted)].filter(id => linkSheetIds.includes(id)).slice(0, 200);
      if (ids.length) {
        const { data: rows } = await supabase.from("technical_sheets").select("id, download_count").in("id", ids);
        await Promise.all((rows || []).map(row =>
          supabase.from("technical_sheets").update({ download_count: (Number(row.download_count) || 0) + 1 }).eq("id", row.id)));
      }
      return json(req, { status: "ok", counted: ids.length });
    }

    // action === "get"
    await supabase.from("sheet_share_links").update({ view_count: (Number(link.view_count) || 0) + 1 }).eq("id", link.id);

    const sheetIds = linkSheetIds.filter(id => UUID_RE.test(id)).slice(0, 500);
    let sheets: ReturnType<typeof publicSheet>[] = [];
    if (sheetIds.length) {
      const { data, error } = await supabase.from("technical_sheets").select("*").in("id", sheetIds);
      if (error) throw error;
      sheets = (data || []).map(publicSheet);
    }

    // The link's company (older links: the default company settings).
    let companyRow: Record<string, unknown> | null = null;
    if (link.company_id && UUID_RE.test(String(link.company_id))) {
      const { data } = await supabase.from("companies").select("*").eq("id", link.company_id).maybeSingle();
      companyRow = data;
    }
    let legacyRow: Record<string, unknown> | null = null;
    if (!companyRow) {
      const { data } = await supabase.from("company_settings").select("*").limit(1).maybeSingle();
      legacyRow = data;
    }

    return json(req, {
      status: "ok",
      link: {
        title: typeof link.title === "string" ? link.title : null,
        expires_at: link.expires_at ?? null,
        product_images: publicImages(link.product_images),
      },
      sheets,
      company: publicCompany(companyRow, legacyRow),
    });
  } catch (error) {
    console.error("public-share error:", error);
    return json(req, { error: "Erreur lors du chargement" }, 500);
  }
});
