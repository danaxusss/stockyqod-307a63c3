import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

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

async function verifyPin(pin: string, stored: string): Promise<boolean> {
  if (stored.startsWith("pbkdf2:")) {
    const [, iterStr, saltHex, hashHex] = stored.split(":");
    const iterations = parseInt(iterStr);
    const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map(h => parseInt(h, 16)));
    const key = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]
    );
    const derived = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
      key, 256
    );
    const derivedHex = [...new Uint8Array(derived)].map(b => b.toString(16).padStart(2, "0")).join("");
    return derivedHex === hashHex;
  }
  if (stored.startsWith("$2")) return false;
  return stored === pin;
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { action, admin_username, admin_pin, ...payload } = await req.json();
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Validate inputs
    if (!action || typeof action !== "string") {
      return jsonResponse({ error: "action is required" }, 400);
    }
    if (!admin_username || !admin_pin) {
      return jsonResponse({ error: "admin_username and admin_pin are required for authentication" }, 401);
    }

    // Verify admin credentials
    const { data: adminUser, error: adminErr } = await supabase
      .from("app_users")
      .select("*")
      .eq("username", admin_username)
      .single();

    if (adminErr || !adminUser || !adminUser.is_superadmin) {
      return jsonResponse({ error: "Unauthorized: superadmin access required" }, 403);
    }

    let isValidPin = await verifyPin(admin_pin, adminUser.pin);
    if (!isValidPin && !adminUser.pin.startsWith("pbkdf2:") && !adminUser.pin.startsWith("$2") && adminUser.pin === admin_pin) {
      isValidPin = true;
    }
    if (!isValidPin) {
      return jsonResponse({ error: "Unauthorized: invalid admin credentials" }, 403);
    }

    // === CRUD operations ===

    if (action === "create_user") {
      const { username, pin: newPin, is_admin, is_superadmin, company_id, can_create_quote, allowed_stock_locations, allowed_brands, price_display_type, custom_seller_name } = payload;
      if (!username || !newPin) return jsonResponse({ error: "username and pin required" }, 400);
      if (typeof username !== "string" || username.trim().length < 3 || username.trim().length > 50) {
        return jsonResponse({ error: "username must be 3-50 characters" }, 400);
      }
      if (!/^[a-zA-Z0-9_-]+$/.test(username.trim())) {
        return jsonResponse({ error: "username can only contain letters, numbers, hyphens and underscores" }, 400);
      }
      if (typeof newPin !== "string" || !/^\d{6}$/.test(newPin)) {
        return jsonResponse({ error: "pin must be exactly 6 digits" }, 400);
      }

      const hashedPin = await hashPin(newPin);
      const { data, error } = await supabase
        .from("app_users")
        .insert({
          username: username.trim(),
          pin: hashedPin,
          is_admin: is_admin || false,
          is_superadmin: is_superadmin || false,
          company_id: company_id || null,
          can_create_quote: can_create_quote !== undefined ? can_create_quote : true,
          allowed_stock_locations: allowed_stock_locations || [],
          allowed_brands: allowed_brands || [],
          price_display_type: price_display_type || "normal",
          custom_seller_name: custom_seller_name || "",
        })
        .select("id, username, is_admin, is_superadmin, company_id, can_create_quote, allowed_stock_locations, allowed_brands, price_display_type, custom_seller_name, created_at, updated_at")
        .single();

      if (error) {
        if (error.code === "23505") return jsonResponse({ error: "Username already exists" }, 409);
        return jsonResponse({ error: error.message }, 500);
      }
      return jsonResponse({ success: true, user: data });
    }

    if (action === "update_user") {
      const { user_id, username, pin: newPin, is_admin, is_superadmin, company_id, can_create_quote, allowed_stock_locations, allowed_brands, price_display_type, custom_seller_name } = payload;
      if (!user_id) return jsonResponse({ error: "user_id required" }, 400);

      const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (username !== undefined) {
        if (typeof username !== "string" || username.trim().length < 3 || username.trim().length > 50) {
          return jsonResponse({ error: "username must be 3-50 characters" }, 400);
        }
        updateData.username = username.trim();
      }
      if (newPin !== undefined) {
        if (typeof newPin !== "string" || !/^\d{6}$/.test(newPin)) {
          return jsonResponse({ error: "pin must be exactly 6 digits" }, 400);
        }
        updateData.pin = await hashPin(newPin);
      }
      if (is_admin !== undefined) updateData.is_admin = is_admin;
      if (is_superadmin !== undefined) updateData.is_superadmin = is_superadmin;
      if (company_id !== undefined) updateData.company_id = company_id || null;
      if (can_create_quote !== undefined) updateData.can_create_quote = can_create_quote;
      if (allowed_stock_locations !== undefined) updateData.allowed_stock_locations = allowed_stock_locations;
      if (allowed_brands !== undefined) updateData.allowed_brands = allowed_brands;
      if (price_display_type !== undefined) updateData.price_display_type = price_display_type;
      if (custom_seller_name !== undefined) updateData.custom_seller_name = custom_seller_name;

      const { data, error } = await supabase
        .from("app_users")
        .update(updateData)
        .eq("id", user_id)
        .select("id, username, is_admin, is_superadmin, company_id, can_create_quote, allowed_stock_locations, allowed_brands, price_display_type, custom_seller_name, created_at, updated_at")
        .single();

      if (error) {
        if (error.code === "23505") return jsonResponse({ error: "Username already exists" }, 409);
        return jsonResponse({ error: error.message }, 500);
      }
      return jsonResponse({ success: true, user: data });
    }

    if (action === "delete_user") {
      const { user_id } = payload;
      if (!user_id) return jsonResponse({ error: "user_id required" }, 400);

      const { error } = await supabase.from("app_users").delete().eq("id", user_id);
      if (error) return jsonResponse({ error: error.message }, 500);
      return jsonResponse({ success: true });
    }

    if (action === "check_username") {
      const { username, exclude_id } = payload;
      if (!username) return jsonResponse({ error: "username required" }, 400);

      let query = supabase.from("app_users").select("id").eq("username", username);
      if (exclude_id) query = query.neq("id", exclude_id);
      const { data, error } = await query;
      if (error) return jsonResponse({ error: error.message }, 500);
      return jsonResponse({ available: !data || data.length === 0 });
    }

    return jsonResponse({ error: "Invalid action" }, 400);
  } catch (e) {
    console.error("admin-users error:", e);
    return jsonResponse({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
