import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Plus, FileText, Receipt, Users, CornerDownLeft, Package } from 'lucide-react';
import { useAppContext } from '../context/AppContext';
import { useAuth } from '../hooks/useAuth';
import { useAccess } from '../hooks/useAccess';
import { useQuoteCart } from '../hooks/useQuoteCart';
import { useProductOverrides } from '../hooks/useProductOverrides';
import { useToast } from '../context/ToastContext';
import { getCompanyContext } from '../utils/supabaseCompanyFilter';
import { resolveProductImageUrl } from '../utils/productImages';
import { searchProducts, searchPages, ilikePattern } from '../utils/commandSearch';
import { onOpenSearch } from '../utils/searchEvents';
import { formatMoney } from '../utils/format';
import { DOC_LABEL, docPath, looseDb, type DocType } from '../utils/homeData';
import type { Product } from '../types';

interface DocHit { id: string; number: string; type: DocType; client: string; total: number; }
interface Option { key: string; run: () => void; addToQuote?: () => void; render: (active: boolean) => ReactNode; }

const DOC_TONE: Record<DocType, string> = {
  quote: 'bg-primary/10 text-primary', invoice: 'bg-violet-500/10 text-violet-700 dark:text-violet-300', bl: 'bg-teal-500/10 text-teal-700 dark:text-teal-300',
  proforma: 'bg-sky-500/10 text-sky-700 dark:text-sky-300', avoir: 'bg-rose-500/10 text-rose-700 dark:text-rose-300', bon_commande: 'bg-amber-500/10 text-amber-800 dark:text-amber-300',
};

/**
 * Global search (Ctrl K): products, documents and pages the user may open.
 * Products respect the user's brand and stock-location rights, documents the
 * same scope as the lists (company, own quotes for sales staff).
 */
