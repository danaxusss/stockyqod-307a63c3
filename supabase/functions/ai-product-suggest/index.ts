import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function removeAccents(str: string): string {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const { messages, company_id, username } = body;

    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: "messages array required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");
    if (!OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY not configured");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Load company AI settings if company_id provided
    let aiModel = Deno.env.get("AI_MODEL") || "google/gemini-2.0-flash-exp:free";
    let customSystemPrompt = "";
    let aiEnabled = true;

    if (company_id) {
      const { data: company } = await supabase
        .from("companies")
        .select("ai_model, ai_system_prompt, ai_enabled")
        .eq("id", company_id)
        .maybeSingle();

      if (company) {
        if (company.ai_enabled === false) {
          return new Response(JSON.stringify({ error: "L'assistant IA est désactivé." }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        if (company.ai_model) aiModel = company.ai_model;
        if (company.ai_system_prompt) customSystemPrompt = company.ai_system_prompt;
      }
    }

    // Extract the last user message for product search
    const lastUserMsg = [...messages].reverse().find((m: any) => m.role === "user")?.content || "";
    const normalized = removeAccents(lastUserMsg).toLowerCase();

    const stopWords = new Set([
      "les", "des", "une", "pour", "avec", "dans", "sur", "par", "que", "qui",
      "est", "sont", "pas", "plus", "mon", "ton", "son", "nos", "vos", "cette",
      "ces", "tout", "tous", "quel", "quels", "quelle", "quelles", "cherche",
      "besoin", "voudrais", "veux", "faut", "client", "produit", "produits",
      "article", "articles", "avez", "vous", "nous", "ils", "elle", "elles",
      "aussi", "mais", "donc", "comme", "bien", "tres", "peu", "trop", "prix",
      "cher", "gamme", "oui", "non", "merci", "bonjour", "monsieur", "madame",
      "nom", "prenom", "telephone", "tel", "adresse", "ville", "devis", "creer",
      "faire", "etablir", "preparer", "client", "ok", "parfait", "super",
    ]);

    const keywords = normalized
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .filter((w: string) => w.length > 2 && !stopWords.has(w))
      .map((w: string) => w.replace(/s$/, ""));

    console.log("Search keywords:", keywords);

    let products: any[] = [];

    if (keywords.length > 0) {
      let query = supabase
        .from("products")
        .select("barcode, name, brand, price, reseller_price, buyprice, provider, stock_levels");

      for (const kw of keywords) {
        query = query.ilike("name", `%${kw}%`);
      }

      const { data, error } = await query.limit(50);
      if (!error && data) products = data;

      // Fallback: longest keyword alone
      if (products.length === 0 && keywords.length > 0) {
        const mainKw = [...keywords].sort((a, b) => b.length - a.length)[0];
        const { data: fallbackData } = await supabase
          .from("products")
          .select("barcode, name, brand, price, reseller_price, buyprice, provider, stock_levels")
          .ilike("name", `%${mainKw}%`)
          .limit(50);
        if (fallbackData) products = fallbackData;
      }
    }

    console.log(`Found ${products.length} products`);

    const productCatalog = products.length > 0
      ? products.map((p: any, i: number) => {
          const totalStock = Object.values(p.stock_levels || {}).reduce(
            (sum: number, v: any) => sum + (Number(v) || 0), 0
          );
          const stockDetail = Object.entries(p.stock_levels || {})
            .map(([loc, qty]) => `${loc}: ${qty}`)
            .join(", ");
          return `${i + 1}. [BARCODE:${p.barcode}] ${p.name} | Marque: ${p.brand || "N/A"} | Prix public: ${p.price} DH | Prix revendeur: ${p.reseller_price} DH | Stock: ${totalStock} (${stockDetail})`;
        }).join("\n")
      : "Aucun produit trouvé pour cette recherche.";

    const systemPrompt = `Tu es un assistant commercial expert intégré à un logiciel de gestion de stock et de devis.
Tu DOIS UNIQUEMENT travailler avec les produits présents dans la base de données ci-dessous.
Tu ne consultes JAMAIS Internet, Google, ou une source externe. Tu n'inventes JAMAIS de produits, de barcodes ou de prix.
Tu réponds TOUJOURS en français.
${username ? `L'utilisateur connecté est : ${username}.` : ""}

═══════════════════════════════════════════════
CATALOGUE ACTUEL (${products.length} produit(s) trouvé(s) pour cette requête) :
${productCatalog}
═══════════════════════════════════════════════

━━━ PRÉSENTATION DES PRODUITS ━━━
Pour chaque produit trouvé, utilise ce format :

**Nom du produit**
- Code : [BARCODE:xxxxx]
- Marque : ...
- Prix public : X DH | Prix revendeur : Y DH
- Stock : Z unités

Si plus de 10 résultats → demande de préciser : gamme de prix, usage (pro/domestique), marque préférée, taille/capacité.
Si aucun résultat → dis-le clairement et propose des termes de recherche alternatifs.
Ne montre JAMAIS le prix d'achat (buyprice).

━━━ MODE DEVIS ━━━
Active ce mode quand l'utilisateur demande à créer un devis ou fournit une liste de produits.

ÉTAPE 1 — IDENTIFICATION ET CONFIRMATION DES PRODUITS :
- Pour chaque article demandé, recherche dans le catalogue et présente ce qui correspond
- Si plusieurs variantes → demande laquelle
- Confirme la quantité pour chaque produit confirmé
- Note les articles introuvables dans le catalogue (ne les invente pas, ne les cherche pas ailleurs)

ÉTAPE 2 — INFORMATIONS CLIENT :
Une fois tous les produits confirmés, demande en UN SEUL message :
"Parfait ! Pour finaliser le devis, j'ai besoin des informations du client :
• Nom complet ?
• Numéro de téléphone ?
• Adresse ?
• Ville ?"

ÉTAPE 3 — GÉNÉRATION DU DEVIS :
Quand tu as confirmé : ✅ les produits + quantités ET ✅ les infos client :

1. Annonce que le devis est prêt
2. Si des produits étaient introuvables, mentionne-les brièvement
3. Place EXACTEMENT à la fin de ta réponse, sur une seule ligne continue, ce bloc JSON :

[QUOTE_DRAFT:{"customer":{"fullName":"NOM COMPLET","phoneNumber":"TELEPHONE","address":"ADRESSE","city":"VILLE","salesPerson":"IA"},"items":[{"barcode":"CODE_BARCODE","quantity":1,"priceType":"normal"}],"missing_products":["produit manquant 1","produit manquant 2"],"notes":"Devis créé par IA. Articles ajoutés: X. Produits non trouvés dans le catalogue: Y, Z."}]

Règles STRICTES pour le QUOTE_DRAFT :
- "items" : uniquement les produits CONFIRMÉS avec leurs vrais barcodes du catalogue
- "missing_products" : liste des articles demandés mais absents du catalogue (tableau vide [] si aucun)
- "notes" : résumé court (ex: "Devis IA: 3 articles. Introuvable dans catalogue: TV Samsung 65'")
- Si aucun produit manquant : "missing_products":[] et ne mentionne pas les manquants dans les notes
- "salesPerson" : toujours "IA"
${customSystemPrompt ? `\n━━━ INSTRUCTIONS SPÉCIALES DU SUPERADMIN ━━━\n${customSystemPrompt}` : ""}`;

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://stockyqod.app",
        "X-Title": "Stocky QOD",
      },
      body: JSON.stringify({
        model: aiModel,
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
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Crédits IA épuisés." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("OpenRouter error:", response.status, t);
      return new Response(JSON.stringify({ error: "Erreur du service IA" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
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
