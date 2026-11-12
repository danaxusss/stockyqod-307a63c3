// @ts-nocheck
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  Save, FileDown, Loader, Plus, Trash2, Minus,
  ChevronDown, ChevronUp, ChevronRight, Check, AlertCircle,
  Search, Package, X, Zap,
} from 'lucide-react';
import { Quote, QuoteItem, CustomerInfo, Product, Provider, StockLocation } from '../../types';
import { SupabaseDocumentsService } from '../../utils/supabaseDocuments';
import { PdfExportService } from '../../utils/pdfExport';
import { CompanySettingsService } from '../../utils/companySettings';
import { StockLocationsService } from '../../utils/supabaseStockLocations';
import { SupabaseClientsService, Client } from '../../utils/supabaseClients';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';
import { useAppContext } from '../../context/AppContext';

// One row in the dispatch table
interface DispatchTarget {
  locationId: string;
  locationName: string;
  locationAbbrev: string;
  subCode: string;
  subName: string;
  providerName: string;
  stock: number;
}

function resolveStock(stockLevels: Record<string, number> | undefined, loc: StockLocation): number {
  if (!stockLevels) return 0;
  // 1. Abbreviation key (new format: "CM1")
  if (loc.abbreviation && stockLevels[loc.abbreviation] !== undefined) return stockLevels[loc.abbreviation] || 0;
  // 2. Full name key (e.g. "Cuisimat 1")
  if (stockLevels[loc.name] !== undefined) return stockLevels[loc.name] || 0;
  // 3. Legacy key from old Excel import: lowercase + underscores (e.g. "cuisimat_1")
  const legacyKey = loc.name.toLowerCase().replace(/\s+/g, '_');
  return stockLevels[legacyKey] || 0;
}

function buildDispatchTargets(
  locations: StockLocation[],
  providers: Provider[],
  product: Product | null
): DispatchTarget[] {
  const targets: DispatchTarget[] = [];
  for (const loc of locations) {
    const provName = providers.find(p => p.id === loc.provider_id)?.name || 'Autre';
    const subs = loc.sub_locations || [];
    if (subs.length === 0) {
      targets.push({
        locationId: loc.id,
        locationName: loc.name,
        locationAbbrev: loc.abbreviation || loc.name,
        subCode: '',
        subName: '',
        providerName: provName,
        stock: resolveStock(product?.stock_levels, loc),
      });
    } else {
      for (const sub of subs) {
        targets.push({
          locationId: loc.id,
          locationName: loc.name,
          locationAbbrev: loc.abbreviation || loc.name,
          subCode: sub.code,
          subName: sub.name,
          providerName: provName,
          stock: resolveStock(product?.stock_levels, loc),
        });
      }
    }
  }
  return targets;
}

function getDispatchQty(item: QuoteItem, locId: string, subCode: string): number {
  return (item.dispatch || []).find(
    d => d.stock_location_id === locId && d.sub_location_code === subCode
  )?.quantity ?? 0;
}

