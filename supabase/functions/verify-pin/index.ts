import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import * as bcrypt from "https://deno.land/x/bcrypt@v0.4.1/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { action, username, pin, userId, newPin } = await req.json();
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    if (action === "verify") {
      // Verify PIN for login
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

      // Check if PIN is hashed (starts with $2) or plain text (legacy)
      let isValid = false;
      if (user.pin.startsWith("$2")) {
        isValid = await bcrypt.compare(pin, user.pin);
      } else {
        // Legacy plain text comparison - also hash it now for migration
        isValid = user.pin === pin;
        if (isValid) {
          const hashed = await bcrypt.hash(pin);
          await supabase.from("app_users").update({ pin: hashed }).eq("id", user.id);
        }
      }

      if (isValid) {
        // Return user data without the PIN hash
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
      // Hash a new PIN (for user creation/update)
      if (!newPin) {
        return new Response(JSON.stringify({ error: "newPin required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const hashed = await bcrypt.hash(newPin);
      return new Response(JSON.stringify({ hashedPin: hashed }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "verify-pin-only") {
      // Verify by PIN only (find user by PIN - for backward compat)
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
        let isValid = false;
        if (user.pin.startsWith("$2")) {
          isValid = await bcrypt.compare(pin, user.pin);
        } else {
          isValid = user.pin === pin;
          if (isValid) {
            const hashed = await bcrypt.hash(pin);
            await supabase.from("app_users").update({ pin: hashed }).eq("id", user.id);
          }
        }
        if (isValid) {
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
