import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ownedQuotesFilter, quoteOwnerOf } from '../utils/quoteOwnership';
import { useNavigate } from 'react-router-dom';
import { Search, Plus, FileText, Receipt, Users, CornerDownLeft, Package, Loader2, ArrowRight, User } from 'lucide-react';
import { useAppContext } from '../context/AppContext';
import { useAuth } from '../hooks/useAuth';
import { useAccess } from '../hooks/useAccess';
import { useQuoteCart } from '../hooks/useQuoteCart';
import { useProductOverrides } from '../hooks/useProductOverrides';
import { useToast } from '../context/ToastContext';
import { getCompanyContext } from '../utils/supabaseCompanyFilter';
import { resolveProductImageUrl } from '../utils/productImages';
import { searchProducts, searchPages, ilikePattern, documentNumberPattern, accentLoosePattern, nameMatches, normalize } from '../utils/commandSearch';
import type { NavModule } from '../lib/navigation';
import { onOpenSearch } from '../utils/searchEvents';
import { formatMoney } from '../utils/format';
import { DOC_LABEL, docPath, looseDb, type DocType } from '../utils/homeData';
import type { Product } from '../types';

interface DocHit { id: string; number: string; type: DocType; client: string; total: number; }
interface ClientHit { id: string; name: string; detail: string; }

