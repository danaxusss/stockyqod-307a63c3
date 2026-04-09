import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Strip accents: é→e, à→a, ç→c, etc.
function removeAccents(str: string): string {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

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

    // Extract the last user message
    const lastUserMsg = [...messages].reverse().find((m: any) => m.role === "user")?.content || "";
    
    // Normalize: remove accents, lowercase
    const normalized = removeAccents(lastUserMsg).toLowerCase();
    
    // Extract meaningful search keywords (>2 chars, skip common words)
    const stopWords = new Set(["les", "des", "une", "pour", "avec", "dans", "sur", "par", "que", "qui", "est", "sont", "pas", "plus", "mon", "ton", "son", "nos", "vos", "cette", "ces", "tout", "tous", "quel", "quels", "quelle", "quelles", "cherche", "besoin", "voudrais", "veux", "faut", "client", "produit", "produits", "article", "articles", "avez", "vous", "nous", "ils", "elle", "elles", "aussi", "mais", "donc", "comme", "bien", "tres", "peu", "trop", "prix", "cher", "pas", "gamme"]);
    
    const keywords = normalized
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .filter((w: string) => w.length > 1 && !stopWords.has(w))
      .map((w: string) => w.replace(/s$/, "")); // basic French plural stemming

    console.log("Search keywords:", keywords);

    let products: any[] = [];
    
    if (keywords.length > 0) {
      // Strategy: ALL keywords must appear in the product name (AND logic)
      // Build a chain of .ilike filters on name
      let query = supabase
        .from("products")
        .select("barcode, name, brand, price, reseller_price, buyprice, provider, stock_levels");
      
      for (const kw of keywords) {
        query = query.ilike("name", `%${kw}%`);
      }
      
      const { data, error } = await query.limit(50);
      
      if (error) {
        console.error("DB search error:", error);
      } else {
        products = data || [];
      }

      // If AND logic returns nothing, try with the longest keyword alone (likely the most specific)
      if (products.length === 0) {
        const sortedByLen = [...keywords].sort((a, b) => b.length - a.length);
        const mainKw = sortedByLen[0];
        console.log("Fallback: searching with main keyword:", mainKw);
        const { data: fallbackData } = await supabase
          .from("products")
          .select("barcode, name, brand, price, reseller_price, buyprice, provider, stock_levels")
          .ilike("name", `%${mainKw}%`)
          .limit(50);
        if (fallbackData) products = fallbackData;
      }
    }

    console.log(`Found ${products.length} products`);

    // Build product catalog for context - include barcode prominently for extraction
    const productCatalog = products.length > 0
      ? products.map((p: any, i: number) => {
          const totalStock = Object.values(p.stock_levels || {}).reduce((sum: number, v: any) => sum + (Number(v) || 0), 0);
          const stockDetail = Object.entries(p.stock_levels || {}).map(([loc, qty]) => `${loc}: ${qty}`).join(", ");
          return `${i + 1}. [BARCODE:${p.barcode}] ${p.name} | Marque: ${p.brand || 'N/A'} | Prix: ${p.price} DH | Prix revendeur: ${p.reseller_price} DH | Stock total: ${totalStock} (${stockDetail})`;
        }).join("\n")
      : "Aucun produit trouvé pour cette recherche.";

    const systemPrompt = `Tu es un assistant commercial expert. Tu aides les vendeurs à trouver des produits dans la base de données.

RÉSULTATS DE RECHERCHE (${products.length} produits trouvés):
${productCatalog}

INSTRUCTIONS STRICTES:
1. Présente CHAQUE produit SÉPARÉMENT avec ce format exact:

**Nom du produit**
- Code: [BARCODE:xxxxx]
- Marque: ...
- Prix public: ... DH
- Prix revendeur: ... DH  
- Stock: ...

2. Tu DOIS inclure le tag [BARCODE:xxxxx] pour chaque produit exactement comme dans les résultats.
3. Si beaucoup de résultats (>10), demande au client de préciser:
   - Gamme de prix souhaitée (économique / milieu de gamme / haut de gamme)
   - Usage (professionnel / domestique)
   - Marque préférée
   - Capacité ou taille
4. Si aucun produit trouvé, dis-le et suggère d'autres termes de recherche.
5. N'invente JAMAIS de produits.
6. Réponds en français, sois concis.
7. Ne montre PAS le prix d'achat (buyprice).`;

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
