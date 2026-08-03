import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, json, clientIp, guard } from "../_shared/security.ts";

// PBKDF2-based hashing using Web Crypto API (no Worker needed)
const ITERATIONS = 100000;
const SALT_LENGTH = 16;

// ── Rate limits ─────────────────────────────────────────────────────────────
// PINs are short, so unlimited guessing is the single biggest risk here.
// Windows are in seconds. Limits are per fixed window.
const LIMITS = {
  // one login form behind office NAT can legitimately retry a few times
  verifyIpShort:   { max: 30,  window: 15 * 60 },       // 30 / 15 min per IP
  verifyIpDaily:   { max: 300, window: 24 * 60 * 60 },  // stops slow grinding
  // a targeted attack on one account
  verifyUser:      { max: 8,   window: 15 * 60 },
  // "does this PIN match ANY user" — the jackpot query, keep it tight
  anyUserIp:       { max: 10,  window: 15 * 60 },
  anyUserDaily:    { max: 60,  window: 24 * 60 * 60 },
  // PBKDF2 at 100k iterations is CPU-heavy: unlimited calls are a DoS vector
  hashIp:          { max: 20,  window: 60 * 60 },
};

const TOO_MANY_MSG = "Trop de tentatives. Réessayez dans quelques minutes.";

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
  // Legacy: bcrypt hash or plain text — fall back to plain compare
  if (stored.startsWith("$2")) {
    // Can't verify bcrypt here; treat as needing re-hash via plain match
    return false;
  }
  return stored === pin;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });

  try {
    const { action, username, pin, userId, newPin } = await req.json();
    const ip = clientIp(req);
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    if (action === "verify") {
      if (!username || !pin) {
        return json(req, { error: "username and pin required" }, 400);
      }

      // failClosed: if the limiter itself is down we refuse rather than allow
      // unlimited credential guessing.
      const blocked = await guard(req, [
        { bucket: "verify-pin:ip", id: ip, max: LIMITS.verifyIpShort.max, window: LIMITS.verifyIpShort.window, failClosed: true, message: TOO_MANY_MSG },
        { bucket: "verify-pin:ip:day", id: ip, max: LIMITS.verifyIpDaily.max, window: LIMITS.verifyIpDaily.window, failClosed: true, message: TOO_MANY_MSG },
        { bucket: "verify-pin:user", id: String(username).toLowerCase(), max: LIMITS.verifyUser.max, window: LIMITS.verifyUser.window, failClosed: true, message: TOO_MANY_MSG },
      ]);
      if (blocked) return blocked;

      const { data: user, error } = await supabase
        .from("app_users")
        .select("*")
        .eq("username", username)
        .single();

      if (error || !user) {
        return json(req, { success: false });
      }

      let isValid = await verifyPin(pin, user.pin);

      // If plain text match or bcrypt that can't be verified, migrate to PBKDF2
      if (!isValid && !user.pin.startsWith("pbkdf2:") && !user.pin.startsWith("$2") && user.pin === pin) {
        isValid = true;
      }

      // Migrate to PBKDF2 if valid but not already hashed with it
      if (isValid && !user.pin.startsWith("pbkdf2:")) {
        const hashed = await hashPin(pin);
        await supabase.from("app_users").update({ pin: hashed }).eq("id", user.id);
      }

      if (isValid) {
        const { pin: _, ...safeUser } = user;
        return json(req, { success: true, user: safeUser });
      }

      console.warn(`[verify-pin] failed login user=${username} ip=${ip}`);
      return json(req, { success: false });
    }

    if (action === "hash") {
      if (!newPin) {
        return json(req, { error: "newPin required" }, 400);
      }
      // PBKDF2 is deliberately slow — cap how often it can be triggered.
      const blocked = await guard(req, [
        { bucket: "verify-pin:hash", id: ip, max: LIMITS.hashIp.max, window: LIMITS.hashIp.window },
      ]);
      if (blocked) return blocked;

      const hashed = await hashPin(newPin);
      return json(req, { hashedPin: hashed });
    }

    if (action === "verify-pin-only") {
      if (!pin) {
        return json(req, { error: "pin required" }, 400);
      }

      // This action tests the PIN against EVERY user, so one lucky guess opens
      // an account — it needs the tightest budget of all.
      const blocked = await guard(req, [
        { bucket: "verify-pin:any:ip", id: ip, max: LIMITS.anyUserIp.max, window: LIMITS.anyUserIp.window, failClosed: true, message: TOO_MANY_MSG },
        { bucket: "verify-pin:any:day", id: ip, max: LIMITS.anyUserDaily.max, window: LIMITS.anyUserDaily.window, failClosed: true, message: TOO_MANY_MSG },
      ]);
      if (blocked) return blocked;

      const { data: users, error } = await supabase
        .from("app_users")
        .select("*");

      if (error || !users) {
        return json(req, { success: false });
      }

      for (const user of users) {
        let isValid = await verifyPin(pin, user.pin);
        if (!isValid && !user.pin.startsWith("pbkdf2:") && !user.pin.startsWith("$2") && user.pin === pin) {
          isValid = true;
        }
        if (isValid) {
          if (!user.pin.startsWith("pbkdf2:")) {
            const hashed = await hashPin(pin);
            await supabase.from("app_users").update({ pin: hashed }).eq("id", user.id);
          }
          const { pin: _, ...safeUser } = user;
          return json(req, { success: true, user: safeUser });
        }
      }

      console.warn(`[verify-pin] failed any-user PIN attempt ip=${ip}`);
      return json(req, { success: false });
    }

    return json(req, { error: "Invalid action" }, 400);
  } catch (e) {
    console.error("verify-pin error:", e);
    // Don't leak internals to the caller.
    return json(req, { error: "Unexpected error" }, 500);
  }
});
