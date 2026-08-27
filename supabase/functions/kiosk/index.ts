import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { clientIp, corsHeaders, guard, json, rateLimit } from "../_shared/security.ts";
import { verifySessionLive } from "../_shared/session.ts";

type StaffUser = {
  id: string;
  username: string;
  custom_seller_name?: string | null;
  is_admin: boolean;
  is_superadmin: boolean;
  new_role?: string | null;
  company_id?: string | null;
  can_create_quote?: boolean;
};

type KioskProfile = {
  id: string;
  company_id: string;
  public_token: string;
  enabled: boolean;
  visible_brands: string[];
  featured_barcodes: string[];
  [key: string]: unknown;
};

const COMPANY_REVIEW_ROLES = new Set(["admin", "manager", "facturation", "senior_sales"]);
const PROFILE_ROLES = new Set(["admin", "manager"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

function isValidPhone(value: string): boolean {
  const digits = value.replace(/\D/g, "").length;
  return /^\+?[0-9\s().-]{7,24}$/.test(value) && digits >= 7 && digits <= 15;
}

function stringArray(value: unknown, maxItems = 500): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map(v => text(v, 200)).filter(Boolean))).slice(0, maxItems);
}

function isCompanyReviewer(user: StaffUser): boolean {
  return user.is_superadmin || user.is_admin || COMPANY_REVIEW_ROLES.has(user.new_role || "");
}

function canManageProfiles(user: StaffUser): boolean {
  return user.is_superadmin || user.is_admin || PROFILE_ROLES.has(user.new_role || "");
}

function canUseCompany(user: StaffUser, companyId: string): boolean {
  return user.is_superadmin || (!!user.company_id && user.company_id === companyId);
}

function canAccessRequest(user: StaffUser, request: Record<string, unknown>): boolean {
  if (user.is_superadmin) return true;
  if (isCompanyReviewer(user)) {
    return request.assigned_company_id === user.company_id;
  }
  return request.assigned_user_id === user.id;
}

