import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { clientIp, guard, rateLimit } from "../_shared/security.ts";
import { verifySessionLive } from "../_shared/session.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// PBKDF2 hashing (same as verify-pin)
const ITERATIONS = 100000;
const SALT_LENGTH = 16;

async function hashPin(pin: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]
  );
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" },
    key, 256
  );
  const saltHex = [...salt].map(b => b.toString(16).padStart(2, "0")).join("");
  const hashHex = [...new Uint8Array(derived)].map(b => b.toString(16).padStart(2, "0")).join("");
  return `pbkdf2:${ITERATIONS}:${saltHex}:${hashHex}`;
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const SAFE_COLUMNS = "id, username, is_admin, is_superadmin, is_compta, new_role, cross_branch_read, company_id, can_create_quote, allowed_stock_locations, allowed_brands, price_display_type, custom_seller_name, phone, tasks_role, tasks_only, created_at, updated_at";
const ROLES = ["super_admin", "admin", "manager", "facturation", "compta", "senior_sales", "junior_sales"];
const PRICE_TYPES = ["normal", "reseller", "buy", "calculated"];
const TASK_ROLES = ["super_admin", "sales", "technician", "driver"];

const stringList = (value: unknown) =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string").map(v => v.trim()).filter(Boolean).slice(0, 200) : [];

