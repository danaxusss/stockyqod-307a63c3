// @ts-nocheck
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Save, FileDown, Loader, Plus, Trash2,
  ChevronDown, ChevronUp, Check, AlertCircle, ClipboardList,
  Search, Package, X, User,
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
        stock: product?.stock_levels?.[loc.abbreviation] ?? product?.stock_levels?.[loc.name] ?? 0,
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
          stock: product?.stock_levels?.[loc.abbreviation] ?? product?.stock_levels?.[loc.name] ?? 0,
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

  const updateDispatch = (itemId: string, locId: string, subCode: string, locName: string, qty: number) => {
    setDraftItems(prev => prev.map(item => {
      if (item.id !== itemId) return item;
      const key = `${locId}::${subCode}`;
      const filtered = (item.dispatch || []).filter(
        d => `${d.stock_location_id}::${d.sub_location_code}` !== key
      );
      const newDispatch = qty > 0
        ? [...filtered, { stock_location_id: locId, stock_location_name: locName, sub_location_code: subCode, quantity: qty }]
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
      const stockTgts = tgts.filter(t => t.stock > 0);
      if (stockTgts.length === 0) return item;
      const perfect = stockTgts.find(t => t.stock >= item.quantity);
      if (perfect) {
        return { ...item, dispatch: [{ stock_location_id: perfect.locationId, stock_location_name: perfect.locationName, sub_location_code: perfect.subCode, quantity: item.quantity }] };
      }
      let rem = item.quantity;
      const nd = [...stockTgts].sort((a, b) => b.stock - a.stock).reduce<typeof item.dispatch>((acc, t) => {
        if (rem <= 0) return acc;
        const q = Math.min(t.stock, rem); rem -= q;
        return [...(acc || []), { stock_location_id: t.locationId, stock_location_name: t.locationName, sub_location_code: t.subCode, quantity: q }];
      }, []);
      return { ...item, dispatch: nd || [] };
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

  if (!isFacturation && !isSuperAdmin) {
    return <div className="p-8 text-center text-muted-foreground">Accès réservé au rôle Facturation.</div>;
  }

  if (loading) return (
    <div className="flex items-center justify-center min-h-64">
      <Loader className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  );
  if (!bc) return null;

  const formatDate = (d: Date) => new Date(d).toLocaleDateString('fr-FR');

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      {/* Header */}
      <div className="glass rounded-xl shadow-lg p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/compta/bons-commande')} className="p-1.5 hover:bg-accent rounded-lg">
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div className="p-2 bg-primary rounded-lg">
              <ClipboardList className="h-4 w-4 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground">BC — {bc.quoteNumber}</h1>
              <p className="text-xs text-muted-foreground">{formatDate(bc.createdAt)}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleExportPdf} disabled={exporting}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-border rounded-lg hover:bg-accent">
              {exporting ? <Loader className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />}
              PDF
            </button>
            <button onClick={handleSave} disabled={saving}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90">
              {saving ? <Loader className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Sauvegarder
            </button>
          </div>
        </div>
      </div>

      {/* Client + meta */}
      <div className="glass rounded-xl shadow-lg p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* Client name with autocomplete */}
        <div className="relative">
          <label className="block text-xs font-medium text-muted-foreground mb-1">Client</label>
          <div className="relative">
            <User className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={draftCustomer.fullName}
              onChange={e => handleClientSearch(e.target.value)}
              onBlur={() => setTimeout(() => setShowClientSugg(false), 150)}
              className="w-full pl-8 pr-3 py-1.5 text-sm border border-input rounded-lg bg-background text-foreground"
              placeholder="Nom du client"
            />
          </div>
          {showClientSugg && clientSuggestions.length > 0 && (
            <div className="absolute z-20 w-full mt-1 bg-card border border-border rounded-lg shadow-lg max-h-48 overflow-y-auto">
              {clientSuggestions.map(c => (
                <button key={c.id} onMouseDown={() => selectClient(c)}
                  className="w-full text-left px-3 py-2 hover:bg-accent text-sm flex flex-col">
                  <span className="font-medium">{c.full_name}</span>
                  {c.phone_number && <span className="text-xs text-muted-foreground">{c.phone_number}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Téléphone</label>
          <input
            value={draftCustomer.phoneNumber}
            onChange={e => setDraftCustomer(c => ({ ...c, phoneNumber: e.target.value }))}
            className="w-full px-3 py-1.5 text-sm border border-input rounded-lg bg-background text-foreground"
            placeholder="Téléphone"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Notes</label>
          <input
            value={draftNotes}
            onChange={e => setDraftNotes(e.target.value)}
            className="w-full px-3 py-1.5 text-sm border border-input rounded-lg bg-background text-foreground"
            placeholder="Notes..."
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Statut</label>
          <select value={draftStatus} onChange={e => setDraftStatus(e.target.value as 'draft' | 'final')}
            className="px-3 py-1.5 text-sm border border-input rounded-lg bg-background text-foreground">
            <option value="draft">Brouillon</option>
            <option value="final">Final</option>
          </select>
        </div>
      </div>

      {/* Product search */}
      <div className="glass rounded-xl shadow-lg p-4">
        <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <Package className="h-4 w-4 text-muted-foreground" />
          Ajouter des produits
        </h2>
        <div className="relative mb-2">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            value={productSearch}
            onChange={e => setProductSearch(e.target.value)}
            placeholder="Rechercher par nom, marque, code-barre..."
            className="w-full pl-8 pr-3 py-1.5 text-sm border border-input rounded-lg bg-background text-foreground"
          />
          {productSearch && (
            <button onClick={() => { setProductSearch(''); setProductResults([]); }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {productResults.length > 0 && (
          <div className="border border-border rounded-lg overflow-hidden divide-y divide-border max-h-56 overflow-y-auto mb-2">
            {productResults.map(p => {
              const totalStock = Object.values(p.stock_levels || {}).reduce((s: number, v: any) => s + (v || 0), 0);
              return (
                <button key={p.barcode} onClick={() => addProductToBC(p)}
                  className="w-full flex items-center justify-between px-3 py-2 hover:bg-accent text-left">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{p.name}</div>
                    <div className="text-xs text-muted-foreground">{p.brand} · {p.barcode}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-3">
                    <span className={`text-xs font-mono px-1.5 py-0.5 rounded ${totalStock > 0 ? 'bg-emerald-500/10 text-emerald-600' : 'bg-muted text-muted-foreground'}`}>
                      stock: {totalStock}
                    </span>
                    <Plus className="h-3.5 w-3.5 text-primary" />
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Custom product toggle */}
        <button
          onClick={() => setShowCustomForm(v => !v)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {showCustomForm ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          Produit hors catalogue
        </button>

        {showCustomForm && (
          <div className="mt-2 p-3 bg-muted/30 rounded-lg border border-border space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground">Désignation *</label>
                <input value={customForm.name} onChange={e => setCustomForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full mt-0.5 px-2 py-1 text-sm border border-input rounded bg-background"
                  placeholder="Nom du produit" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Marque</label>
                <input value={customForm.brand} onChange={e => setCustomForm(f => ({ ...f, brand: e.target.value }))}
                  className="w-full mt-0.5 px-2 py-1 text-sm border border-input rounded bg-background"
                  placeholder="Marque" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Code-barre</label>
                <input value={customForm.barcode} onChange={e => setCustomForm(f => ({ ...f, barcode: e.target.value }))}
                  className="w-full mt-0.5 px-2 py-1 text-sm border border-input rounded bg-background"
                  placeholder="Optionnel" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Prix unitaire</label>
                <input type="number" min={0} value={customForm.unitPrice} onChange={e => setCustomForm(f => ({ ...f, unitPrice: e.target.value }))}
                  className="w-full mt-0.5 px-2 py-1 text-sm border border-input rounded bg-background"
                  placeholder="0.00" />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Fournisseur</label>
              {showNewProviderInput ? (
                <div className="flex gap-2 mt-0.5">
                  <input
                    type="text"
                    value={newProviderName}
                    onChange={e => setNewProviderName(e.target.value)}
                    className="flex-1 px-2 py-1 text-sm border border-input rounded bg-background"
                    placeholder="Nom du fournisseur"
                  />
                  <button
                    type="button"
                    onClick={async () => {
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
                    }}
                    className="px-2 py-1 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90"
                  >
                    OK
                  </button>
                  <button type="button" onClick={() => setShowNewProviderInput(false)} className="p-1 hover:bg-accent rounded">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <div className="flex gap-2 mt-0.5">
                  <select
                    value={customForm.provider_id}
                    onChange={e => {
                      const sel = providers.find(p => p.id === e.target.value);
                      setCustomForm(f => ({ ...f, provider_id: e.target.value, provider_name: sel?.name || '' }));
                    }}
                    className="flex-1 px-2 py-1 text-sm border border-input rounded bg-background text-foreground"
                  >
                    <option value="">— Aucun —</option>
                    {providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <button type="button" onClick={() => setShowNewProviderInput(true)} className="px-2 py-1 text-xs border border-input rounded hover:bg-accent text-foreground whitespace-nowrap">
                    + Nouveau
                  </button>
                </div>
              )}
            </div>
            <button
              onClick={addCustomProduct}
              disabled={!customForm.name.trim()}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-40"
            >
              <Plus className="h-3.5 w-3.5" /> Ajouter
            </button>
          </div>
        )}
      </div>

      {/* Dispatch summary */}
      {draftItems.length > 0 && (
        <div className={`rounded-xl p-3 flex items-center gap-2 text-sm ${allDispatched ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'bg-amber-500/10 text-amber-700 dark:text-amber-400'}`}>
          <span className="flex-1 flex items-center gap-2">
            {allDispatched
              ? <><Check className="h-4 w-4 shrink-0" /> Tous les articles sont affectés aux emplacements de collecte.</>
              : <><AlertCircle className="h-4 w-4 shrink-0" /> {draftItems.filter(i => !isItemDispatched(i)).length} article(s) sans affectation complète.</>
            }
          </span>
          {!allDispatched && stockLocations.length > 0 && (
            <button
              onClick={autoAssignAll}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1 bg-background border border-border rounded-lg hover:bg-accent transition-colors whitespace-nowrap font-medium shrink-0"
              title="Affecter chaque article au meilleur emplacement disponible"
            >
              ⚡ Auto-affecter
            </button>
          )}
        </div>
      )}

      {/* Items */}
      <div className="glass rounded-xl shadow-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold">Articles ({draftItems.length})</h2>
        </div>
        {draftItems.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Utilisez la recherche ci-dessus pour ajouter des articles.
          </p>
        ) : (
          <div className="divide-y divide-border">
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

              return (
                <div key={item.id}>
                  {/* Item row */}
                  <div className="flex items-center gap-2 px-4 py-2.5">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs font-medium">{item.quoteName || item.product?.name}</span>
                        {item.quoteBrand && <span className="text-[10px] text-muted-foreground">{item.quoteBrand}</span>}
                        {item.quoteBarcode && <span className="text-[10px] font-mono text-muted-foreground">{item.quoteBarcode}</span>}
                        {hasAnyStock
                          ? stockTargets.slice(0, 5).map(t => (
                              <span key={t.locationId + t.subCode} className="text-[10px] bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-1.5 py-0.5 rounded-full font-mono whitespace-nowrap">
                                {t.locationAbbrev}:{t.stock}
                              </span>
                            ))
                          : <span className="text-[10px] bg-amber-500/10 text-amber-600 dark:text-amber-400 px-1.5 py-0.5 rounded-full">hors stock</span>
                        }
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <input type="number" min={1} value={item.quantity}
                        onChange={e => updateItemQty(item.id, parseInt(e.target.value) || 1)}
                        className="w-14 h-7 text-xs text-center border border-input rounded bg-background" />
                      {/* Dispatch badge/toggle */}
                      <button
                        onClick={() => setExpandedDispatch(prev => {
                          const n = new Set(prev);
                          n.has(item.id) ? n.delete(item.id) : n.add(item.id);
                          return n;
                        })}
                        className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded-full font-semibold transition-colors ${
                          isDone
                            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                            : dispatched > 0
                            ? 'bg-amber-500/10 text-amber-600'
                            : 'bg-muted text-muted-foreground'
                        }`}
                        title="Affecter les emplacements"
                      >
                        {isDone ? <Check className="h-3 w-3" /> : <Package className="h-3 w-3" />}
                        {isDone ? 'OK' : `${dispatched}/${item.quantity}`}
                        {expanded ? <ChevronUp className="h-3 w-3 ml-0.5" /> : <ChevronDown className="h-3 w-3 ml-0.5" />}
                      </button>
                      {quickTarget && (
                        <button
                          onClick={() => updateDispatch(item.id, quickTarget.locationId, quickTarget.subCode, quickTarget.locationName, item.quantity)}
                          className="text-[10px] px-2 py-1 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 rounded-full font-semibold hover:bg-emerald-500/25 transition-colors whitespace-nowrap"
                          title={`Affecter ${item.quantity} → ${quickTarget.locationAbbrev}`}
                        >
                          ⚡{quickTarget.locationAbbrev}
                        </button>
                      )}
                      <button onClick={() => removeItem(item.id)} className="p-1 hover:bg-destructive/10 text-destructive rounded">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Dispatch panel */}
                  {expanded && (
                    <div className="bg-muted/20 border-t border-border px-4 py-3">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-xs font-medium text-muted-foreground">
                          Collecte — <span className={dispatched === item.quantity ? 'text-emerald-600' : 'text-amber-600'}>{dispatched}/{item.quantity}</span> unités affectées
                        </p>
                        <button
                          onClick={() => setDispatchShowAll(prev => {
                            const n = new Set(prev);
                            n.has(item.id) ? n.delete(item.id) : n.add(item.id);
                            return n;
                          })}
                          className="text-[10px] text-primary hover:underline"
                        >
                          {showAll ? 'Masquer emplacements vides' : 'Afficher tous les emplacements'}
                        </button>
                      </div>

                      {stockLocations.length === 0 ? (
                        <p className="text-xs text-muted-foreground">Aucun emplacement configuré. Allez dans Paramètres → Emplacements.</p>
                      ) : (
                        <>
                          {!hasAnyStock && (
                            <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 rounded px-2 py-1.5 mb-2">
                              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                              Produit hors stock — choisissez l'emplacement de collecte manuellement.
                            </div>
                          )}
                          {Object.keys(grouped).length > 0 && (
                            <div className="space-y-3">
                              {Object.entries(grouped).map(([provName, locs]) => (
                                <div key={provName}>
                                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 mb-1.5">{provName}</p>
                                  <div className="space-y-1">
                                    {locs.map(t => {
                                      const qty = getDispatchQty(item, t.locationId, t.subCode);
                                      return (
                                        <div key={`${t.locationId}::${t.subCode}`} className="flex items-center gap-2 text-xs">
                                          <span className={`w-10 text-center font-mono font-semibold text-[10px] px-1 py-0.5 rounded shrink-0 ${t.stock > 0 ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-muted text-muted-foreground/50'}`}>
                                            {t.locationAbbrev}
                                          </span>
                                          <span className="flex-1 text-foreground truncate" title={t.locationName}>{t.locationName}</span>
                                          <span className={`w-12 text-right tabular-nums text-[10px] shrink-0 ${t.stock === 0 ? 'text-muted-foreground/40' : 'text-muted-foreground'}`}>
                                            stk:{t.stock}
                                          </span>
                                          <input
                                            type="number" min={0} max={item.quantity}
                                            value={qty || ''}
                                            placeholder="0"
                                            onChange={e => updateDispatch(item.id, t.locationId, t.subCode, t.locationName, parseInt(e.target.value) || 0)}
                                            className="w-14 h-6 text-xs text-center border border-input rounded bg-background shrink-0"
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
                          <div className="mt-3 pt-2.5 border-t border-border/40">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 mb-1.5">Emplacement personnalisé</p>
                            <div className="flex items-center gap-2">
                              <input
                                value={customLocInputs[item.id]?.abbrev || ''}
                                onChange={e => setCustomLocInputs(prev => ({ ...prev, [item.id]: { ...(prev[item.id] || { name: '' }), abbrev: e.target.value } }))}
                                className="w-16 h-6 text-xs text-center border border-input rounded bg-background font-mono shrink-0"
                                placeholder="Abrév."
                              />
                              <input
                                value={customLocInputs[item.id]?.name || ''}
                                onChange={e => setCustomLocInputs(prev => ({ ...prev, [item.id]: { ...(prev[item.id] || { abbrev: '' }), name: e.target.value } }))}
                                className="flex-1 h-6 text-xs px-2 border border-input rounded bg-background"
                                placeholder="Fournisseur..."
                              />
                              <input
                                type="number" min={0} max={item.quantity}
                                value={getDispatchQty(item, 'custom', customLocInputs[item.id]?.abbrev || '') || ''}
                                placeholder="0"
                                onChange={e => {
                                  const abbrev = customLocInputs[item.id]?.abbrev?.trim();
                                  if (!abbrev) return;
                                  updateDispatch(item.id, 'custom', abbrev, customLocInputs[item.id]?.name || abbrev, parseInt(e.target.value) || 0);
                                }}
                                className="w-14 h-6 text-xs text-center border border-input rounded bg-background shrink-0"
                              />
                            </div>
                          </div>

                          {dispatched > 0 && dispatched !== item.quantity && (
                            <p className="mt-2 text-xs text-amber-600">
                              {dispatched < item.quantity
                                ? `Reste ${item.quantity - dispatched} unité(s) à affecter`
                                : `Surplus de ${dispatched - item.quantity} unité(s)`}
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
