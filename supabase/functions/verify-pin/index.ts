import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// PBKDF2-based hashing using Web Crypto API (no Worker needed)
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
  // Legacy: bcrypt hash or plain text — fall back to plain compare
  if (stored.startsWith("$2")) {
    // Can't verify bcrypt here; treat as needing re-hash via plain match
    return false;
  }
  return stored === pin;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { action, username, pin, userId, newPin } = await req.json();
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    if (action === "verify") {
      if (!username || !pin) {
        return new Response(JSON.stringify({ error: "username and pin required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: user, error } = await supabase
        .from("app_users")
        .select("*")
        .eq("username", username)
        .single();

      if (error || !user) {
        return new Response(JSON.stringify({ success: false }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
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
        return new Response(JSON.stringify({ success: true, user: safeUser }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ success: false }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "hash") {
      if (!newPin) {
        return new Response(JSON.stringify({ error: "newPin required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const hashed = await hashPin(newPin);
      return new Response(JSON.stringify({ hashedPin: hashed }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "verify-pin-only") {
      if (!pin) {
        return new Response(JSON.stringify({ error: "pin required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: users, error } = await supabase
        .from("app_users")
        .select("*");

      if (error || !users) {
        return new Response(JSON.stringify({ success: false }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
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
          return new Response(JSON.stringify({ success: true, user: safeUser }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      return new Response(JSON.stringify({ success: false }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Invalid action" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("verify-pin error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
