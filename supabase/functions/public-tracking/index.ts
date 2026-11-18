// Public delivery tracking (/track/<token>): the customer follows the driver.
//
// The page used to read tracking_sessions, driver_locations and tasks, and to
// listen to realtime changes, with the public key. Since secure login step 2
// that key opens nothing, so this function (service role) checks the link
// (active and not expired) and returns only what the page shows. The page
// polls it instead of listening to realtime changes. verify_jwt = false:
// visitors are anonymous.
//
// Actions (POST JSON):
//   { action: "get", token }      → delivery, driver phone, last position
//   { action: "poll", token }     → status, destination and last position
//   { action: "address", token }  → the delivery address, to place the
//                                   destination when GPS is refused
//   { action: "set_destination", token, latitude, longitude, source: "gps" | "address" }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { clientIp, corsHeaders, guard, json } from "../_shared/security.ts";
import { destinationInput, isLinkToken, publicLocation, publicTrackingSession, trackingStatus } from "../_shared/publicLinks.ts";

const ACTIONS = new Set(["get", "poll", "address", "set_destination"]);
// The page polls every 15 s (the driver sends a position every 15 s).
const LIMITS: Record<string, { ip: number; token: number }> = {
  get: { ip: 600, token: 2000 },
  poll: { ip: 1500, token: 3000 },
  address: { ip: 60, token: 60 },
  set_destination: { ip: 60, token: 60 },
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, { error: "POST required" }, 405);
  if (Number(req.headers.get("content-length") || 0) > 10_000) return json(req, { error: "Request too large" }, 413);

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
    if (!ACTIONS.has(action)) return json(req, { error: "Invalid action" }, 400);

    const limit = LIMITS[action];
    const blocked = await guard(req, [
      { bucket: `public-tracking:${action}:ip`, id: ip, max: limit.ip, window: 60 * 60 },
      ...(isLinkToken(token) ? [{ bucket: `public-tracking:${action}:token`, id: token, max: limit.token, window: 60 * 60 }] : []),
    ]);
    if (blocked) return blocked;
    if (!isLinkToken(token)) return json(req, { status: "missing" });

    const { data: session, error } = await supabase
      .from("tracking_sessions")
      .select("id, task_id, driver_id, client_name, is_active, expires_at, destination_latitude, destination_longitude, destination_source")
      .eq("token", token)
      .maybeSingle();
    if (error) throw error;
    const status = trackingStatus(session);
    if (status !== "ok" || !session) return json(req, { status });

    const lastLocation = async () => {
      const { data } = await supabase
        .from("driver_locations")
        .select("latitude, longitude, accuracy, created_at")
        .eq("session_id", session.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return publicLocation(data);
    };

    if (action === "get") {
      // Only the phone of this delivery's driver, never the user record.
      const { data: driver } = await supabase.from("app_users").select("phone").eq("id", session.driver_id).maybeSingle();
      const phone = typeof driver?.phone === "string" && driver.phone.trim() ? driver.phone.trim() : null;
      return json(req, { status, session: publicTrackingSession(session), driver_phone: phone, location: await lastLocation() });
    }

    if (action === "poll") {
      return json(req, { status, session: publicTrackingSession(session), location: await lastLocation() });
    }

    const hasDestination = session.destination_latitude != null && session.destination_longitude != null;

    if (action === "address") {
      if (hasDestination || !session.task_id) return json(req, { status, address: null });
      const { data: task } = await supabase.from("tasks").select("address").eq("id", session.task_id).maybeSingle();
      const address = typeof task?.address === "string" ? task.address.trim().slice(0, 500) : "";
      return json(req, { status, address: address || null });
    }

    // set_destination: GPS from the customer's phone at any time; the
    // address-based guess only when nothing better is known yet.
    const destination = destinationInput(body);
    if (!destination) return json(req, { error: "Invalid position" }, 400);
    if (destination.source === "address" && hasDestination) {
      return json(req, { status, session: publicTrackingSession(session) });
    }
    const { data: updated, error: updateError } = await supabase
      .from("tracking_sessions")
      .update({
        destination_latitude: destination.latitude,
        destination_longitude: destination.longitude,
        destination_source: destination.source,
      })
      .eq("id", session.id)
      .select("client_name, expires_at, destination_latitude, destination_longitude, destination_source")
      .single();
    if (updateError) throw updateError;
    return json(req, { status, session: publicTrackingSession(updated) });
  } catch (error) {
    console.error("public-tracking error:", error);
    return json(req, { error: "Erreur lors du chargement" }, 500);
  }
});