/** Pages always reachable but not in the side menu. */
const EXTRA_PAGES = (catalogue: boolean): NavModule => ({
  id: 'general', label: 'Général', icon: Search,
  items: [
    { to: '/', label: 'Accueil' },
    ...(catalogue ? [{ to: '/search', label: 'Recherche de produits' }, { to: '/photos/finder', label: 'Recherche d’images produit' }] : []),
  ],
} as NavModule);
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
  const { canAccessBrand, canAccessStockLocation, getDisplayPrice, getPriceDisplayType, currentUser } = useAuth();
  const { access, modules } = useAccess();
  const { addToCart } = useQuoteCart();
  const { getAllNames } = useProductOverrides();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [docs, setDocs] = useState<DocHit[]>([]);
  const [clients, setClients] = useState<ClientHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
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
    setClients([]);
    lastFocus.current?.focus?.();
  }, []);

  useEffect(() => onOpenSearch(show), [show]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        // Already open: just go back to the field (the focus to restore stays the original one).
        if (open) inputRef.current?.focus(); else show();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [show, open]);
  useEffect(() => { if (open) requestAnimationFrame(() => inputRef.current?.focus()); }, [open]);

  const brandAllowed = useCallback((p: Product) => getAllNames('brand', p.brand || '').some(name => canAccessBrand(name)), [getAllNames, canAccessBrand]);
  // Renamed brands and the supplier are searchable too, as on the Recherche page.
  const extraText = useCallback((p: Product) => `${getAllNames('brand', p.brand || '').join(' ')} ${p.provider || ''}`, [getAllNames]);
  const products = useMemo(() => (access.catalogue ? searchProducts(state.products, query, { limit: 6, allowed: brandAllowed, extraText }) : []), [access.catalogue, state.products, query, brandAllowed, extraText]);
  const pages = useMemo(() => searchPages([EXTRA_PAGES(access.catalogue), ...modules], query), [modules, query, access.catalogue]);

  // Documents (by number, client name or phone) and clients, in the user's scope.
  useEffect(() => {
    const q = query.trim();
    const wantDocs = access.quotes || access.billing;
    const wantClients = access.catalogue;
    if (!open || q.length < 2 || !(wantDocs || wantClients)) { setDocs([]); setClients([]); setLoading(false); setFailed(false); return; }
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(async () => {
      const { companyId, bypassFilter } = getCompanyContext();
      const base = (limit: number) => {
        let b = looseDb().from('quotes').select('id, quote_number, document_type, customer_info, total_amount');
        if (!bypassFilter && companyId) b = b.eq('company_id', companyId);
        if (!access.billing) {
          b = b.or('document_type.eq.quote,document_type.is.null');
          if (access.ownQuotesOnly) {
            // Their quotes only: created by them or naming them as seller.
            const owner = quoteOwnerOf(currentUser);
            b = owner ? b.or(ownedQuotesFilter(owner)) : b.eq('id', '00000000-0000-0000-0000-000000000000');
          }
        } else if (!access.quotes) {
          b = b.not('document_type', 'is', null).neq('document_type', 'quote');
        }
        return b.order('created_at', { ascending: false }).limit(limit);
      };
      const nameWords = normalize(q).split(/[\s,;]+/).filter(w => w.length >= 2).slice(0, 4);
      const digits = q.replace(/\D/g, '');
      const numberPattern = documentNumberPattern(q);
      type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- loose rows of two tables
      const requests: Promise<{ kind: 'doc' | 'client'; data: Row[] | null; error: unknown }>[] = [];
      const run = (kind: 'doc' | 'client', request: PromiseLike<{ data: Row[] | null; error: unknown }>) =>
        requests.push(Promise.resolve(request).then(r => ({ kind, data: r.data, error: r.error })));
      if (wantDocs) {
        if (numberPattern) run('doc', base(5).ilike('quote_number', numberPattern));
        if (nameWords.length) {
          // Each word on its own, accents loosened; the exact check follows below.
          let byName = base(25);
          for (const w of nameWords) byName = byName.ilike('customer_info->>fullName', accentLoosePattern(w));
          run('doc', byName);
        }
        if (digits.length >= 6) run('doc', base(5).ilike('customer_info->>phoneNumber', `%${digits.split('').join('%')}%`));
      }
      if (wantClients) {
        const pattern = ilikePattern(q);
        const first = nameWords[0] ? accentLoosePattern(nameWords[0]) : pattern;
        let c = looseDb().from('clients').select('id, full_name, phone_number, city, client_code, ice')
          .or([`full_name.ilike.${first}`, `phone_number.ilike.${digits.length >= 6 ? `%${digits.split('').join('%')}%` : pattern}`, `client_code.ilike.${pattern}`, `ice.ilike.${pattern}`, `city.ilike.${pattern}`].join(','));
        if (!bypassFilter && companyId) c = c.eq('company_id', companyId);
        run('client', c.order('full_name').limit(25));
      }
      const results = await Promise.all(requests);
      if (cancelled) return;
      const seen = new Set<string>();
      const docHits: DocHit[] = [];
      const clientHits: ClientHit[] = [];
      const phoneOf = (v: unknown) => String(v || '').replace(/\D/g, '');
      for (const r of results) {
        for (const row of r.data || []) {
          if (r.kind === 'doc') {
            if (seen.has(row.id)) continue;
            const client = row.customer_info?.fullName || '';
            const byNumber = numberPattern && new RegExp(numberPattern.slice(1, -1).split('%').join('.*'), 'i').test(row.quote_number || '');
            const byPhone = digits.length >= 6 && phoneOf(row.customer_info?.phoneNumber).includes(digits);
            if (!byNumber && !byPhone && !nameMatches(client, q)) continue;
            seen.add(row.id);
            docHits.push({ id: row.id, number: row.quote_number, type: (row.document_type || 'quote') as DocType, client, total: Number(row.total_amount) || 0 });
          } else {
            const text = `${row.full_name || ''} ${row.city || ''} ${row.client_code || ''} ${row.ice || ''}`;
            const byPhone = digits.length >= 6 && phoneOf(row.phone_number).includes(digits);
            if (!byPhone && !nameMatches(`${text} ${row.phone_number || ''}`, q)) continue;
            clientHits.push({ id: row.id, name: row.full_name || '', detail: [row.client_code, row.phone_number, row.city].filter(Boolean).join(' · ') });
          }
        }
      }
      setDocs(docHits.slice(0, 5));
      setClients(clientHits.slice(0, 4));
      setFailed(results.some(r => r.error));
      setLoading(false);
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [open, query, access.quotes, access.billing, access.catalogue, access.ownQuotesOnly, currentUser]);

  const go = useCallback((to: string) => { close(); navigate(to); }, [close, navigate]);

  const addProduct = useCallback((p: Product) => {
    const saved = Number(localStorage.getItem('inventory_margin_percentage'));
    // Same price as the Produits page: resellers add at the reseller price.
    addToCart(p, getPriceDisplayType() === 'reseller' ? 'reseller' : 'normal', Number.isFinite(saved) && saved > 0 ? saved : 20, 1);
    showToast({ type: 'success', message: `${p.name} ajouté au devis` });
  }, [addToCart, showToast, getPriceDisplayType]);

  const sections = useMemo(() => {
    const out: { title: string; options: Option[] }[] = [];
    const pagesSection = pages.length ? {
      title: 'Pages',
      options: pages.map(pg => ({
        key: `g:${pg.to}`,
        run: () => go(pg.to),
        render: () => (<><span className="min-w-0 flex-1 truncate text-foreground">{pg.label}</span><span className="shrink-0 text-xs text-muted-foreground">{pg.module}</span></>),
      })),
    } : null;
    // Typed a page's short name ("bl", "tva"): pages first, then the rest.
    const pagesFirst = pages.some(pg => pg.strong);
    if (pagesSection && pagesFirst) out.push(pagesSection);
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
    if (clients.length) {
      out.push({
        title: 'Clients',
        options: clients.map(c => ({
          key: `c:${c.id}`,
          run: () => go(`/clients?q=${encodeURIComponent(c.name)}`),
          render: () => (
            <>
              <User className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate font-medium text-foreground">{c.name}</span>
              <span className="shrink-0 truncate text-xs text-muted-foreground">{c.detail}</span>
            </>
          ),
        })),
      });
    }
    if (pagesSection && !pagesFirst) out.push(pagesSection);
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
    } else if (access.catalogue) {
      out.push({
        title: '',
        options: [{
          key: 'all',
          run: () => go(`/search?q=${encodeURIComponent(query.trim())}`),
          render: () => (<><ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /><span className="flex-1 text-foreground">Voir tous les produits pour « {query.trim()} »</span></>),
        }],
      });
    }
    return out;
  }, [products, docs, clients, pages, query, access, canAccessStockLocation, getDisplayPrice, go, addProduct]);

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
  const hasResults = products.length + docs.length + clients.length + pages.length > 0;
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
            aria-label="Chercher un produit, un document, un client ou une page"
            placeholder="Produit, référence, document, client, page…"
            className="h-14 min-w-0 flex-1 bg-transparent text-[15px] text-foreground outline-none placeholder:text-muted-foreground focus-visible:outline-none"
          />
          <button type="button" onClick={close} className="shrink-0 rounded-md border border-border bg-secondary px-2 py-1 text-xs font-semibold text-muted-foreground hover:text-foreground">Échap</button>
        </div>
        <div ref={listRef} id="command-results" role="listbox" aria-label="Résultats" className="min-h-0 flex-1 overflow-y-auto p-2 text-sm">
          {sections.map(section => (
            <div key={section.title} role="group" aria-label={section.title}>
              {section.title && <p className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{section.title}</p>}
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
          {searching && loading && (
            <p className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground" role="status"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />Recherche des documents et clients…</p>
          )}
          {searching && !loading && failed && (
            <p className="px-3 py-2 text-xs text-amber-700 dark:text-amber-300" role="status">Une partie de la recherche n’a pas répondu. Réessayez dans un instant.</p>
          )}
          {searching && !loading && !hasResults && (
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