/** Validated app_users columns from a create/update payload (unknown keys are ignored). */
function userFields(payload: Record<string, unknown>, creating: boolean): { values: Record<string, unknown> } | { error: string } {
  const values: Record<string, unknown> = {};
  const has = (key: string) => payload[key] !== undefined;
  if (has("username") || creating) {
    const username = typeof payload.username === "string" ? payload.username.trim() : "";
    if (username.length < 3 || username.length > 50) return { error: "Le nom d'utilisateur doit faire 3 à 50 caractères" };
    if (/[\u0000-\u001f\u007f]/.test(username)) return { error: "Le nom d'utilisateur contient des caractères invalides" };
    values.username = username;
  }
  if (has("pin") && (typeof payload.pin !== "string" || !/^\d{6}$/.test(payload.pin))) return { error: "Le PIN doit comporter exactement 6 chiffres" };
  for (const key of ["is_admin", "is_superadmin", "is_compta", "cross_branch_read", "can_create_quote", "can_edit_products", "tasks_only"]) {
    if (has(key)) values[key] = payload[key] === true;
  }
  if (has("new_role")) values.new_role = ROLES.includes(payload.new_role as string) ? payload.new_role : null;
  if (has("company_id")) values.company_id = typeof payload.company_id === "string" && payload.company_id ? payload.company_id : null;
  if (has("allowed_stock_locations")) values.allowed_stock_locations = stringList(payload.allowed_stock_locations);
  if (has("allowed_brands")) values.allowed_brands = stringList(payload.allowed_brands);
  if (has("price_display_type")) values.price_display_type = PRICE_TYPES.includes(payload.price_display_type as string) ? payload.price_display_type : "normal";
  if (has("custom_seller_name")) values.custom_seller_name = typeof payload.custom_seller_name === "string" ? payload.custom_seller_name.trim().slice(0, 100) : "";
  if (has("phone")) values.phone = typeof payload.phone === "string" ? payload.phone.trim().slice(0, 30) : "";
  if (has("tasks_role")) values.tasks_role = TASK_ROLES.includes(payload.tasks_role as string) ? payload.tasks_role : null;
  return { values };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // Caps admin API abuse and, critically, stops anyone grinding admin_user_id
    // values to find a valid superadmin UUID.
    const ip = clientIp(req);
    const blocked = await guard(req, [
      { bucket: "admin-users:ip", id: ip, max: 60, window: 60 },
      { bucket: "admin-users:ip:hour", id: ip, max: 600, window: 60 * 60 },
    ]);
    if (blocked) return blocked;

    const body = await req.json();
    const { action, session_token, ...payload } = body;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    if (!action || typeof action !== "string") {
      return jsonResponse({ error: "action is required" }, 400);
    }

    // Authorization: a server-signed session token only. The former bare
    // admin_user_id was accepted as proof of identity, and user ids are public
    // (get_app_users_safe), so anyone could act as a superadmin.
    if (!session_token) return jsonResponse({ error: "session_token is required" }, 401);
    const live = await verifySessionLive(supabase, session_token);
    const caller = (live?.user ?? null) as { id: string; is_superadmin?: boolean } | null;

    const denied = async (message: string) => {
      // Only FAILED authorizations consume this budget.
      const v = await rateLimit("admin-users:authfail", ip, 10, 15 * 60, true);
      console.warn(`[admin-users] unauthorized attempt ip=${ip} count=${v.count}`);
      if (!v.allowed) return jsonResponse({ error: "Too many attempts" }, 429);
      return jsonResponse({ error: message }, 403);
    };

    if (!caller) return denied("Session expirée : reconnectez-vous.");

    // Any signed-in user may change the seller name shown on their own quotes.
    if (action === "update_own_profile") {
      const name = typeof payload.custom_seller_name === "string" ? payload.custom_seller_name.trim().slice(0, 100) : null;
      if (name === null) return jsonResponse({ error: "custom_seller_name required" }, 400);
      const { error } = await supabase.from("app_users")
        .update({ custom_seller_name: name, updated_at: new Date().toISOString() })
        .eq("id", caller.id);
      if (error) return jsonResponse({ error: error.message }, 500);
      return jsonResponse({ success: true });
    }

    if (caller.is_superadmin !== true) return denied("Unauthorized: superadmin access required");

    // === CRUD (superadmin) ===

    if (action === "check_username") {
      const { username, exclude_id } = payload;
      if (!username) return jsonResponse({ error: "username required" }, 400);
      let query = supabase.from("app_users").select("id").eq("username", String(username).trim());
      if (exclude_id) query = query.neq("id", exclude_id);
      const { data, error } = await query;
      if (error) return jsonResponse({ error: error.message }, 500);
      return jsonResponse({ available: !data || data.length === 0 });
    }

    if (action === "create_user") {
      const fields = userFields(payload, true);
      if ("error" in fields) return jsonResponse({ error: fields.error }, 400);
      if (!fields.values.username || !payload.pin) return jsonResponse({ error: "username and pin required" }, 400);
      const values: Record<string, unknown> = {
        is_admin: false, is_superadmin: false, is_compta: false, cross_branch_read: false,
        can_create_quote: true, allowed_stock_locations: [], allowed_brands: [],
        price_display_type: "normal", custom_seller_name: "", phone: "", tasks_only: false,
        ...fields.values,
        pin: await hashPin(payload.pin),
      };
      // Only sent when granted, so creating users works before the
      // can_edit_products migration has run.
      if (values.can_edit_products !== true) delete values.can_edit_products;
      const { data, error } = await supabase.from("app_users").insert(values).select(SAFE_COLUMNS).single();
      if (error) {
        if (error.code === "23505") return jsonResponse({ error: "Ce nom d'utilisateur existe déjà" }, 409);
        return jsonResponse({ error: error.message }, 500);
      }
      return jsonResponse({ success: true, user: data });
    }

    if (action === "update_user") {
      const { user_id } = payload;
      if (!user_id) return jsonResponse({ error: "user_id required" }, 400);
      const fields = userFields(payload, false);
      if ("error" in fields) return jsonResponse({ error: fields.error }, 400);
      const values: Record<string, unknown> = { ...fields.values, updated_at: new Date().toISOString() };
      if (payload.pin !== undefined) values.pin = await hashPin(payload.pin);
      // A superadmin cannot lock themselves out.
      if (user_id === caller.id && values.is_superadmin === false) {
        return jsonResponse({ error: "Vous ne pouvez pas retirer vos propres droits de super administrateur." }, 400);
      }
      const { data, error } = await supabase.from("app_users").update(values).eq("id", user_id).select(SAFE_COLUMNS).single();
      if (error) {
        if (error.code === "23505") return jsonResponse({ error: "Ce nom d'utilisateur existe déjà" }, 409);
        return jsonResponse({ error: error.message }, 500);
      }
      return jsonResponse({ success: true, user: data });
    }

    if (action === "delete_user") {
      const { user_id } = payload;
      if (!user_id) return jsonResponse({ error: "user_id required" }, 400);
      if (user_id === caller.id) return jsonResponse({ error: "Vous ne pouvez pas supprimer votre propre compte." }, 400);
      const { error } = await supabase.from("app_users").delete().eq("id", user_id);
      if (error) return jsonResponse({ error: error.message }, 500);
      return jsonResponse({ success: true });
    }

    return jsonResponse({ error: "Invalid action" }, 400);
  } catch (e) {
    console.error("admin-users error:", e);
    return jsonResponse({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
