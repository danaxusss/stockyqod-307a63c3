import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { messages } = await req.json();
    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: "messages array required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    // Fetch products from DB for context
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: products, error: dbError } = await supabase
      .from("products")
      .select("barcode, name, brand, price, reseller_price, buyprice, provider, stock_levels")
      .limit(1000);

    if (dbError) {
      console.error("DB error:", dbError);
      throw new Error("Failed to fetch products");
    }

    // Build product catalog summary for the AI
    const productCatalog = (products || []).map((p: any) => {
      const totalStock = Object.values(p.stock_levels || {}).reduce((sum: number, v: any) => sum + (Number(v) || 0), 0);
      return `- ${p.name} | Marque: ${p.brand} | Code: ${p.barcode} | Prix: ${p.price} DH | Prix revendeur: ${p.reseller_price} DH | Stock: ${totalStock} | Fournisseur: ${p.provider}`;
    }).join("\n");

    const systemPrompt = `Tu es un assistant commercial expert. Tu aides les vendeurs à trouver des produits dans le catalogue.

CATALOGUE PRODUITS:
${productCatalog}

INSTRUCTIONS:
- Quand on te demande des produits, cherche dans le catalogue ci-dessus les produits correspondants ou similaires.
- Présente chaque produit trouvé avec son nom, marque, code-barres, prix, et stock disponible.
- Si un produit exact n'existe pas, suggère des alternatives similaires du catalogue.
- Formate ta réponse de manière claire avec des listes.
- Réponds en français.
- Si le stock est 0, mentionne-le mais propose quand même le produit.
- Sois concis et pratique.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          ...messages,
        ],
        stream: true,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Trop de requêtes, réessayez dans quelques instants." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Crédits IA épuisés." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(JSON.stringify({ error: "Erreur du service IA" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("ai-product-suggest error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
