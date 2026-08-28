// @ts-nocheck
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, Link } from 'react-router-dom';
import { Package, Search, Edit, Check, X, Loader, SortAsc, SortDesc, ChevronLeft, ChevronRight, Filter, Paperclip, ShoppingCart, Info, Eye, Building, Tag } from 'lucide-react';
import { Product, StockLocation } from '../types';
import { useAppContext } from '../context/AppContext';
import { StockLocationsService } from '../utils/supabaseStockLocations';
import { supabase } from '../integrations/supabase/client';
import { useToast } from '../context/ToastContext';
import { useQuoteCart } from '../hooks/useQuoteCart';
import { useAuth } from '../hooks/useAuth';
import { useProductOverrides } from '../hooks/useProductOverrides';
import { resolveProductImageUrl } from '../utils/productImages';
import { useEscapeKey } from '../hooks/useShortcuts';

const PRODUCTS_PER_PAGE = 20;
type SortField = 'name' | 'brand' | 'price' | 'buyprice' | 'provider';
type SortOrder = 'asc' | 'desc';
type KioskCategory = NonNullable<Product['kiosk_category']>;

const KIOSK_CATEGORIES: Array<{ value: KioskCategory; label: string }> = [
  { value: 'utensils', label: 'Ustensiles' },
  { value: 'furniture', label: 'Mobilier' },
  { value: 'equipment', label: 'Équipement' },
];

const kioskCategoryLabel = (value?: Product['kiosk_category']) =>
  KIOSK_CATEGORIES.find(category => category.value === value)?.label || 'Non classé';

