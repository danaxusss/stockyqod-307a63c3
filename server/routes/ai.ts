import { Router, Request, Response } from 'express';
import { prisma } from '../db.js';

const router = Router();

function removeAccents(str: string): string {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

const STOP_WORDS = new Set(['les', 'des', 'une', 'pour', 'avec', 'dans', 'sur', 'par', 'que', 'qui', 'est', 'sont', 'pas', 'plus', 'mon', 'ton', 'son', 'nos', 'vos', 'cette', 'ces', 'tout', 'tous', 'quel', 'quels', 'quelle', 'quelles', 'cherche', 'besoin', 'voudrais', 'veux', 'faut', 'client', 'produit', 'produits', 'article', 'articles', 'avez', 'vous', 'nous', 'ils', 'elle', 'elles', 'aussi', 'mais', 'donc', 'comme', 'bien', 'tres', 'peu', 'trop', 'prix', 'cher', 'gamme']);

// POST /api/ai/chat
router.post('/chat', async (req: Request, res: Response) => {
  try {
    const ai = await prisma.aiSettings.findFirst();
    if (!ai || !ai.enabled || !ai.provider || !ai.api_key) {
      return res.status(503).json({ error: "L'assistant IA n'est pas configuré. Contactez l'administrateur." });
    }

    const { messages } = req.body as { messages: Array<{ role: string; content: string }> };
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'messages array required' });
    }

    // Build product context from last user message
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')?.content ?? '';
    const normalized = removeAccents(lastUserMsg).toLowerCase();
    const keywords = normalized
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 1 && !STOP_WORDS.has(w))
      .map(w => w.replace(/s$/, ''));

    let products: Array<{ barcode: string; name: string; brand: string; price: unknown; reseller_price: unknown; provider: string; stock_levels: unknown }> = [];

    if (keywords.length > 0) {
      // AND search — all keywords must appear in the name
      const where = keywords.reduce((acc, kw) => ({ ...acc, AND: [...(acc.AND ?? []), { name: { contains: kw, mode: 'insensitive' as const } }] }), {} as any);
      products = await prisma.product.findMany({ where, take: 50, select: { barcode: true, name: true, brand: true, price: true, reseller_price: true, provider: true, stock_levels: true } }) as any;

      // Fallback: single longest keyword
      if (products.length === 0 && keywords.length > 0) {
        const kw = [...keywords].sort((a, b) => b.length - a.length)[0];
        products = await prisma.product.findMany({ where: { name: { contains: kw, mode: 'insensitive' } }, take: 50, select: { barcode: true, name: true, brand: true, price: true, reseller_price: true, provider: true, stock_levels: true } }) as any;
      }
    }

    const catalog = products.length > 0
      ? products.map((p, i) => {
          const levels = (p.stock_levels as Record<string, number>) ?? {};
          const total = Object.values(levels).reduce((s, v) => s + (Number(v) || 0), 0);
          const detail = Object.entries(levels).map(([l, q]) => `${l}: ${q}`).join(', ');
          return `${i + 1}. [BARCODE:${p.barcode}] ${p.name} | Marque: ${p.brand || 'N/A'} | Prix: ${Number(p.price)} DH | Prix revendeur: ${Number(p.reseller_price)} DH | Stock total: ${total} (${detail})`;
        }).join('\n')
      : 'Aucun produit trouvé pour cette recherche.';

    const systemPrompt = `Tu es un assistant commercial expert. Tu aides les vendeurs à trouver des produits dans la base de données.\n\nRÉSULTATS DE RECHERCHE (${products.length} produits trouvés):\n${catalog}\n\nINSTRUCTIONS STRICTES:\n1. Présente CHAQUE produit SÉPARÉMENT avec ce format exact:\n\n**Nom du produit**\n- Code: [BARCODE:xxxxx]\n- Marque: ...\n- Prix public: ... DH\n- Prix revendeur: ... DH\n- Stock: ...\n\n2. Tu DOIS inclure le tag [BARCODE:xxxxx] pour chaque produit.\n3. Si plus de 10 résultats, demande des précisions.\n4. Si aucun produit, dis-le et suggère d'autres termes.\n5. N'invente JAMAIS de produits.\n6. Réponds en français, sois concis.`;

    const response = await callAI(ai.provider!, ai.api_key!, ai.model, systemPrompt, messages as any);

    if (!response.ok) {
      const body = await response.text();
      console.error(`AI API error ${response.status}:`, body);
      if (response.status === 429) return res.status(429).json({ error: 'Trop de requêtes, réessayez dans quelques instants.' });
      if (response.status === 402) return res.status(402).json({ error: 'Crédits IA épuisés.' });
      return res.status(500).json({ error: 'Erreur du service IA' });
    }

    // Stream response back to client
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    response.body!.pipe(res as any);
  } catch (err) {
    console.error('AI chat error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

async function callAI(
  provider: string,
  apiKey: string,
  model: string | null,
  systemPrompt: string,
  messages: Array<{ role: string; content: string }>
): Promise<globalThis.Response> {
  switch (provider) {
    case 'openai':
      return fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: model || 'gpt-4o-mini',
          messages: [{ role: 'system', content: systemPrompt }, ...messages],
          stream: true,
        }),
      });

    case 'anthropic':
      return fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json', 'anthropic-beta': 'messages-2023-06-01' },
        body: JSON.stringify({
          model: model || 'claude-haiku-4-5-20251001',
          max_tokens: 1024,
          system: systemPrompt,
          messages,
          stream: true,
        }),
      });

    case 'gemini': {
      const geminiModel = model || 'gemini-2.0-flash-lite';
      return fetch(`https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:streamGenerateContent?alt=sse&key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
        }),
      });
    }

    default:
      throw new Error(`Unsupported AI provider: ${provider}`);
  }
}

export default router;
