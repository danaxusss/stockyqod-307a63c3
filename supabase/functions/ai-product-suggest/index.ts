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

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Extract the last user message to build search queries
    const lastUserMsg = [...messages].reverse().find((m: any) => m.role === "user")?.content || "";
    
    // Extract meaningful search keywords (>2 chars, skip common words)
    const stopWords = new Set(["les", "des", "une", "pour", "avec", "dans", "sur", "par", "que", "qui", "est", "sont", "pas", "plus", "mon", "ton", "son", "nos", "vos", "cette", "ces", "tout", "tous", "quel", "quels", "quelle", "quelles", "cherche", "besoin", "voudrais", "veux", "faut", "client", "produit", "produits", "article", "articles", "avez", "vous", "nous", "ils", "elle", "elles", "aussi", "mais", "donc", "comme", "bien", "très", "peu", "trop"]);
    
    const keywords = lastUserMsg
      .toLowerCase()
      .replace(/[^a-zà-ÿ0-9\s-]/g, " ")
      .split(/\s+/)
      .filter((w: string) => w.length > 2 && !stopWords.has(w));

    // Search products using ILIKE on name, brand, barcode, and provider
    let products: any[] = [];
    
    if (keywords.length > 0) {
      // Build OR conditions: each keyword matches name, brand, barcode, or provider
      const orConditions = keywords.map((kw: string) => 
        `name.ilike.%${kw}%,brand.ilike.%${kw}%,barcode.ilike.%${kw}%,provider.ilike.%${kw}%`
      ).join(",");

      const { data, error } = await supabase
        .from("products")
        .select("barcode, name, brand, price, reseller_price, buyprice, provider, stock_levels")
        .or(orConditions)
        .limit(100);

      if (error) {
        console.error("DB search error:", error);
        // Fallback: try individual keyword searches
        for (const kw of keywords.slice(0, 5)) {
          const { data: kwData } = await supabase
            .from("products")
            .select("barcode, name, brand, price, reseller_price, buyprice, provider, stock_levels")
            .or(`name.ilike.%${kw}%,brand.ilike.%${kw}%,barcode.ilike.%${kw}%`)
            .limit(50);
          if (kwData) products.push(...kwData);
        }
        // Deduplicate by barcode
        const seen = new Set<string>();
        products = products.filter(p => {
          if (seen.has(p.barcode)) return false;
          seen.add(p.barcode);
          return true;
        });
      } else {
        products = data || [];
      }
    }

    // If no results from keyword search, try a broader search with fewer keywords
    if (products.length === 0 && keywords.length > 0) {
      for (const kw of keywords.slice(0, 3)) {
        const { data } = await supabase
          .from("products")
          .select("barcode, name, brand, price, reseller_price, buyprice, provider, stock_levels")
          .or(`name.ilike.%${kw}%,brand.ilike.%${kw}%`)
          .limit(50);
        if (data) products.push(...data);
      }
      const seen = new Set<string>();
      products = products.filter(p => {
        if (seen.has(p.barcode)) return false;
        seen.add(p.barcode);
        return true;
      });
    }

    // Build product catalog for context
    const productCatalog = products.length > 0
      ? products.map((p: any) => {
          const totalStock = Object.values(p.stock_levels || {}).reduce((sum: number, v: any) => sum + (Number(v) || 0), 0);
          const stockDetail = Object.entries(p.stock_levels || {}).map(([loc, qty]) => `${loc}: ${qty}`).join(", ");
          return `- ${p.name} | Marque: ${p.brand} | Code: ${p.barcode} | Prix: ${p.price} DH | Prix revendeur: ${p.reseller_price} DH | Stock total: ${totalStock} (${stockDetail}) | Fournisseur: ${p.provider}`;
        }).join("\n")
      : "Aucun produit trouvé pour cette recherche.";

    const systemPrompt = `Tu es un assistant commercial expert pour une boutique. Tu aides les vendeurs à trouver des produits.

RÉSULTATS DE RECHERCHE (${products.length} produits trouvés):
${productCatalog}

INSTRUCTIONS:
- Présente TOUS les produits trouvés ci-dessus qui correspondent à la demande du client.
- Pour chaque produit: nom, marque, code-barres, prix, prix revendeur, et stock par emplacement.
- Si le stock est 0, mentionne-le mais propose quand même le produit.
- Si aucun produit n'a été trouvé, dis-le clairement et suggère de reformuler la recherche avec d'autres termes.
- Formate ta réponse avec des listes claires et lisibles.
- Réponds en français.
- Sois concis et pratique.
- N'invente JAMAIS de produits qui ne sont pas dans les résultats ci-dessus.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
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