export default function ProductsPage() {
  const navigate = useNavigate();
  const { state } = useAppContext();
  const { showToast } = useToast();
  const { addToCart } = useQuoteCart();
  const { canCreateQuote, getPriceDisplayType, isStock } = useAuth();
  const { getOriginalName, getAllNames, getDisplayName } = useProductOverrides();
  const [searchQuery, setSearchQuery] = useState('');
  const [brandFilter, setBrandFilter] = useState('');
  const [providerFilter, setProviderFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');
  const [editingBarcode, setEditingBarcode] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<Product>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [sheetCounts, setSheetCounts] = useState<Record<string, number>>({});
  const [localCategories, setLocalCategories] = useState<Record<string, Product['kiosk_category']>>({});
  const [qtyMap, setQtyMap] = useState<Record<string, number>>({});
  const [stockLocations, setStockLocations] = useState<StockLocation[]>([]);
  const [quickViewProduct, setQuickViewProduct] = useState<Product | null>(null);

  const products = state.products || [];

  useEscapeKey(() => setQuickViewProduct(null), !!quickViewProduct);

  useEffect(() => {
    if (!quickViewProduct) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [quickViewProduct]);

  // Technical-sheet badges remain useful; gallery links are intentionally not
  // repeated here now that the canonical product image is shown in the first column.
  useEffect(() => {
    const fetchCounts = async () => {
      try {
        const { data: sheetData } = await supabase.from('technical_sheet_products').select('product_barcode');
        if (sheetData) {
          const counts: Record<string, number> = {};
          sheetData.forEach((row: any) => { counts[row.product_barcode] = (counts[row.product_barcode] || 0) + 1; });
          setSheetCounts(counts);
        }
      } catch { /* ignore */ }
    };
    fetchCounts();
  }, []);

  useEffect(() => {
    setLocalCategories(current => {
      const next = { ...current };
      products.forEach(product => {
        if (!(product.barcode in next)) next[product.barcode] = product.kiosk_category || null;
      });
      return next;
    });
  }, [products]);

  useEffect(() => {
    StockLocationsService.getStockLocations().then(setStockLocations).catch(() => {});
  }, []);

  const brands = useMemo(() => [...new Set(products.map(p => p.brand).filter(Boolean))].sort(), [products]);
  const providers = useMemo(() => [...new Set(products.map(p => p.provider).filter(Boolean))].sort(), [products]);

  const filtered = useMemo(() => {
    let list = [...products];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(p => {
        const brandNames = getAllNames('brand', p.brand || '').join(' ');
        const providerNames = getAllNames('provider', p.provider || '').join(' ');
        const searchable = `${p.name} ${brandNames} ${providerNames} ${p.barcode}`.toLowerCase();
        const tokens = q.split(/\s+/).filter(t => t.length > 0);
        return tokens.every(token => searchable.includes(token));
      });
    }
    const normalizedBrandFilter = brandFilter.toLowerCase().trim();
    const normalizedProviderFilter = providerFilter.toLowerCase().trim();
    if (normalizedBrandFilter) list = list.filter(p => getAllNames('brand', p.brand || '').some(name => name.toLowerCase() === normalizedBrandFilter));
    if (normalizedProviderFilter) list = list.filter(p => getAllNames('provider', p.provider || '').some(name => name.toLowerCase() === normalizedProviderFilter));
    if (categoryFilter) list = list.filter(p => (localCategories[p.barcode] ?? p.kiosk_category ?? null) === categoryFilter);
    list.sort((a, b) => {
      const aV = a[sortField] ?? '';
      const bV = b[sortField] ?? '';
      if (aV < bV) return sortOrder === 'asc' ? -1 : 1;
      if (aV > bV) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });
    return list;
  }, [products, searchQuery, brandFilter, providerFilter, categoryFilter, localCategories, sortField, sortOrder, getAllNames]);

  const totalPages = Math.ceil(filtered.length / PRODUCTS_PER_PAGE);
  const startIdx = (currentPage - 1) * PRODUCTS_PER_PAGE;
  const currentProducts = filtered.slice(startIdx, startIdx + PRODUCTS_PER_PAGE);

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortOrder(o => o === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortOrder('asc'); }
  };

  const startEdit = (product: Product) => {
    setEditingBarcode(product.barcode);
    setEditForm({ name: product.name, price: product.price, buyprice: product.buyprice, reseller_price: product.reseller_price, provider: product.provider });
  };

  const cancelEdit = () => { setEditingBarcode(null); setEditForm({}); };

  const saveEdit = async (barcode: string) => {
    setIsSaving(true);
    try {
      const { error } = await supabase.from('products').update({
        name: editForm.name,
        price: editForm.price,
        buyprice: editForm.buyprice,
        reseller_price: editForm.reseller_price,
        provider: editForm.provider,
      }).eq('barcode', barcode);
      if (error) throw error;
      showToast({ type: 'success', message: 'Produit mis à jour' });
      setEditingBarcode(null);
      window.location.reload();
    } catch {
      showToast({ type: 'error', message: 'Erreur lors de la mise à jour' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddToCart = (product: Product, qty?: number) => {
    const priceType = getPriceDisplayType();
    const quantity = qty ?? qtyMap[product.barcode] ?? 1;
    addToCart(product, priceType === 'reseller' ? 'reseller' : 'normal', 20, quantity);
    showToast({ type: 'success', message: `${product.name} ajouté au devis` });
  };

  const setKioskCategory = async (product: Product, value: Product['kiosk_category']) => {
    const previous = localCategories[product.barcode] ?? product.kiosk_category ?? null;
    setLocalCategories(current => ({ ...current, [product.barcode]: value }));
    const { error } = await supabase.from('products').update({ kiosk_category: value }).eq('barcode', product.barcode);
    if (error) {
      setLocalCategories(current => ({ ...current, [product.barcode]: previous }));
      showToast({ type: 'error', title: 'Classement impossible', message: error.message });
      return;
    }
    showToast({ type: 'success', message: `${product.name} classé : ${kioskCategoryLabel(value)}` });
  };

  const getSortIcon = (field: SortField) => {
    if (sortField !== field) return null;
    return sortOrder === 'asc' ? <SortAsc className="h-3 w-3" /> : <SortDesc className="h-3 w-3" />;
  };

  const formatCurrency = (n: number) => new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

  return (
    <div className="max-w-7xl mx-auto space-y-4">
      {/* Header */}
      <div className="glass rounded-xl shadow-lg p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 bg-primary rounded-lg" style={{ boxShadow: 'var(--shadow-glow)' }}>
              <Package className="h-4 w-4 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground">Catalogue Produits</h1>
              <p className="text-xs text-muted-foreground">{products.length} produit{products.length !== 1 ? 's' : ''}</p>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2.5">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input type="text" value={searchQuery} onChange={e => { setSearchQuery(e.target.value); setCurrentPage(1); }}
              className="w-full pl-8 pr-3 py-1.5 text-sm border border-input rounded-lg focus:ring-2 focus:ring-ring bg-background text-foreground"
              placeholder="Rechercher nom, code-barres, marque..." />
          </div>
          <select value={brandFilter} onChange={e => { setBrandFilter(e.target.value); setCurrentPage(1); }}
            className="px-2.5 py-1.5 text-sm border border-input rounded-lg bg-background text-foreground">
            <option value="">Toutes les marques</option>
            {brands.map(b => <option key={b} value={b}>{getDisplayName('brand', b)}</option>)}
          </select>
          <select value={providerFilter} onChange={e => { setProviderFilter(e.target.value); setCurrentPage(1); }}
            className="px-2.5 py-1.5 text-sm border border-input rounded-lg bg-background text-foreground">
            <option value="">Tous les fournisseurs</option>
            {providers.map(p => <option key={p} value={p}>{getDisplayName('provider', p)}</option>)}
          </select>
          <select value={categoryFilter} onChange={e => { setCategoryFilter(e.target.value); setCurrentPage(1); }}
            className="px-2.5 py-1.5 text-sm border border-input rounded-lg bg-background text-foreground">
            <option value="">Tous les types kiosque</option>
            {KIOSK_CATEGORIES.map(category => <option key={category.value} value={category.value}>{category.label}</option>)}
          </select>
        </div>
        {(searchQuery || brandFilter || providerFilter || categoryFilter) && (
          <div className="mt-2">
            <button onClick={() => { setSearchQuery(''); setBrandFilter(''); setProviderFilter(''); setCategoryFilter(''); }}
              className="flex items-center space-x-1 px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground">
              <X className="h-3 w-3" /><span>Effacer filtres</span>
            </button>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="glass rounded-xl shadow-lg overflow-hidden">
        {products.length === 0 ? (
          <div className="p-8 text-center">
            <Package className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <h3 className="text-base font-medium text-foreground">Aucun produit</h3>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-secondary">
                  <tr>
                    <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase">Image</th>
                    <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase">Code</th>
                    {([
                      ['name', 'Nom'],
                      ['brand', 'Marque'],
                      ['buyprice', 'Achat'],
                      ['price', 'Vente'],
                      ['provider', 'Fournisseur'],
                    ] as [SortField, string][]).map(([field, label]) => (
                      <th key={field} onClick={() => handleSort(field)}
                        className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase cursor-pointer hover:bg-accent">
                        <div className="flex items-center space-x-1"><span>{label}</span>{getSortIcon(field)}</div>
                      </th>
                    ))}
                    <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase">Type kiosque</th>
                    <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase">Stock</th>
                    <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {currentProducts.map(product => {
                    const isEditing = editingBarcode === product.barcode;
                    const totalStock = Object.values(product.stock_levels || {}).reduce((s: number, v: any) => s + (Number(v) || 0), 0);
                    const hasSheets = (sheetCounts[product.barcode] || 0) > 0;
                    const kioskCategory = localCategories[product.barcode] ?? product.kiosk_category ?? null;
                    return (
                      <tr key={product.barcode} className="hover:bg-accent/50">
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            onClick={() => setQuickViewProduct(product)}
                            className="w-11 h-11 aspect-square rounded-lg border border-border bg-secondary/30 overflow-hidden flex items-center justify-center hover:border-primary/60 transition-colors"
                            title="Aperçu rapide"
                          >
                            {product.image ? (
                              <img src={resolveProductImageUrl(product.image) || ''} alt={product.name} className="w-full h-full object-contain" loading="lazy" />
                            ) : (
                              <img src={`${import.meta.env.BASE_URL || '/'}stocky-logo.png`} alt="Stocky" className="w-8 h-8 object-contain opacity-35" />
                            )}
                          </button>
                        </td>
                        <td className="px-3 py-2 text-[11px] text-muted-foreground font-mono">{product.barcode}</td>
                        <td className="px-3 py-2">
                          {isEditing ? (
                            <input type="text" value={editForm.name || ''} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                              className="w-full px-2 py-0.5 text-xs border border-input rounded bg-background text-foreground" />
                          ) : (
                            <div className="flex items-center gap-1.5">
                              <Link
                                to={`/product/${encodeURIComponent(product.barcode)}`}
                                className="text-xs font-medium text-foreground hover:text-primary hover:underline transition-colors"
                                title="Voir la fiche produit"
                              >
                                {product.name}
                              </Link>
                              {hasSheets && (
                                <button onClick={() => navigate('/sheets')} title={`${sheetCounts[product.barcode]} fiche(s) technique(s)`}
                                  className="p-0.5 hover:bg-primary/10 rounded transition-colors">
                                  <Paperclip className="h-3 w-3 text-primary shrink-0" />
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs text-foreground">
                          {product.brand}
                          {getOriginalName('brand', product.brand) && (
                            <span className="text-muted-foreground text-[10px] ml-1">(ex: {getOriginalName('brand', product.brand)})</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {isEditing ? (
                            <input type="number" value={editForm.buyprice || 0} onChange={e => setEditForm(f => ({ ...f, buyprice: parseFloat(e.target.value) || 0 }))}
                              className="w-20 px-2 py-0.5 text-xs border border-input rounded bg-background text-foreground" step="0.01" />
                          ) : (
                            <span className="text-xs text-foreground">{formatCurrency(product.buyprice)}</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {isEditing ? (
                            <input type="number" value={editForm.price || 0} onChange={e => setEditForm(f => ({ ...f, price: parseFloat(e.target.value) || 0 }))}
                              className="w-20 px-2 py-0.5 text-xs border border-input rounded bg-background text-foreground" step="0.01" />
                          ) : (
                            <span className="text-xs font-medium text-foreground">{formatCurrency(product.price)}</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {isEditing ? (
                            <input type="text" value={editForm.provider || ''} onChange={e => setEditForm(f => ({ ...f, provider: e.target.value }))}
                              className="w-24 px-2 py-0.5 text-xs border border-input rounded bg-background text-foreground" />
                          ) : (
                            <span className="text-xs text-foreground">
                              {product.provider || '-'}
                              {product.provider && getOriginalName('provider', product.provider) && (
                                <span className="text-muted-foreground text-[10px] ml-1">(ex: {getOriginalName('provider', product.provider)})</span>
                              )}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {isStock ? (
                            <select value={kioskCategory || ''} onChange={event => setKioskCategory(product, (event.target.value || null) as Product['kiosk_category'])}
                              className="min-w-28 rounded-md border border-input bg-background px-2 py-1 text-[11px] text-foreground">
                              <option value="">Non classé</option>
                              {KIOSK_CATEGORIES.map(category => <option key={category.value} value={category.value}>{category.label}</option>)}
                            </select>
                          ) : (
                            <span className="rounded-full bg-secondary px-2 py-1 text-[10px] text-muted-foreground">{kioskCategoryLabel(kioskCategory)}</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-1">
                            {Object.entries(product.stock_levels || {})
                              .filter(([, qty]) => (Number(qty) || 0) > 0)
                              .map(([locName, qty]) => {
                                const loc = stockLocations.find(l =>
                                  l.abbreviation === locName ||
                                  l.name === locName ||
                                  l.name.toLowerCase().replace(/\s+/g, '_') === locName
                                );
                                const legacyLabel = locName.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                                const label = loc?.name || legacyLabel;
                                return (
                                  <span key={locName} className="text-[10px] bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 px-1.5 py-0.5 rounded font-mono whitespace-nowrap">
                                    {label} {Number(qty)}
                                  </span>
                                );
                              })}
                            {totalStock === 0 && (
                              <span className="text-xs text-destructive">0</span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          {isEditing ? (
                            <div className="flex items-center space-x-1">
                              <button onClick={() => saveEdit(product.barcode)} disabled={isSaving}
                                className="p-1 text-emerald-500 hover:bg-emerald-500/10 rounded">
                                {isSaving ? <Loader className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                              </button>
                              <button onClick={cancelEdit} className="p-1 text-muted-foreground hover:bg-accent rounded">
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center space-x-1">
                              <button onClick={() => setQuickViewProduct(product)} className="p-1 text-muted-foreground hover:bg-accent rounded" title="Aperçu rapide">
                                <Eye className="h-3.5 w-3.5" />
                              </button>
                              <Link to={`/product/${encodeURIComponent(product.barcode)}`} className="p-1 text-muted-foreground hover:bg-accent rounded" title="Fiche produit">
                                <Info className="h-3.5 w-3.5" />
                              </Link>
                              <button onClick={() => startEdit(product)} className="p-1 text-primary hover:bg-primary/10 rounded" title="Modifier">
                                <Edit className="h-3.5 w-3.5" />
                              </button>
                              {canCreateQuote() && (
                                <div className="flex items-center gap-1">
                                  <input
                                    type="number"
                                    min={1}
                                    value={qtyMap[product.barcode] ?? 1}
                                    onChange={e => setQtyMap(m => ({ ...m, [product.barcode]: Math.max(1, parseInt(e.target.value) || 1) }))}
                                    className="w-12 h-6 text-xs text-center border border-border rounded bg-background px-1"
                                    onClick={e => e.stopPropagation()}
                                  />
                                  <button onClick={() => handleAddToCart(product)} className="p-1 text-emerald-500 hover:bg-emerald-500/10 rounded" title="Ajouter au devis">
                                    <ShoppingCart className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div className="px-4 py-2.5 border-t border-border flex items-center justify-between">
                <div className="text-xs text-muted-foreground">
                  {startIdx + 1}-{Math.min(startIdx + PRODUCTS_PER_PAGE, filtered.length)} sur {filtered.length}
                </div>
                <div className="flex items-center space-x-1.5">
                  <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}
                    className="p-1 border border-border rounded hover:bg-accent disabled:opacity-50"><ChevronLeft className="h-3.5 w-3.5" /></button>
                  <span className="px-2 text-xs text-muted-foreground">{currentPage}/{totalPages}</span>
                  <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}
                    className="p-1 border border-border rounded hover:bg-accent disabled:opacity-50"><ChevronRight className="h-3.5 w-3.5" /></button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {quickViewProduct && createPortal((() => {
        const quickTotalStock = Object.values(quickViewProduct.stock_levels || {}).reduce((sum, value) => sum + (Number(value) || 0), 0);
        const quickImageUrl = resolveProductImageUrl(quickViewProduct.image);
        return (
          <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onMouseDown={event => { if (event.target === event.currentTarget) setQuickViewProduct(null); }}>
            <div role="dialog" aria-modal="true" aria-labelledby="quick-view-title" className="w-full max-w-2xl max-h-[90dvh] overflow-y-auto bg-card border border-border rounded-2xl shadow-2xl">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <div>
                  <p className="text-xs text-muted-foreground">Aperçu rapide</p>
                  <h2 id="quick-view-title" className="text-base font-semibold text-foreground line-clamp-1">{quickViewProduct.name}</h2>
                </div>
                <button onClick={() => setQuickViewProduct(null)} className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent" title="Fermer">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="p-4 grid md:grid-cols-[240px_1fr] gap-5">
                <div className="w-full aspect-square rounded-xl border border-border bg-secondary/20 overflow-hidden flex items-center justify-center">
                  {quickImageUrl ? (
                    <img src={quickImageUrl} alt={quickViewProduct.name} className="w-full h-full object-contain" />
                  ) : (
                    <div className="text-center text-muted-foreground"><img src={`${import.meta.env.BASE_URL || '/'}stocky-logo.png`} alt="Stocky" className="mx-auto h-20 w-32 object-contain opacity-35" /><p className="text-xs mt-2">Image à ajouter</p></div>
                  )}
                </div>

                <div className="min-w-0 space-y-4">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-lg bg-secondary/60 p-3">
                      <p className="text-[11px] text-muted-foreground">Code-barres</p>
                      <p className="text-sm font-mono font-medium break-all">{quickViewProduct.barcode}</p>
                    </div>
                    <div className="rounded-lg bg-emerald-500/10 p-3">
                      <p className="text-[11px] text-muted-foreground">Stock total</p>
                      <p className="text-lg font-bold text-emerald-600">{quickTotalStock}</p>
                    </div>
                    <div className="rounded-lg bg-secondary/60 p-3">
                      <p className="text-[11px] text-muted-foreground flex items-center gap-1"><Tag className="h-3 w-3" /> Marque</p>
                      <p className="text-sm font-medium truncate">{quickViewProduct.brand || '—'}</p>
                    </div>
                    <div className="rounded-lg bg-secondary/60 p-3">
                      <p className="text-[11px] text-muted-foreground flex items-center gap-1"><Building className="h-3 w-3" /> Fournisseur</p>
                      <p className="text-sm font-medium truncate">{quickViewProduct.provider || '—'}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-lg border border-border p-2"><p className="text-[10px] text-muted-foreground">Achat</p><p className="text-sm font-semibold">{formatCurrency(quickViewProduct.buyprice)}</p></div>
                    <div className="rounded-lg border border-border p-2"><p className="text-[10px] text-muted-foreground">Vente</p><p className="text-sm font-semibold">{formatCurrency(quickViewProduct.price)}</p></div>
                    <div className="rounded-lg border border-border p-2"><p className="text-[10px] text-muted-foreground">Revendeur</p><p className="text-sm font-semibold">{formatCurrency(quickViewProduct.reseller_price)}</p></div>
                  </div>

                  {Object.keys(quickViewProduct.stock_levels || {}).length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-foreground mb-1.5">Stock par emplacement</p>
                      <div className="flex flex-wrap gap-1.5">
                        {Object.entries(quickViewProduct.stock_levels || {}).map(([location, quantity]) => (
                          <span key={location} className="px-2 py-1 rounded-md bg-primary/10 text-primary text-xs">{location.replace(/_/g, ' ')} · {Number(quantity) || 0}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2 pt-1">
                    <Link to={`/product/${encodeURIComponent(quickViewProduct.barcode)}`} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border hover:bg-accent text-sm">
                      <Info className="h-4 w-4" /> Fiche complète
                    </Link>
                    {canCreateQuote() && (
                      <button onClick={() => { handleAddToCart(quickViewProduct); setQuickViewProduct(null); }} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 text-sm">
                        <ShoppingCart className="h-4 w-4" /> Ajouter au devis
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })(), document.body)}

      {/* Stats */}
      {filtered.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="glass rounded-lg p-3">
            <p className="text-[11px] text-muted-foreground">Produits affichés</p>
            <p className="text-base font-bold text-foreground">{filtered.length}</p>
          </div>
          <div className="glass rounded-lg p-3">
            <p className="text-[11px] text-muted-foreground">Marques</p>
            <p className="text-base font-bold text-foreground">{new Set(filtered.map(p => p.brand)).size}</p>
          </div>
          <div className="glass rounded-lg p-3">
            <p className="text-[11px] text-muted-foreground">Stock total</p>
            <p className="text-base font-bold text-foreground">
              {filtered.reduce((s, p) => s + Object.values(p.stock_levels || {}).reduce((a: number, v: any) => a + (Number(v) || 0), 0), 0)}
            </p>
          </div>
          <div className="glass rounded-lg p-3">
            <p className="text-[11px] text-muted-foreground">Fournisseurs</p>
            <p className="text-base font-bold text-foreground">{new Set(filtered.map(p => p.provider).filter(Boolean)).size}</p>
          </div>
        </div>
      )}
    </div>
  );
}
