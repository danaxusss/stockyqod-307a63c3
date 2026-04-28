import React, { useState, useRef, useEffect } from 'react';
import { MessageSquare, X, Send, Loader2, ShoppingCart, FileText, ExternalLink, RotateCcw, Bot, AlertTriangle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import { useQuoteCart } from '../hooks/useQuoteCart';
import { useAuth } from '../hooks/useAuth';
import { useEscapeKey } from '../hooks/useShortcuts';
import { Product, Quote, QuoteItem, CustomerInfo } from '../types';
import { SupabaseQuotesService } from '../utils/supabaseQuotes';
import ReactMarkdown from 'react-markdown';

type Msg = { role: 'user' | 'assistant'; content: string };
type CreatedQuote = { id: string; quoteNumber: string };

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-product-suggest`;

// ─── Parse QUOTE_DRAFT from AI response ──────────────────────────────────────
function extractQuoteDraft(content: string): { customer: CustomerInfo; items: { barcode: string; quantity: number; priceType: 'normal' | 'reseller' }[]; missing_products: string[]; notes: string } | null {
  const prefix = '[QUOTE_DRAFT:';
  const start = content.indexOf(prefix);
  if (start === -1) return null;
  const jsonStart = start + prefix.length;
  let depth = 0;
  let jsonEnd = -1;
  for (let i = jsonStart; i < content.length; i++) {
    if (content[i] === '{') depth++;
    else if (content[i] === '}') { depth--; if (depth === 0) { jsonEnd = i + 1; break; } }
  }
  if (jsonEnd === -1) return null;
  try { return JSON.parse(content.slice(jsonStart, jsonEnd)); } catch { return null; }
}

// Strip QUOTE_DRAFT block from displayed text
function stripQuoteDraft(content: string): string {
  const prefix = '[QUOTE_DRAFT:';
  const start = content.indexOf(prefix);
  if (start === -1) return content;
  const jsonStart = start + prefix.length;
  let depth = 0;
  let jsonEnd = -1;
  for (let i = jsonStart; i < content.length; i++) {
    if (content[i] === '{') depth++;
    else if (content[i] === '}') { depth--; if (depth === 0) { jsonEnd = i + 2; break; } } // +2 includes ']'
  }
  if (jsonEnd === -1) return content;
  return (content.slice(0, start) + content.slice(jsonEnd)).trim();
}

// ─── Stream helper ────────────────────────────────────────────────────────────
async function streamChat({
  messages, company_id, username, onDelta, onDone, onError,
}: {
  messages: Msg[];
  company_id?: string | null;
  username?: string;
  onDelta: (text: string) => void;
  onDone: () => void;
  onError: (err: string) => void;
}) {
  const resp = await fetch(CHAT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
    },
    body: JSON.stringify({ messages, company_id, username }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: 'Erreur réseau' }));
    onError(err.error || `Erreur ${resp.status}`);
    return;
  }
  if (!resp.body) { onError('No response body'); return; }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let done = false;

  while (!done) {
    const { done: rd, value } = await reader.read();
    if (rd) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      let line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (!line.startsWith('data: ')) continue;
      const json = line.slice(6).trim();
      if (json === '[DONE]') { done = true; break; }
      try {
        const parsed = JSON.parse(json);
        const content = parsed.choices?.[0]?.delta?.content;
        if (content) onDelta(content);
      } catch {
        buffer = line + '\n' + buffer;
        break;
      }
    }
  }
  onDone();
}

// ─── Product tag renderer ─────────────────────────────────────────────────────
function ProductMessage({
  content, products, canAdd, onAdd,
}: {
  content: string; products: Product[]; canAdd: boolean; onAdd: (barcode: string) => void;
}) {
  const cleaned = stripQuoteDraft(content);
  const parts = cleaned.split(/(\[BARCODE:[^\]]+\])/g);
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
      {parts.map((part, i) => {
        const barcodeMatch = part.match(/^\[BARCODE:([^\]]+)\]$/);
        if (barcodeMatch) {
          const barcode = barcodeMatch[1];
          const product = products.find(p => p.barcode === barcode);
          if (product && canAdd) {
            return (
              <button key={i} onClick={() => onAdd(barcode)}
                className="inline-flex items-center gap-1.5 text-xs font-medium bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 rounded-lg px-2.5 py-1.5 hover:bg-emerald-200 dark:hover:bg-emerald-800 transition-colors border border-emerald-200 dark:border-emerald-700 my-1">
                <ShoppingCart className="h-3.5 w-3.5" />
                Ajouter au devis
              </button>
            );
          }
          return <span key={i} className="text-xs text-muted-foreground font-mono">({barcode})</span>;
        }
        return <ReactMarkdown key={i}>{part}</ReactMarkdown>;
      })}
    </div>
  );
}

// ─── Quote creation from draft ────────────────────────────────────────────────
async function createQuoteFromDraft(
  draft: ReturnType<typeof extractQuoteDraft> & {},
  products: Product[],
  currentUser: { username?: string; custom_seller_name?: string } | null
): Promise<Quote> {
  const items: QuoteItem[] = (draft.items || []).flatMap(item => {
    const product = products.find(p => p.barcode === item.barcode);
    if (!product) return [];
    const unitPrice = item.priceType === 'reseller' ? (product.reseller_price || product.price) : product.price;
    const qty = Math.max(1, item.quantity || 1);
    return [{
      id: crypto.randomUUID(),
      product,
      priceType: item.priceType || 'normal',
      marginPercentage: 0,
      finalPrice: unitPrice,
      addedAt: new Date(),
      unitPrice,
      quantity: qty,
      subtotal: unitPrice * qty,
      discount: 0,
    }] as QuoteItem[];
  });

  const totalAmount = items.reduce((sum, item) => sum + item.subtotal, 0);
  const quoteId = crypto.randomUUID();
  const year = new Date().getFullYear();
  const seq = String(Date.now()).slice(-5);
  const quoteNumber = `DEV-IA-${year}-${seq}`;

  // Build notes: include missing products if any
  let notes = draft.notes || '';
  if (draft.missing_products && draft.missing_products.length > 0) {
    const missingStr = draft.missing_products.join(', ');
    const missingNote = `⚠️ Produits non trouvés dans le catalogue : ${missingStr}.`;
    notes = notes ? `${notes}\n${missingNote}` : missingNote;
  }

  const sellerName = currentUser?.custom_seller_name || currentUser?.username || 'IA';
  const customer: CustomerInfo = { ...draft.customer, salesPerson: sellerName };

  const quote: Quote = {
    id: quoteId,
    quoteNumber,
    createdAt: new Date(),
    updatedAt: new Date(),
    status: 'draft',
    customer,
    items,
    totalAmount,
    notes: notes || undefined,
  };

  await SupabaseQuotesService.saveQuote(quote);
  return quote;
}

// ─── Main Widget ──────────────────────────────────────────────────────────────
export function AIChatWidget({ embedded = false, onClose }: { embedded?: boolean; onClose?: () => void } = {}) {
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  useEscapeKey(() => embedded ? onClose?.() : setIsOpen(false), embedded || isOpen);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isCreatingQuote, setIsCreatingQuote] = useState(false);
  const [createdQuote, setCreatedQuote] = useState<CreatedQuote | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { state } = useAppContext();
  const { addToCart } = useQuoteCart();
  const { canCreateQuote, companyId, currentUser } = useAuth();

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 100);
  }, [isOpen]);

  const handleAddToQuote = (barcode: string) => {
    const product = state.products.find(p => p.barcode === barcode);
    if (product) addToCart(product, 'normal', 0);
  };

  const resetChat = () => {
    setMessages([]);
    setCreatedQuote(null);
  };

  const send = async () => {
    if (!input.trim() || isLoading) return;
    const userMsg: Msg = { role: 'user', content: input.trim() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setIsLoading(true);

    let assistantSoFar = '';
    const upsert = (chunk: string) => {
      assistantSoFar += chunk;
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last?.role === 'assistant') {
          return prev.map((m, i) => i === prev.length - 1 ? { ...m, content: assistantSoFar } : m);
        }
        return [...prev, { role: 'assistant', content: assistantSoFar }];
      });
    };

    const done = async () => {
      setIsLoading(false);
      // Detect quote draft in completed response
      const draft = extractQuoteDraft(assistantSoFar);
      if (draft) {
        setIsCreatingQuote(true);
        try {
          const quote = await createQuoteFromDraft(draft, state.products, currentUser);
          setCreatedQuote({ id: quote.id, quoteNumber: quote.quoteNumber });
        } catch (e) {
          console.error('Failed to create quote from draft:', e);
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: '❌ Erreur lors de la création du devis. Veuillez réessayer.',
          }]);
        } finally {
          setIsCreatingQuote(false);
        }
      }
    };

    try {
      await streamChat({
        messages: newMessages,
        company_id: companyId,
        username: currentUser?.username,
        onDelta: upsert,
        onDone: done,
        onError: (err) => {
          setMessages(prev => [...prev, { role: 'assistant', content: `❌ ${err}` }]);
          setIsLoading(false);
        },
      });
    } catch {
      setIsLoading(false);
    }
  };

  const showPanel = embedded || isOpen;

  return (
    <>
      {/* Floating button — only when not embedded */}
      {!embedded && !isOpen && (
        <div className="fixed bottom-6 right-6 z-40">
          <button onClick={() => setIsOpen(true)}
            className="relative flex items-center justify-center w-12 h-12 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white rounded-full shadow-lg hover:shadow-xl transition-all duration-200 transform hover:scale-105"
            title="Assistant IA">
            <Bot className="h-6 w-6" />
          </button>
        </div>
      )}

      {/* Chat panel */}
      {showPanel && (
        <div className={embedded
          ? "h-full flex flex-col bg-background"
          : "fixed bottom-0 left-0 right-0 sm:bottom-6 sm:right-6 sm:left-auto z-50 w-full sm:w-[420px] max-h-[85vh] sm:max-h-[600px] bg-background border border-border sm:rounded-2xl rounded-t-2xl shadow-2xl flex flex-col overflow-hidden"}>
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-primary text-primary-foreground shrink-0">
            <div className="flex items-center gap-2">
              <Bot className="h-5 w-5" />
              <div>
                <span className="font-semibold text-sm">Assistant IA</span>
                <span className="text-[10px] opacity-70 ml-2">Produits & Devis</span>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {messages.length > 0 && (
                <button onClick={resetChat} className="hover:bg-primary/80 rounded p-1" title="Nouvelle conversation">
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
              )}
              <button onClick={() => embedded ? onClose?.() : setIsOpen(false)} className="hover:bg-primary/80 rounded p-1">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Created quote banner */}
          {createdQuote && (
            <div className="shrink-0 px-3 py-2 bg-emerald-500/10 border-b border-emerald-500/20 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-emerald-400 text-xs font-medium">
                <FileText className="h-3.5 w-3.5" />
                <span>Devis {createdQuote.quoteNumber} créé</span>
              </div>
              <button
                onClick={() => { navigate(`/quote-cart/${createdQuote.id}`); setIsOpen(false); }}
                className="flex items-center gap-1 text-xs bg-emerald-500 hover:bg-emerald-600 text-white px-2.5 py-1 rounded-lg transition-colors font-medium">
                <ExternalLink className="h-3 w-3" />
                Voir le devis
              </button>
            </div>
          )}

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-[320px]">
            {messages.length === 0 && (
              <div className="text-center text-muted-foreground text-sm mt-6 px-4 space-y-3">
                <Bot className="h-10 w-10 mx-auto opacity-30" />
                <div>
                  <p className="font-medium text-foreground">Que puis-je faire pour vous ?</p>
                </div>
                <div className="text-left space-y-1.5">
                  {[
                    '🔍 Trouver un produit : « machine à café 6 tasses »',
                    '📋 Créer un devis : « devis pour 2 frigos Samsung et 3 TV »',
                  ].map((tip, i) => (
                    <button key={i} onClick={() => setInput(tip.split(':')[1].trim().replace(/«|»/g, '').trim())}
                      className="w-full text-left text-xs bg-secondary hover:bg-accent rounded-lg px-3 py-2 transition-colors text-foreground">
                      {tip}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[92%] rounded-xl px-3 py-2 text-sm ${
                  msg.role === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-foreground'
                }`}>
                  {msg.role === 'assistant' ? (
                    <ProductMessage
                      content={msg.content}
                      products={state.products}
                      canAdd={canCreateQuote()}
                      onAdd={handleAddToQuote}
                    />
                  ) : msg.content}
                </div>
              </div>
            ))}

            {(isLoading && messages[messages.length - 1]?.role !== 'assistant') && (
              <div className="flex justify-start">
                <div className="bg-muted rounded-xl px-3 py-2">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                </div>
              </div>
            )}

            {isCreatingQuote && (
              <div className="flex justify-start">
                <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-3 py-2 flex items-center gap-2 text-xs text-emerald-400">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Création du devis en cours…
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="border-t border-border p-3 shrink-0">
            <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex gap-2">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Produits, devis client…"
                className="flex-1 text-sm rounded-lg border border-border bg-background px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary text-foreground"
                disabled={isLoading || isCreatingQuote}
              />
              <button type="submit" disabled={isLoading || isCreatingQuote || !input.trim()}
                className="bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground rounded-lg p-2 transition-colors">
                <Send className="h-4 w-4" />
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