function publicProfile(row: Record<string, unknown>) {
  const company = row.company as Record<string, unknown> | null;
  return {
    id: row.id,
    name: row.name,
    company_name: company?.name || "Stocky",
    greeting_title: row.greeting_title,
    greeting_message: row.greeting_message,
    logo_url: row.logo_url || company?.logo_url || null,
    accent_color: row.accent_color || company?.accent_color || "#2563eb",
    language: row.language,
    show_prices: row.show_prices,
    price_mode: row.price_mode,
    require_email: row.require_email,
    show_availability: row.show_availability,
    inactivity_timeout_seconds: row.inactivity_timeout_seconds,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, { error: "POST required" }, 405);

  const declaredSize = Number(req.headers.get("content-length") || 0);
  if (declaredSize > 250_000) return json(req, { error: "Request too large" }, 413);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
  const ip = clientIp(req);

  try {
    const body = await req.json();
    const action = text(body?.action, 50);
    if (!action) return json(req, { error: "action is required" }, 400);

    // ── Public tablet endpoints ─────────────────────────────────────────────
    if (action === "public_profile" || action === "public_catalog" || action === "public_submit") {
      const token = text(body.token, 80);
      if (!UUID_RE.test(token)) return json(req, { error: "Kiosk unavailable" }, 404);

      const blocked = await guard(req, [
        { bucket: `kiosk:${action}:ip`, id: ip, max: action === "public_submit" ? 15 : 240, window: 60 * 60 },
        { bucket: `kiosk:${action}:token`, id: token, max: action === "public_submit" ? 200 : 3000, window: 60 * 60 },
      ]);
      if (blocked) return blocked;

      const { data: profile, error: profileError } = await supabase
        .from("kiosk_profiles")
        .select("*, company:companies!kiosk_profiles_company_id_fkey(name, logo_url, accent_color)")
        .eq("public_token", token)
        .eq("enabled", true)
        .maybeSingle();
      if (profileError) throw profileError;
      if (!profile) return json(req, { error: "Kiosk unavailable" }, 404);
      const kiosk = profile as KioskProfile & Record<string, unknown>;

      if (action === "public_profile") {
        const { data: brandRows, error } = await supabase.rpc("kiosk_product_brands", {
          p_profile_id: kiosk.id,
        });
        if (error) throw error;
        return json(req, {
          profile: publicProfile(kiosk),
          brands: (brandRows || []).map((row: Record<string, unknown>) => row.brand),
        });
      }

      if (action === "public_catalog") {
        const search = text(body.search, 100);
        const category = ["utensils", "furniture", "equipment"].includes(body.category) ? body.category : null;
        const brand = text(body.brand, 200) || null;
        const page = Math.max(0, Math.floor(Number(body.page) || 0));
        const pageSize = Math.min(72, Math.max(12, Math.floor(Number(body.page_size) || 48)));
        const { data, error } = await supabase.rpc("kiosk_product_search", {
          p_profile_id: kiosk.id,
          p_search: search,
          p_category: category,
          p_brand: brand,
          p_only_available: body.only_available === true,
          p_offset: page * pageSize,
          p_limit: pageSize,
        });
        if (error) throw error;
        const rows = data || [];
        return json(req, {
          products: rows.map((row: Record<string, unknown>) => ({
            barcode: row.barcode,
            name: row.name,
            brand: row.brand,
            image: row.image,
            kiosk_category: row.kiosk_category,
            price: row.display_price,
            available: row.available,
          })),
          total: Number(rows[0]?.total_count || 0),
          page,
          page_size: pageSize,
        });
      }

      const customer = body.customer || {};
      const customerName = text(customer.name, 120);
      const customerPhone = text(customer.phone, 40);
      const customerEmail = text(customer.email, 160);
      const customerNote = text(customer.note, 500);
      const deferContact = body.defer_contact === true;
      if (!deferContact) {
        if (customerName.length < 2 || !customerPhone) {
          return json(req, { error: "Name and phone are required" }, 400);
        }
        if (!isValidPhone(customerPhone)) {
          return json(req, { error: "Invalid phone number" }, 400);
        }
        if (kiosk.require_email === true && !customerEmail) {
          return json(req, { error: "Email is required" }, 400);
        }
        if (customerEmail && !isValidEmail(customerEmail)) {
          return json(req, { error: "Invalid email address" }, 400);
        }
      }
      if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 100) {
        return json(req, { error: "A request must contain 1 to 100 products" }, 400);
      }
      const items = body.items.map((item: Record<string, unknown>) => ({
        barcode: text(item?.barcode, 200),
        quantity: Math.floor(Number(item?.quantity)),
      }));
      if (items.some((item: { barcode: string; quantity: number }) => !item.barcode || item.quantity < 1 || item.quantity > 999)) {
        return json(req, { error: "Invalid product quantity" }, 400);
      }
      const { data, error } = await supabase.rpc("create_kiosk_request", {
        p_profile_id: kiosk.id,
        p_customer_name: deferContact ? "" : customerName,
        p_customer_phone: deferContact ? "" : customerPhone,
        p_customer_email: deferContact ? null : customerEmail || null,
        p_customer_note: customerNote || null,
        p_items: items,
        p_contact_details_pending: deferContact,
      });
      if (error) throw error;
      const created = Array.isArray(data) ? data[0] : data;
      return json(req, { success: true, request_id: created.request_id, request_number: created.request_number });
    }

    // ── Staff endpoints ────────────────────────────────────────────────────
    const live = await verifySessionLive(supabase, body.session_token);
    if (!live) {
      const verdict = await rateLimit("kiosk:admin:authfail", ip, 10, 15 * 60, true);
      return json(req, { error: verdict.allowed ? "Authentication required" : "Too many attempts" }, verdict.allowed ? 401 : 429);
    }
    const staff = live.user as StaffUser;
    const actorName = text(staff.custom_seller_name, 120) || staff.username;

    const adminBlocked = await guard(req, [
      { bucket: "kiosk:admin:ip", id: ip, max: 600, window: 60 * 60 },
      { bucket: "kiosk:admin:user", id: staff.id, max: 1200, window: 60 * 60 },
    ]);
    if (adminBlocked) return adminBlocked;

    if (action === "admin_bootstrap") {
      if (!staff.can_create_quote && !isCompanyReviewer(staff)) return json(req, { error: "Quote access required" }, 403);
      let profilesQuery = supabase.from("kiosk_profiles")
        .select("*, company:companies!kiosk_profiles_company_id_fkey(name)")
        .order("created_at", { ascending: false });
      let companiesQuery = supabase.from("companies").select("id, name, logo_url, accent_color").order("name");
      let usersQuery = supabase.from("app_users")
        .select("id, username, custom_seller_name, company_id, can_create_quote, new_role")
        .order("username");
      if (!staff.is_superadmin) {
        if (!staff.company_id) return json(req, { error: "No company assigned" }, 403);
        profilesQuery = profilesQuery.eq("company_id", staff.company_id);
        companiesQuery = companiesQuery.eq("id", staff.company_id);
        usersQuery = usersQuery.eq("company_id", staff.company_id);
      }
      const [profilesResult, companiesResult, usersResult] = await Promise.all([
        profilesQuery, companiesQuery, usersQuery,
      ]);
      if (profilesResult.error) throw profilesResult.error;
      if (companiesResult.error) throw companiesResult.error;
      if (usersResult.error) throw usersResult.error;
      return json(req, {
        profiles: profilesResult.data || [],
        companies: companiesResult.data || [],
        users: usersResult.data || [],
        permissions: {
          can_manage_profiles: canManageProfiles(staff),
          can_assign_requests: isCompanyReviewer(staff),
          is_superadmin: staff.is_superadmin,
        },
      });
    }

    if (action === "admin_company_options") {
      if (!canManageProfiles(staff)) return json(req, { error: "Profile management access required" }, 403);
      const companyId = text(body.company_id, 80);
      if (!UUID_RE.test(companyId) || !canUseCompany(staff, companyId)) return json(req, { error: "Company access denied" }, 403);
      const brandsResult = await supabase.rpc("kiosk_company_brands", { p_company_id: companyId });
      if (brandsResult.error) throw brandsResult.error;
      return json(req, {
        brands: (brandsResult.data || []).map((row: Record<string, unknown>) => row.brand),
      });
    }

    if (action === "admin_save_profile") {
      if (!canManageProfiles(staff)) return json(req, { error: "Profile management access required" }, 403);
      const input = body.profile || {};
      const profileId = text(input.id, 80);
      let companyId = text(input.company_id, 80);
      if (profileId) {
        const { data: existing, error } = await supabase.from("kiosk_profiles").select("id, company_id").eq("id", profileId).maybeSingle();
        if (error) throw error;
        if (!existing || !canUseCompany(staff, existing.company_id)) return json(req, { error: "Kiosk profile not found" }, 404);
        if (!staff.is_superadmin) companyId = existing.company_id;
      }
      if (!UUID_RE.test(companyId) || !canUseCompany(staff, companyId)) return json(req, { error: "Company access denied" }, 403);
      const assigneeId = UUID_RE.test(text(input.default_assignee_id, 80)) ? text(input.default_assignee_id, 80) : null;
      if (assigneeId) {
        const { data: assignee } = await supabase.from("app_users").select("id, company_id, is_superadmin").eq("id", assigneeId).maybeSingle();
        if (!assignee || (assignee.company_id !== companyId && !assignee.is_superadmin)) {
          return json(req, { error: "Default assignee does not belong to this company" }, 400);
        }
      }
      const timeout = Math.min(1800, Math.max(60, Math.floor(Number(input.inactivity_timeout_seconds) || 180)));
      const language = ["fr", "en", "ar"].includes(input.language) ? input.language : "fr";
      const priceMode = input.price_mode === "reseller" ? "reseller" : "retail";
      const accent = /^#[0-9a-f]{6}$/i.test(text(input.accent_color, 20)) ? text(input.accent_color, 20) : null;
      const values = {
        company_id: companyId,
        name: text(input.name, 100) || "Kiosque principal",
        enabled: input.enabled !== false,
        greeting_title: text(input.greeting_title, 120) || "Bienvenue",
        greeting_message: text(input.greeting_message, 500) || "Créez votre demande de devis en quelques étapes.",
        logo_url: text(input.logo_url, 500) || null,
        accent_color: accent,
        language,
        show_prices: input.show_prices !== false,
        price_mode: priceMode,
        require_email: input.require_email === true,
        show_out_of_stock: input.show_out_of_stock !== false,
        show_availability: input.show_availability === true,
        inactivity_timeout_seconds: timeout,
        default_assignee_id: assigneeId,
        visible_family_ids: [],
        visible_brands: stringArray(input.visible_brands),
        featured_barcodes: stringArray(input.featured_barcodes, 24),
      };
      const query = profileId
        ? supabase.from("kiosk_profiles").update(values).eq("id", profileId)
        : supabase.from("kiosk_profiles").insert({ ...values, created_by: staff.id });
      const { data, error } = await query.select("*, company:companies!kiosk_profiles_company_id_fkey(name)").single();
      if (error) throw error;
      return json(req, { profile: data });
    }

    if (action === "admin_rotate_token") {
      if (!canManageProfiles(staff)) return json(req, { error: "Profile management access required" }, 403);
      const profileId = text(body.profile_id, 80);
      const { data: existing } = await supabase.from("kiosk_profiles").select("id, company_id").eq("id", profileId).maybeSingle();
      if (!existing || !canUseCompany(staff, existing.company_id)) return json(req, { error: "Kiosk profile not found" }, 404);
      const { data, error } = await supabase.from("kiosk_profiles")
        .update({ public_token: crypto.randomUUID() })
        .eq("id", profileId)
        .select("id, public_token")
        .single();
      if (error) throw error;
      return json(req, { profile: data });
    }

    if (action === "admin_list_requests") {
      if (!staff.can_create_quote && !isCompanyReviewer(staff)) return json(req, { error: "Quote access required" }, 403);
      const page = Math.max(0, Math.floor(Number(body.page) || 0));
      const pageSize = Math.min(100, Math.max(20, Math.floor(Number(body.page_size) || 50)));
      const status = text(body.status, 30);
      const search = text(body.search, 100).replace(/[,%_]/g, " ");
      let query = supabase.from("kiosk_requests").select(
        "*, kiosk_profile:kiosk_profiles!kiosk_requests_kiosk_profile_id_fkey(name, require_email), assigned_company:companies!kiosk_requests_assigned_company_id_fkey(name), assigned_user:app_users!kiosk_requests_assigned_user_id_fkey(username, custom_seller_name), kiosk_request_items(count)",
        { count: "exact" },
      );
      if (!staff.is_superadmin) {
        if (isCompanyReviewer(staff)) {
          if (!staff.company_id) return json(req, { error: "No company assigned" }, 403);
          query = query.eq("assigned_company_id", staff.company_id);
        } else {
          query = query.eq("assigned_user_id", staff.id);
        }
      }
      if (status && status !== "all") query = query.eq("status", status);
      if (search) query = query.or(`request_number.ilike.%${search}%,customer_name.ilike.%${search}%,customer_phone.ilike.%${search}%`);
      const { data, error, count } = await query
        .order("created_at", { ascending: false })
        .range(page * pageSize, page * pageSize + pageSize - 1);
      if (error) throw error;
      return json(req, { requests: data || [], total: count || 0, page, page_size: pageSize });
    }

    const requestId = text(body.request_id, 80);
    let currentRequest: Record<string, unknown> | null = null;
    if (["admin_get_request", "admin_update_request", "admin_convert_request"].includes(action)) {
      if (!UUID_RE.test(requestId)) return json(req, { error: "Invalid request" }, 400);
      const { data, error } = await supabase.from("kiosk_requests")
        .select("*, kiosk_profile:kiosk_profiles!kiosk_requests_kiosk_profile_id_fkey(name, require_email)")
        .eq("id", requestId)
        .maybeSingle();
      if (error) throw error;
      if (!data || !canAccessRequest(staff, data)) return json(req, { error: "Kiosk request not found" }, 404);
      currentRequest = data;
    }

    if (action === "admin_get_request") {
      const [itemsResult, eventsResult] = await Promise.all([
        supabase.from("kiosk_request_items").select("*").eq("request_id", requestId).order("sort_order"),
        supabase.from("kiosk_request_events").select("*").eq("request_id", requestId).order("created_at", { ascending: false }),
      ]);
      if (itemsResult.error) throw itemsResult.error;
      if (eventsResult.error) throw eventsResult.error;
      return json(req, { request: { ...currentRequest, items: itemsResult.data || [], events: eventsResult.data || [] } });
    }

    if (action === "admin_product_search") {
      const companyId = text(body.company_id, 80);
      if (!UUID_RE.test(companyId) || !canUseCompany(staff, companyId)) return json(req, { error: "Company access denied" }, 403);
      const { data, error } = await supabase.rpc("kiosk_admin_product_search", {
        p_company_id: companyId,
        p_search: text(body.search, 100),
        p_limit: 30,
      });
      if (error) throw error;
      return json(req, { products: data || [] });
    }

    if (action === "admin_update_request") {
      if (currentRequest?.quote_id) return json(req, { error: "Converted requests cannot be edited" }, 409);
      const input = body.request || {};
      let assignedCompanyId = text(input.assigned_company_id, 80) || String(currentRequest?.assigned_company_id || "");
      if (!staff.is_superadmin) assignedCompanyId = String(currentRequest?.assigned_company_id || staff.company_id || "");
      if (!UUID_RE.test(assignedCompanyId)) return json(req, { error: "Assigned company is required" }, 400);
      let assignedUserId = UUID_RE.test(text(input.assigned_user_id, 80)) ? text(input.assigned_user_id, 80) : null;
      if (!isCompanyReviewer(staff)) {
        assignedCompanyId = String(currentRequest?.assigned_company_id || staff.company_id || "");
        assignedUserId = String(currentRequest?.assigned_user_id || "") || null;
      }
      if (!Array.isArray(input.items)) return json(req, { error: "Request products are required" }, 400);
      const items = input.items.slice(0, 200).map((item: Record<string, unknown>) => ({
        barcode: text(item.product_barcode || item.barcode, 200),
        quantity: Math.floor(Number(item.quantity)),
        unit_price: Number(item.unit_price),
        price_mode: item.price_mode === "reseller" ? "reseller" : "retail",
      }));
      const { error } = await supabase.rpc("update_kiosk_request", {
        p_request_id: requestId,
        p_customer_name: text(input.customer_name, 120),
        p_customer_phone: text(input.customer_phone, 40),
        p_customer_email: text(input.customer_email, 160) || null,
        p_customer_note: text(input.customer_note, 500) || null,
        p_status: text(input.status, 30) || "reviewing",
        p_assigned_company_id: assignedCompanyId,
        p_assigned_user_id: assignedUserId,
        p_internal_notes: text(input.internal_notes, 2000) || null,
        p_items: items,
        p_actor_user_id: staff.id,
        p_actor_name: actorName,
      });
      if (error) throw error;
      return json(req, { success: true });
    }

    if (action === "admin_convert_request") {
      if (!staff.can_create_quote && !isCompanyReviewer(staff)) return json(req, { error: "Quote creation access required" }, 403);
      if (currentRequest?.contact_details_pending === true) {
        return json(req, { error: "Complete customer details before creating the quote" }, 400);
      }
      const { data, error } = await supabase.rpc("convert_kiosk_request", {
        p_request_id: requestId,
        p_actor_user_id: staff.id,
        p_actor_name: actorName,
      });
      if (error) throw error;
      const quote = Array.isArray(data) ? data[0] : data;
      return json(req, { success: true, quote });
    }

    return json(req, { error: "Invalid action" }, 400);
  } catch (error) {
    console.error("kiosk error:", error);
    const message = error instanceof Error
      ? error.message
      : typeof (error as { message?: unknown })?.message === "string"
        ? String((error as { message: string }).message)
        : "Unexpected kiosk error";
    return json(req, { error: message }, 500);
  }
});