export function CommandPalette() {
  const navigate = useNavigate();
  const { state } = useAppContext();
  const { canAccessBrand, canAccessStockLocation, getDisplayPrice, currentUser } = useAuth();
  const { access, modules } = useAccess();
  const { addToCart } = useQuoteCart();
  const { getAllNames } = useProductOverrides();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [docs, setDocs] = useState<DocHit[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const lastFocus = useRef<HTMLElement | null>(null);

  const show = useCallback(() => {
    lastFocus.current = document.activeElement as HTMLElement | null;
    setOpen(true);
  }, []);
  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setDocs([]);
    lastFocus.current?.focus?.();
  }, []);

  useEffect(() => onOpenSearch(show), [show]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); show(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [show]);
  useEffect(() => { if (open) requestAnimationFrame(() => inputRef.current?.focus()); }, [open]);

  const brandAllowed = useCallback((p: Product) => getAllNames('brand', p.brand || '').some(name => canAccessBrand(name)), [getAllNames, canAccessBrand]);
  const products = useMemo(() => (access.catalogue ? searchProducts(state.products, query, 6, brandAllowed) : []), [access.catalogue, state.products, query, brandAllowed]);
  const pages = useMemo(() => searchPages(modules, query), [modules, query]);

  // Documents: by number or client name, in the user's scope.
  useEffect(() => {
    const q = query.trim();
    if (!open || q.length < 2 || !(access.quotes || access.billing)) { setDocs([]); return; }
    let cancelled = false;
    const timer = setTimeout(async () => {
      const { companyId, bypassFilter } = getCompanyContext();
      const base = () => {
        let b = looseDb().from('quotes').select('id, quote_number, document_type, customer_info, total_amount');
        if (!bypassFilter && companyId) b = b.eq('company_id', companyId);
        if (!access.billing) {
          b = b.or('document_type.eq.quote,document_type.is.null');
          if (access.ownQuotesOnly && currentUser?.username) b = b.eq('created_by', currentUser.username);
        } else if (!access.quotes) {
          b = b.not('document_type', 'is', null).neq('document_type', 'quote');
        }
        return b.order('created_at', { ascending: false }).limit(5);
      };
      const pattern = ilikePattern(q);
      const [byNumber, byClient] = await Promise.all([
        base().ilike('quote_number', pattern),
        base().ilike('customer_info->>fullName', pattern),
      ]);
      if (cancelled) return;
      const seen = new Set<string>();
      const hits: DocHit[] = [];
      for (const r of [...(byNumber.data || []), ...(byClient.data || [])]) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        hits.push({ id: r.id, number: r.quote_number, type: (r.document_type || 'quote') as DocType, client: r.customer_info?.fullName || '', total: Number(r.total_amount) || 0 });
      }
      setDocs(hits.slice(0, 5));
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [open, query, access.quotes, access.billing, access.ownQuotesOnly, currentUser?.username]);

  const go = useCallback((to: string) => { close(); navigate(to); }, [close, navigate]);

  const addProduct = useCallback((p: Product) => {
    const saved = Number(localStorage.getItem('inventory_margin_percentage'));
    addToCart(p, 'normal', Number.isFinite(saved) && saved > 0 ? saved : 20, 1);
    showToast({ type: 'success', message: `${p.name} ajouté au devis` });
  }, [addToCart, showToast]);

  const sections = useMemo(() => {
    const out: { title: string; options: Option[] }[] = [];
    if (products.length) {
      out.push({
        title: 'Produits',
        options: products.map(p => {
          const stock = Object.entries(p.stock_levels || {}).filter(([loc]) => canAccessStockLocation(loc)).reduce((s, [, v]) => s + (Number(v) || 0), 0);
          const img = resolveProductImageUrl(p.image);
          return {
            key: `p:${p.barcode}`,
            run: () => go(`/product/${encodeURIComponent(p.barcode)}`),
            addToQuote: access.quotes ? () => addProduct(p) : undefined,
            render: (isActive: boolean) => (
              <>
                <span className="flex h-11 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-white">
                  {img ? <img src={img} alt="" className="h-full w-full object-contain" loading="lazy" /> : <Package className="h-4 w-4 text-muted-foreground" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-foreground">{p.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{[p.brand, p.barcode].filter(Boolean).join(' · ')}</span>
                </span>
                <span className="hidden shrink-0 font-semibold tabular-nums text-foreground sm:block">{formatMoney(getDisplayPrice(p))}</span>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${stock > 0 ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-secondary text-muted-foreground'}`}>{stock > 0 ? `${stock} en stock` : 'Sur commande'}</span>
                {access.quotes && (
                  <button type="button" tabIndex={-1} onClick={e => { e.stopPropagation(); addProduct(p); }}
                    className={`hidden shrink-0 items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs font-semibold text-foreground hover:bg-secondary sm:flex ${isActive ? '' : 'opacity-0 group-hover:opacity-100'}`}>
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />Devis
                  </button>
                )}
              </>
            ),
          };
        }),
      });
    }
    if (docs.length) {
      out.push({
        title: 'Documents',
        options: docs.map(d => ({
          key: `d:${d.id}`,
          run: () => go(docPath(d)),
          render: () => (
            <>
              <span className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-bold ${DOC_TONE[d.type]}`}>{DOC_LABEL[d.type]}</span>
              <span className="shrink-0 font-medium tabular-nums text-foreground">{d.number}</span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{d.client}</span>
              <span className="shrink-0 font-semibold tabular-nums text-foreground">{formatMoney(d.total)}</span>
            </>
          ),
        })),
      });
    }
    if (pages.length) {
      out.push({
        title: 'Pages',
        options: pages.map(pg => ({
          key: `g:${pg.to}`,
          run: () => go(pg.to),
          render: () => (<><span className="min-w-0 flex-1 truncate text-foreground">{pg.label}</span><span className="shrink-0 text-xs text-muted-foreground">{pg.module}</span></>),
        })),
      });
    }
    if (!query.trim()) {
      const actions: Option[] = [];
      const action = (key: string, label: string, to: string, Icon: typeof Plus) => actions.push({
        key, run: () => go(to),
        render: () => (<><Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /><span className="flex-1 text-foreground">{label}</span></>),
      });
      if (access.quotes) action('a:quote', 'Nouveau devis', '/quote-cart', Plus);
      if (access.billing) action('a:invoices', 'Factures', '/compta/invoices', Receipt);
      if (access.quotes) action('a:quotes', 'Historique des devis', '/quotes-history', FileText);
      if (access.catalogue) action('a:clients', 'Clients', '/clients', Users);
      if (actions.length) out.push({ title: 'Raccourcis', options: actions });
    }
    return out;
  }, [products, docs, pages, query, access, canAccessStockLocation, getDisplayPrice, go, addProduct]);

  const options = useMemo(() => sections.flatMap(s => s.options), [sections]);
  useEffect(() => { setActive(0); }, [query]);
  useEffect(() => { if (active >= options.length) setActive(Math.max(0, options.length - 1)); }, [options.length, active]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(i + 1, options.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(i - 1, 0)); }
    if (e.key === 'Enter' && options[active]) {
      e.preventDefault();
      const option = options[active];
      if ((e.ctrlKey || e.metaKey) && option.addToQuote) option.addToQuote();
      else option.run();
    }
  };

  const searching = query.trim().length > 0;
  let index = -1;
  return (
    <div className="fixed inset-0 z-[150] flex items-start justify-center bg-slate-950/40 px-3 pt-[8vh] backdrop-blur-[2px] sm:pt-[12vh]" onMouseDown={e => { if (e.target === e.currentTarget) close(); }}>
      <div role="dialog" aria-modal="true" aria-label="Recherche" className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl" onKeyDown={onKeyDown}>
        <div className="flex items-center gap-3 border-b border-border px-4">
          <Search className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            role="combobox"
            aria-expanded="true"
            aria-controls="command-results"
            aria-activedescendant={options[active] ? `command-option-${active}` : undefined}
            aria-label="Chercher un produit, un document ou une page"
            placeholder="Produit, document, page…"
            className="h-14 min-w-0 flex-1 bg-transparent text-[15px] text-foreground outline-none placeholder:text-muted-foreground focus-visible:outline-none"
          />
          <button type="button" onClick={close} className="shrink-0 rounded-md border border-border bg-secondary px-2 py-1 text-xs font-semibold text-muted-foreground hover:text-foreground">Échap</button>
        </div>
        <div ref={listRef} id="command-results" role="listbox" aria-label="Résultats" className="min-h-0 flex-1 overflow-y-auto p-2 text-sm">
          {sections.map(section => (
            <div key={section.title} role="group" aria-label={section.title}>
              <p className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{section.title}</p>
              {section.options.map(option => {
                index += 1;
                const i = index;
                return (
                  <div
                    key={option.key}
                    id={`command-option-${i}`}
                    data-index={i}
                    role="option"
                    aria-selected={i === active}
                    onMouseMove={() => setActive(i)}
                    onClick={option.run}
                    className={`group flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-3 py-2 ${i === active ? 'bg-primary/10' : ''}`}
                  >
                    {option.render(i === active)}
                  </div>
                );
              })}
            </div>
          ))}
          {searching && options.length === 0 && (
            <p className="px-3 py-8 text-center text-muted-foreground">Aucun résultat pour « {query.trim()} »</p>
          )}
        </div>
        <div className="hidden items-center gap-4 border-t border-border bg-secondary/50 px-4 py-2 text-xs text-muted-foreground sm:flex">
          <span><kbd className="font-semibold">↑ ↓</kbd> naviguer</span>
          <span className="flex items-center gap-1"><CornerDownLeft className="h-3 w-3" aria-hidden="true" /> ouvrir</span>
          {access.quotes && <span><kbd className="font-semibold">Ctrl Entrée</kbd> ajouter au devis</span>}
        </div>
      </div>
    </div>
  );
}