export default function BonCommandeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isFacturation, isSuperAdmin, companyId } = useAuth();
  const { showToast } = useToast();
  const { state } = useAppContext();

  const [bc, setBc] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Draft state
  const [draftItems, setDraftItems] = useState<QuoteItem[]>([]);
  const [draftCustomer, setDraftCustomer] = useState({ fullName: '', phoneNumber: '' });
  const [draftNotes, setDraftNotes] = useState('');
  const [draftStatus, setDraftStatus] = useState<'draft' | 'final'>('draft');

  // Stock data
  const [stockLocations, setStockLocations] = useState<StockLocation[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);

  // Product search
  const [productSearch, setProductSearch] = useState('');
  const [productResults, setProductResults] = useState<Product[]>([]);

  // Custom product form
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customForm, setCustomForm] = useState({ barcode: '', name: '', brand: '', unitPrice: '', provider_id: '', provider_name: '' });
  const [showNewProviderInput, setShowNewProviderInput] = useState(false);
  const [newProviderName, setNewProviderName] = useState('');

  // Client autocomplete
  const [clientSuggestions, setClientSuggestions] = useState<Client[]>([]);
  const [showClientSugg, setShowClientSugg] = useState(false);
  const clientTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Dispatch UI
  const [expandedDispatch, setExpandedDispatch] = useState<Set<string>>(new Set());
  const [dispatchShowAll, setDispatchShowAll] = useState<Set<string>>(new Set());
  const [customLocInputs, setCustomLocInputs] = useState<Record<string, { abbrev: string; name: string }>>({});

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [doc, locs, provs] = await Promise.all([
        SupabaseDocumentsService.getById(id),
        StockLocationsService.getStockLocations(),
        StockLocationsService.getProviders(),
      ]);
      if (!doc) { navigate('/compta/bons-commande'); return; }
      setBc(doc);
      setDraftItems(doc.items || []);
      setDraftCustomer({
        fullName: doc.customer?.fullName || '',
        phoneNumber: doc.customer?.phoneNumber || '',
      });
      setDraftNotes(doc.notes || '');
      setDraftStatus(doc.status === 'final' ? 'final' : 'draft');
      setStockLocations(locs);
      setProviders(provs);
    } catch {
      showToast({ type: 'error', message: 'Erreur lors du chargement du BC' });
    } finally {
      setLoading(false);
    }
  }, [id, navigate, showToast]);

  useEffect(() => { load(); }, [load]);

  // Product search — local filter
  useEffect(() => {
    const q = productSearch.trim().toLowerCase();
    if (q.length < 2) { setProductResults([]); return; }
    const results = state.products
      .filter(p =>
        p.name?.toLowerCase().includes(q) ||
        p.barcode?.toLowerCase().includes(q) ||
        p.brand?.toLowerCase().includes(q)
      )
      .slice(0, 30);
    setProductResults(results);
  }, [productSearch, state.products]);

  // Client autocomplete
  const handleClientSearch = useCallback((query: string) => {
    setDraftCustomer(c => ({ ...c, fullName: query }));
    if (clientTimeoutRef.current) clearTimeout(clientTimeoutRef.current);
    if (query.trim().length < 2) { setClientSuggestions([]); setShowClientSugg(false); return; }
    clientTimeoutRef.current = setTimeout(async () => {
      try {
        const results = await SupabaseClientsService.searchClients(query);
        setClientSuggestions(results);
        setShowClientSugg(results.length > 0);
      } catch { setClientSuggestions([]); }
    }, 300);
  }, []);

  const selectClient = (client: Client) => {
    setDraftCustomer({ fullName: client.full_name, phoneNumber: client.phone_number });
    setShowClientSugg(false);
    setClientSuggestions([]);
  };

  // Add catalog product
  const addProductToBC = (product: Product) => {
    const existing = draftItems.find(i => i.product?.barcode === product.barcode);
    if (existing) {
      setDraftItems(prev => prev.map(i =>
        i.id === existing.id ? { ...i, quantity: i.quantity + 1, dispatch: [] } : i
      ));
    } else {
      const newItem: QuoteItem = {
        id: crypto.randomUUID(),
        product,
        priceType: 'normal',
        marginPercentage: 0,
        finalPrice: product.price,
        addedAt: new Date(),
        unitPrice: product.price,
        quantity: 1,
        subtotal: product.price,
        quoteName: product.name,
        quoteBrand: product.brand,
        quoteBarcode: product.barcode,
        dispatch: [],
      };
      setDraftItems(prev => [...prev, newItem]);
    }
    setProductSearch('');
    setProductResults([]);
  };

  // Add custom product
  const addCustomProduct = () => {
    if (!customForm.name.trim()) return;
    const price = parseFloat(customForm.unitPrice) || 0;
    const newItem: QuoteItem = {
      id: crypto.randomUUID(),
      product: {
        barcode: customForm.barcode || crypto.randomUUID(),
        name: customForm.name,
        brand: customForm.brand,
        techsheet: '',
        price,
        buyprice: 0,
        reseller_price: 0,
        provider: customForm.provider_name || '',
        stock_levels: {},
      },
      priceType: 'normal',
      marginPercentage: 0,
      finalPrice: price,
      addedAt: new Date(),
      unitPrice: price,
      quantity: 1,
      subtotal: price,
      quoteName: customForm.name,
      quoteBrand: customForm.brand,
      quoteBarcode: customForm.barcode,
      dispatch: [],
      provider_id: customForm.provider_id || undefined,
      provider_name: customForm.provider_name || undefined,
    };
    setDraftItems(prev => [...prev, newItem]);
    setCustomForm({ barcode: '', name: '', brand: '', unitPrice: '', provider_id: '', provider_name: '' });
    setShowCustomForm(false);
  };

  const removeItem = (itemId: string) => setDraftItems(prev => prev.filter(i => i.id !== itemId));

  const updateItemQty = (itemId: string, qty: number) => {
    setDraftItems(prev => prev.map(i =>
      i.id === itemId ? { ...i, quantity: Math.max(1, qty), dispatch: [] } : i
    ));
  };

  const updateDispatch = (itemId: string, locId: string, subCode: string, locName: string, qty: number, locAbbrev?: string) => {
    setDraftItems(prev => prev.map(item => {
      if (item.id !== itemId) return item;
      const key = `${locId}::${subCode}`;
      const filtered = (item.dispatch || []).filter(
        d => `${d.stock_location_id}::${d.sub_location_code}` !== key
      );
      const newDispatch = qty > 0
        ? [...filtered, { stock_location_id: locId, stock_location_name: locName, stock_location_abbrev: locAbbrev || locId, sub_location_code: subCode, quantity: qty }]
        : filtered;
      return { ...item, dispatch: newDispatch };
    }));
  };

  const totalDispatched = (item: QuoteItem) =>
    (item.dispatch || []).reduce((s, d) => s + (d.quantity || 0), 0);

  const isItemDispatched = (item: QuoteItem) =>
    (item.dispatch || []).length > 0 && totalDispatched(item) === item.quantity;

  const allDispatched = draftItems.length > 0 && draftItems.every(isItemDispatched);

  const autoAssignAll = () => {
    setDraftItems(prev => prev.map(item => {
      const tgts = buildDispatchTargets(stockLocations, providers, item.product);
      // Sort descending by stock — highest stock location is always preferred
      const byStock = [...tgts.filter(t => t.stock > 0)].sort((a, b) => b.stock - a.stock);
      if (byStock.length === 0) return item;

      // If the best single location covers the full quantity, use only that one
      if (byStock[0].stock >= item.quantity) {
        const best = byStock[0];
        return { ...item, dispatch: [{ stock_location_id: best.locationId, stock_location_name: best.locationName, stock_location_abbrev: best.locationAbbrev, sub_location_code: best.subCode, quantity: item.quantity }] };
      }

      // Otherwise greedy-fill: take as much as possible from highest-stock locations first.
      // If total stock < needed quantity, assign what's available and leave the rest
      // unassigned — the dispatch indicator will show partial and the user can fill the gap.
      let rem = item.quantity;
      const nd: NonNullable<typeof item.dispatch> = [];
      for (const t of byStock) {
        if (rem <= 0) break;
        const q = Math.min(t.stock, rem);
        rem -= q;
        nd.push({ stock_location_id: t.locationId, stock_location_name: t.locationName, stock_location_abbrev: t.locationAbbrev, sub_location_code: t.subCode, quantity: q });
      }
      return { ...item, dispatch: nd };
    }));
  };

  const handleSave = async () => {
    if (!id || !bc) return;
    setSaving(true);
    try {
      await SupabaseDocumentsService.updateDocument(id, {
        customer: {
          ...(bc.customer || {}),
          fullName: draftCustomer.fullName,
          phoneNumber: draftCustomer.phoneNumber,
        } as CustomerInfo,
        items: draftItems,
        notes: draftNotes || null,
        status: draftStatus,
      });
      showToast({ type: 'success', message: 'BC sauvegardé' });
      await load();
    } catch (e: any) {
      showToast({ type: 'error', message: e.message });
    } finally {
      setSaving(false);
    }
  };

  const handleExportPdf = async () => {
    if (!bc) return;
    setExporting(true);
    try {
      const settings = await CompanySettingsService.getSettings(bc.company_id || companyId || undefined).catch(() => null);
      const exportDoc = { ...bc, items: draftItems, customer: { ...bc.customer, fullName: draftCustomer.fullName, phoneNumber: draftCustomer.phoneNumber } };
      await PdfExportService.exportQuoteToPdf(exportDoc, settings, undefined, undefined, undefined, 'bon_commande');
    } catch (e: any) {
      showToast({ type: 'error', message: e.message });
    } finally {
      setExporting(false);
    }
  };

  const toggleInSet = (setter: React.Dispatch<React.SetStateAction<Set<string>>>, itemId: string) =>
    setter(prev => {
      const n = new Set(prev);
      if (n.has(itemId)) n.delete(itemId); else n.add(itemId);
      return n;
    });

  const createProvider = async () => {
    if (!newProviderName.trim()) return;
    try {
      const created = await StockLocationsService.upsertProvider({ name: newProviderName.trim(), is_custom: true });
      setProviders(prev => [...prev, created]);
      setCustomForm(f => ({ ...f, provider_id: created.id, provider_name: created.name }));
      setNewProviderName('');
      setShowNewProviderInput(false);
    } catch {
      showToast({ type: 'error', message: 'Erreur lors de la création du fournisseur' });
    }
  };

  if (!isFacturation && !isSuperAdmin) {
    return <div className="p-8 text-center text-muted-foreground">Accès réservé au rôle Facturation.</div>;
  }

  if (loading) return (
    <div className="flex min-h-64 items-center justify-center">
      <Loader className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  );
  if (!bc) return null;

  const formatDate = (d: Date) => new Date(d).toLocaleDateString('fr-FR');
  const panel = 'rounded-xl border border-border bg-card shadow-sm';
  const field = 'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring';
  const totalUnits = draftItems.reduce((s, i) => s + (i.quantity || 0), 0);
  const doneCount = draftItems.filter(isItemDispatched).length;
  const progress = draftItems.length > 0 ? Math.round((doneCount / draftItems.length) * 100) : 0;
  const statusTone = draftStatus === 'final'
    ? 'bg-blue-500/10 text-blue-700 ring-blue-600/20 dark:text-blue-300'
    : 'bg-secondary text-muted-foreground ring-border';

  return (
    <div className="mx-auto max-w-7xl pb-28 md:pb-0">
      {/* Title */}
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0">
          <nav aria-label="Fil d’Ariane" className="hidden items-center gap-1.5 text-sm text-muted-foreground sm:flex">
            <Link to="/compta/bons-commande" className="hover:text-foreground">Bons de commande</Link>
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="text-foreground">{bc.quoteNumber}</span>
          </nav>
          <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">Bon de commande {bc.quoteNumber}</h1>
        </div>
        <select value={draftStatus} onChange={e => setDraftStatus(e.target.value as 'draft' | 'final')} aria-label="Statut du bon de commande"
          className={`rounded-full border-0 py-1 pl-3 pr-8 text-xs font-semibold ring-1 ring-inset ${statusTone}`}>
          <option value="draft">Brouillon</option>
          <option value="final">Final</option>
        </select>
        <span className="text-sm text-muted-foreground">Créé le {formatDate(bc.createdAt)}</span>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-4">
          {/* Client and notes */}
          <section className={`${panel} p-4 sm:p-5`} aria-labelledby="bc-client-title">
            <h2 id="bc-client-title" className="mb-3 font-semibold text-foreground">Client</h2>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="relative">
                <label htmlFor="bc-client" className="mb-1 block text-xs font-medium text-foreground">Nom du client</label>
                <input
                  id="bc-client"
                  value={draftCustomer.fullName}
                  onChange={e => handleClientSearch(e.target.value)}
                  onBlur={() => setTimeout(() => setShowClientSugg(false), 150)}
                  className={field}
                  placeholder="Nom du client"
                  autoComplete="off"
                />
                {showClientSugg && clientSuggestions.length > 0 && (
                  <div className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-border bg-popover shadow-lg">
                    {clientSuggestions.map(c => (
                      <button key={c.id} type="button" onMouseDown={() => selectClient(c)}
                        className="flex w-full flex-col border-b border-border px-3 py-2 text-left text-sm text-foreground last:border-0 hover:bg-secondary">
                        <span className="font-medium">{c.full_name}</span>
                        {c.phone_number && <span className="text-xs text-muted-foreground">{c.phone_number}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <label htmlFor="bc-phone" className="mb-1 block text-xs font-medium text-foreground">Téléphone</label>
                <input
                  id="bc-phone"
                  value={draftCustomer.phoneNumber}
                  onChange={e => setDraftCustomer(c => ({ ...c, phoneNumber: e.target.value }))}
                  className={field}
                  placeholder="Téléphone"
                />
              </div>
              <div className="md:col-span-2">
                <label htmlFor="bc-notes" className="mb-1 block text-xs font-medium text-foreground">Notes</label>
                <input
                  id="bc-notes"
                  value={draftNotes}
                  onChange={e => setDraftNotes(e.target.value)}
                  className={field}
                  placeholder="Notes..."
                />
              </div>
            </div>
          </section>

          {/* Lines and collection */}
          <section className={panel} aria-labelledby="bc-lines-title">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-3 sm:px-5">
              <h2 id="bc-lines-title" className="font-semibold text-foreground">Articles</h2>
              <span className="text-sm text-muted-foreground">{draftItems.length} ligne{draftItems.length !== 1 ? 's' : ''} · {totalUnits} unité{totalUnits !== 1 ? 's' : ''}</span>
              <span className="flex-1" />
              {draftItems.length > 0 && !allDispatched && stockLocations.length > 0 && (
                <button
                  type="button"
                  onClick={autoAssignAll}
                  className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-semibold text-foreground hover:bg-secondary"
                  title="Affecter chaque article au meilleur emplacement disponible"
                >
                  <Zap className="h-4 w-4 text-amber-600" aria-hidden="true" />Auto-affecter
                </button>
              )}
            </div>

            {draftItems.length > 0 && (
              <div className={`flex items-center gap-2 border-b border-border px-4 py-2.5 text-sm sm:px-5 ${allDispatched ? 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-300' : 'bg-amber-500/10 text-amber-800 dark:text-amber-300'}`} role="status">
                {allDispatched
                  ? <><Check className="h-4 w-4 shrink-0" aria-hidden="true" /> Tous les articles sont affectés aux emplacements de collecte.</>
                  : <><AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" /> {draftItems.filter(i => !isItemDispatched(i)).length} article(s) sans affectation complète.</>
                }
              </div>
            )}

            {draftItems.length === 0 ? (
              <div className="px-5 py-10 text-center">
                <Package className="mx-auto h-10 w-10 text-muted-foreground" aria-hidden="true" />
                <p className="mt-3 font-medium text-foreground">Aucun article pour le moment</p>
                <p className="mt-1 text-sm text-muted-foreground">Cherchez un produit ci-dessous, ou ajoutez un produit hors catalogue.</p>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {draftItems.map(item => {
                  const dispatched = totalDispatched(item);
                  const isDone = isItemDispatched(item);
                  const expanded = expandedDispatch.has(item.id);
                  const showAll = dispatchShowAll.has(item.id);
                  const targets = buildDispatchTargets(stockLocations, providers, item.product);
                  const hasAnyStock = targets.some(t => t.stock > 0);
                  const stockTargets = targets.filter(t => t.stock > 0);
                  const quickTarget = !isDone ? stockTargets.find(t => t.stock >= item.quantity) : undefined;
                  const visibleTargets = (showAll || !hasAnyStock) ? targets : stockTargets;

                  // Group by provider
                  const grouped = visibleTargets.reduce<Record<string, DispatchTarget[]>>((acc, t) => {
                    (acc[t.providerName] = acc[t.providerName] || []).push(t);
                    return acc;
                  }, {});
                  const brandRef = [item.quoteBrand, item.quoteBarcode].filter(Boolean).join(' · ');

                  return (
                    <li key={item.id}>
                      {/* Item row */}
                      <div className="grid grid-cols-[minmax(0,1fr)_2.5rem] gap-x-3 gap-y-2.5 px-4 py-3 sm:px-5 md:grid-cols-[minmax(0,1fr)_7.5rem_12rem_2.5rem] md:items-center">
                        <div className="min-w-0">
                          <p className="font-medium leading-snug text-foreground">{item.quoteName || item.product?.name}</p>
                          {brandRef && <p className="truncate text-sm text-muted-foreground">{brandRef}</p>}
                          <div className="mt-1 flex flex-wrap items-center gap-1">
                            {hasAnyStock
                              ? stockTargets.slice(0, 5).map(t => (
                                  <span key={t.locationId + t.subCode} className="whitespace-nowrap rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium tabular-nums text-emerald-700 dark:text-emerald-300">
                                    {t.locationAbbrev} {t.stock}
                                  </span>
                                ))
                              : <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-800 dark:text-amber-300">hors stock</span>
                            }
                          </div>
                        </div>
                        <button type="button" onClick={() => removeItem(item.id)} aria-label={`Retirer ${item.quoteName || item.product?.name || 'l’article'}`}
                          className="flex h-10 w-10 items-center justify-center self-start rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive md:order-last md:self-center">
                          <Trash2 className="h-4 w-4" />
                        </button>
                        <div className="col-span-2 flex flex-wrap items-center gap-2 md:contents">
                          <div className="flex items-center rounded-lg border border-input">
                            <button type="button" onClick={() => updateItemQty(item.id, item.quantity - 1)} disabled={item.quantity <= 1} aria-label="Diminuer la quantité"
                              className="flex h-9 w-9 items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-40"><Minus className="h-3.5 w-3.5" /></button>
                            <input type="number" min={1} value={item.quantity}
                              onChange={e => updateItemQty(item.id, parseInt(e.target.value) || 1)}
                              aria-label="Quantité"
                              className="h-9 w-12 border-0 bg-transparent p-0 text-center text-sm font-semibold tabular-nums text-foreground [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none" />
                            <button type="button" onClick={() => updateItemQty(item.id, item.quantity + 1)} aria-label="Augmenter la quantité"
                              className="flex h-9 w-9 items-center justify-center text-muted-foreground hover:text-foreground"><Plus className="h-3.5 w-3.5" /></button>
                          </div>
                          <div className="flex items-center gap-2 md:justify-self-start">
                            {/* Dispatch badge/toggle */}
                            <button
                              type="button"
                              onClick={() => toggleInSet(setExpandedDispatch, item.id)}
                              aria-expanded={expanded}
                              className={`flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold transition-colors ${
                                isDone
                                  ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                                  : dispatched > 0
                                  ? 'bg-amber-500/10 text-amber-800 dark:text-amber-300'
                                  : 'bg-secondary text-muted-foreground'
                              }`}
                              title="Affecter les emplacements"
                            >
                              {isDone ? <Check className="h-4 w-4" /> : <Package className="h-4 w-4" />}
                              {isDone ? 'Affecté' : `Collecte ${dispatched}/${item.quantity}`}
                              {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                            </button>
                            {quickTarget && (
                              <button
                                type="button"
                                onClick={() => updateDispatch(item.id, quickTarget.locationId, quickTarget.subCode, quickTarget.locationName, item.quantity, quickTarget.locationAbbrev)}
                                className="flex h-9 items-center gap-1 whitespace-nowrap rounded-lg bg-emerald-500/15 px-3 text-sm font-semibold text-emerald-700 transition-colors hover:bg-emerald-500/25 dark:text-emerald-300"
                                title={`Affecter ${item.quantity} → ${quickTarget.locationAbbrev}`}
                              >
                                <Zap className="h-3.5 w-3.5" aria-hidden="true" />{quickTarget.locationAbbrev}
                              </button>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Dispatch panel */}
                      {expanded && (
                        <div className="border-t border-border bg-secondary/40 px-4 py-3 sm:px-5">
                          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                            <p className="text-sm font-medium text-muted-foreground">
                              Collecte — <span className={dispatched === item.quantity ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}>{dispatched}/{item.quantity}</span> unités affectées
                            </p>
                            <button
                              type="button"
                              onClick={() => toggleInSet(setDispatchShowAll, item.id)}
                              className="text-sm font-medium text-primary hover:underline"
                            >
                              {showAll ? 'Masquer emplacements vides' : 'Afficher tous les emplacements'}
                            </button>
                          </div>

                          {stockLocations.length === 0 ? (
                            <p className="text-sm text-muted-foreground">Aucun emplacement configuré. Allez dans Paramètres → Emplacements.</p>
                          ) : (
                            <>
                              {!hasAnyStock && (
                                <div className="mb-2 flex items-center gap-1.5 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
                                  <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
                                  Produit hors stock — choisissez l'emplacement de collecte manuellement.
                                </div>
                              )}
                              {Object.keys(grouped).length > 0 && (
                                <div className="space-y-3">
                                  {Object.entries(grouped).map(([provName, locs]) => (
                                    <div key={provName}>
                                      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{provName}</p>
                                      <div className="space-y-1.5">
                                        {locs.map(t => {
                                          const qty = getDispatchQty(item, t.locationId, t.subCode);
                                          return (
                                            <div key={`${t.locationId}::${t.subCode}`} className="flex items-center gap-2 text-sm">
                                              <span className={`w-12 shrink-0 rounded px-1 py-0.5 text-center text-xs font-semibold ${t.stock > 0 ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-secondary text-muted-foreground'}`}>
                                                {t.locationAbbrev}
                                              </span>
                                              <span className="flex-1 truncate text-foreground" title={t.locationName}>{t.locationName}</span>
                                              <span className={`w-16 shrink-0 text-right text-xs tabular-nums ${t.stock === 0 ? 'text-muted-foreground/60' : 'text-muted-foreground'}`}>
                                                stock {t.stock}
                                              </span>
                                              <input
                                                type="number" min={0} max={item.quantity}
                                                value={qty || ''}
                                                placeholder="0"
                                                aria-label={`Quantité à collecter à ${t.locationName}`}
                                                onChange={e => updateDispatch(item.id, t.locationId, t.subCode, t.locationName, parseInt(e.target.value) || 0, t.locationAbbrev)}
                                                className="h-8 w-16 shrink-0 rounded-md border border-input bg-background text-center text-sm tabular-nums"
                                              />
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}

                              {/* Custom / free-text location */}
                              <div className="mt-3 border-t border-border pt-3">
                                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Emplacement personnalisé</p>
                                <div className="flex items-center gap-2">
                                  <input
                                    value={customLocInputs[item.id]?.abbrev || ''}
                                    onChange={e => setCustomLocInputs(prev => ({ ...prev, [item.id]: { ...(prev[item.id] || { name: '' }), abbrev: e.target.value } }))}
                                    className="h-8 w-16 shrink-0 rounded-md border border-input bg-background text-center text-sm"
                                    placeholder="Abrév."
                                    aria-label="Abréviation de l’emplacement"
                                  />
                                  <input
                                    value={customLocInputs[item.id]?.name || ''}
                                    onChange={e => setCustomLocInputs(prev => ({ ...prev, [item.id]: { ...(prev[item.id] || { abbrev: '' }), name: e.target.value } }))}
                                    className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm"
                                    placeholder="Fournisseur..."
                                    aria-label="Nom de l’emplacement"
                                  />
                                  <input
                                    type="number" min={0} max={item.quantity}
                                    value={getDispatchQty(item, 'custom', customLocInputs[item.id]?.abbrev || '') || ''}
                                    placeholder="0"
                                    aria-label="Quantité à collecter"
                                    onChange={e => {
                                      const abbrev = customLocInputs[item.id]?.abbrev?.trim();
                                      if (!abbrev) return;
                                      updateDispatch(item.id, 'custom', abbrev, customLocInputs[item.id]?.name || abbrev, parseInt(e.target.value) || 0, abbrev);
                                    }}
                                    className="h-8 w-16 shrink-0 rounded-md border border-input bg-background text-center text-sm tabular-nums"
                                  />
                                </div>
                              </div>

                              {dispatched > 0 && dispatched !== item.quantity && (
                                <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">
                                  {dispatched < item.quantity
                                    ? `Reste ${item.quantity - dispatched} unité(s) à affecter`
                                    : `Surplus de ${dispatched - item.quantity} unité(s)`}
                                </p>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            {/* Add a product */}
            <div className="border-t border-border p-4">
              <div className="flex items-center gap-2 rounded-lg border border-dashed border-primary/40 bg-primary/5 px-3 focus-within:border-solid focus-within:border-primary">
                <Search className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <input
                  type="text"
                  value={productSearch}
                  onChange={e => setProductSearch(e.target.value)}
                  aria-label="Ajouter un produit : nom, marque ou code-barres"
                  placeholder="Ajouter un produit — nom, marque ou code-barres"
                  className="h-11 min-w-0 flex-1 border-0 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground focus:ring-0"
                />
                {productSearch && (
                  <button type="button" onClick={() => { setProductSearch(''); setProductResults([]); }} aria-label="Effacer la recherche"
                    className="text-muted-foreground hover:text-foreground">
                    <X className="h-4 w-4" />
                  </button>
                )}
                <button type="button" onClick={() => setShowCustomForm(v => !v)} aria-expanded={showCustomForm}
                  className="hidden shrink-0 items-center gap-1 text-sm font-semibold text-primary hover:underline sm:flex">
                  Produit hors catalogue {showCustomForm ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                </button>
              </div>
              <button type="button" onClick={() => setShowCustomForm(v => !v)} className="mt-2 text-sm font-semibold text-primary sm:hidden">Produit hors catalogue</button>

              {productResults.length > 0 && (
                <ul className="mt-2 max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border">
                  {productResults.map(p => {
                    const totalStock = Object.values(p.stock_levels || {}).reduce((s: number, v: any) => s + (v || 0), 0);
                    return (
                      <li key={p.barcode}>
                        <button type="button" onClick={() => addProductToBC(p)}
                          className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-secondary">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-foreground">{p.name}</p>
                            <p className="truncate text-xs text-muted-foreground">{[p.brand, p.barcode].filter(Boolean).join(' · ')}</p>
                          </div>
                          <span className={`shrink-0 text-xs ${totalStock > 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-muted-foreground'}`}>
                            {totalStock > 0 ? `${totalStock} en stock` : 'Hors stock'}
                          </span>
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground" aria-hidden="true"><Plus className="h-4 w-4" /></span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}

              {showCustomForm && (
                <div className="mt-3 space-y-3 rounded-lg border border-border bg-secondary/40 p-3">
                  <p className="text-sm font-semibold text-foreground">Produit hors catalogue</p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <label className="text-xs text-muted-foreground">Désignation *
                      <input value={customForm.name} onChange={e => setCustomForm(f => ({ ...f, name: e.target.value }))}
                        className={`${field} mt-0.5`} placeholder="Nom du produit" />
                    </label>
                    <label className="text-xs text-muted-foreground">Marque
                      <input value={customForm.brand} onChange={e => setCustomForm(f => ({ ...f, brand: e.target.value }))}
                        className={`${field} mt-0.5`} placeholder="Marque" />
                    </label>
                    <label className="text-xs text-muted-foreground">Code-barre
                      <input value={customForm.barcode} onChange={e => setCustomForm(f => ({ ...f, barcode: e.target.value }))}
                        className={`${field} mt-0.5`} placeholder="Optionnel" />
                    </label>
                    <label className="text-xs text-muted-foreground">Prix unitaire
                      <input type="number" min={0} value={customForm.unitPrice} onChange={e => setCustomForm(f => ({ ...f, unitPrice: e.target.value }))}
                        className={`${field} mt-0.5`} placeholder="0,00" />
                    </label>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Fournisseur</p>
                    {showNewProviderInput ? (
                      <div className="mt-0.5 flex gap-2">
                        <input
                          type="text"
                          value={newProviderName}
                          onChange={e => setNewProviderName(e.target.value)}
                          className={field}
                          placeholder="Nom du fournisseur"
                          aria-label="Nom du nouveau fournisseur"
                        />
                        <button type="button" onClick={createProvider} className="rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90">OK</button>
                        <button type="button" onClick={() => setShowNewProviderInput(false)} aria-label="Annuler" className="rounded-lg px-2 hover:bg-secondary">
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ) : (
                      <div className="mt-0.5 flex gap-2">
                        <select
                          value={customForm.provider_id}
                          aria-label="Fournisseur"
                          onChange={e => {
                            const sel = providers.find(p => p.id === e.target.value);
                            setCustomForm(f => ({ ...f, provider_id: e.target.value, provider_name: sel?.name || '' }));
                          }}
                          className={field}
                        >
                          <option value="">— Aucun —</option>
                          {providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                        <button type="button" onClick={() => setShowNewProviderInput(true)} className="whitespace-nowrap rounded-lg border border-input px-3 text-sm text-foreground hover:bg-secondary">
                          + Nouveau
                        </button>
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={addCustomProduct}
                    disabled={!customForm.name.trim()}
                    className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
                  >
                    <Plus className="h-4 w-4" />Ajouter au bon de commande
                  </button>
                </div>
              )}
            </div>
          </section>
        </div>

        {/* Summary and actions: stays in view while the lines scroll */}
        <aside className="space-y-4 lg:sticky lg:top-4" aria-label="Récapitulatif et actions">
          <section className={`${panel} p-5`} aria-labelledby="bc-summary-title">
            <h2 id="bc-summary-title" className="font-semibold text-foreground">Collecte</h2>
            <p className="mt-1 text-2xl font-bold tabular-nums tracking-tight text-foreground">{doneCount} / {draftItems.length}</p>
            <p className="text-xs text-muted-foreground">articles affectés à un emplacement · {totalUnits} unité{totalUnits !== 1 ? 's' : ''}</p>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-label="Avancement de la collecte">
              <div className={`h-full rounded-full transition-all ${allDispatched ? 'bg-emerald-600' : 'bg-amber-500'}`} style={{ width: `${progress}%` }} />
            </div>
            {draftItems.length > 0 && !allDispatched && stockLocations.length > 0 && (
              <button type="button" onClick={autoAssignAll}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-border py-2 text-sm font-semibold text-foreground hover:bg-secondary">
                <Zap className="h-4 w-4 text-amber-600" aria-hidden="true" />Auto-affecter les emplacements
              </button>
            )}
            <button type="button" onClick={handleSave} disabled={saving}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-60">
              {saving ? <Loader className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Enregistrer
            </button>
            <button type="button" onClick={handleExportPdf} disabled={exporting}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-border py-2.5 text-sm font-semibold text-foreground hover:bg-secondary disabled:opacity-60">
              {exporting ? <Loader className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}Télécharger le PDF
            </button>
          </section>
        </aside>
      </div>

      {/* Phone: progress and save stay at hand, above the tab bar */}
      <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-20 border-t border-border bg-card px-4 py-2.5 shadow-[0_-4px_16px_rgba(17,24,39,0.06)] md:hidden">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground">Collecte</p>
            <p className={`whitespace-nowrap text-lg font-bold tabular-nums leading-tight ${allDispatched ? 'text-emerald-700 dark:text-emerald-300' : 'text-foreground'}`}>{doneCount} / {draftItems.length} affectés</p>
          </div>
          <button type="button" onClick={handleExportPdf} disabled={exporting} aria-label="Télécharger le PDF"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border text-foreground disabled:opacity-60">
            {exporting ? <Loader className="h-5 w-5 animate-spin" /> : <FileDown className="h-5 w-5" />}
          </button>
          <button type="button" onClick={handleSave} disabled={saving}
            className="flex h-11 shrink-0 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60">
            {saving ? <Loader className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Enregistrer
          </button>
        </div>
      </div>
    </div>
  );
}
