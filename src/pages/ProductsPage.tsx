// @ts-nocheck
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Package, Search, Edit, Check, X, Loader, SortAsc, SortDesc, ChevronLeft, ChevronRight, Filter, Paperclip, ShoppingCart } from 'lucide-react';
import { Product } from '../types';
import { useAppContext } from '../context/AppContext';
import { supabase } from '../integrations/supabase/client';
import { useToast } from '../context/ToastContext';
import { useQuoteCart } from '../hooks/useQuoteCart';
import { useAuth } from '../hooks/useAuth';
import { useProductOverrides } from '../hooks/useProductOverrides';

const PRODUCTS_PER_PAGE = 20;
type SortField = 'name' | 'brand' | 'price' | 'buyprice' | 'provider';
type SortOrder = 'asc' | 'desc';

export default function ProductsPage() {
  const navigate = useNavigate();
  const { state } = useAppContext();
  const { showToast } = useToast();
  const { addToCart } = useQuoteCart();
  const { canCreateQuote, getPriceDisplayType } = useAuth();
  const { getOriginalName } = useProductOverrides();
  const [searchQuery, setSearchQuery] = useState('');
  const [brandFilter, setBrandFilter] = useState('');
  const [providerFilter, setProviderFilter] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');
  const [editingBarcode, setEditingBarcode] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<Product>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [sheetCounts, setSheetCounts] = useState<Record<string, number>>({});

  const products = state.products || [];

  // Fetch sheet counts
  useEffect(() => {
    const fetchSheetCounts = async () => {
      try {
        const { data } = await supabase.from('technical_sheet_products').select('product_barcode');
        if (data) {
          const counts: Record<string, number> = {};
          data.forEach((row: any) => {
            counts[row.product_barcode] = (counts[row.product_barcode] || 0) + 1;
          });
          setSheetCounts(counts);
        }
      } catch { /* ignore */ }
    };
    fetchSheetCounts();
  }, []);

  const brands = useMemo(() => [...new Set(products.map(p => p.brand).filter(Boolean))].sort(), [products]);
  const providers = useMemo(() => [...new Set(products.map(p => p.provider).filter(Boolean))].sort(), [products]);

  const filtered = useMemo(() => {
    let list = [...products];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(p => p.name.toLowerCase().includes(q) || p.barcode.includes(q) || p.brand.toLowerCase().includes(q));
    }
    if (brandFilter) list = list.filter(p => p.brand === brandFilter);
    if (providerFilter) list = list.filter(p => p.provider === providerFilter);
    list.sort((a, b) => {
      const aV = a[sortField] ?? '';
      const bV = b[sortField] ?? '';
      if (aV < bV) return sortOrder === 'asc' ? -1 : 1;
      if (aV > bV) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });
    return list;
  }, [products, searchQuery, brandFilter, providerFilter, sortField, sortOrder]);

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

  const handleAddToCart = (product: Product) => {
    const priceType = getPriceDisplayType();
    addToCart(product, priceType === 'reseller' ? 'reseller' : 'normal', 20);
    showToast({ type: 'success', message: `${product.name} ajouté au devis` });
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
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input type="text" value={searchQuery} onChange={e => { setSearchQuery(e.target.value); setCurrentPage(1); }}
              className="w-full pl-8 pr-3 py-1.5 text-sm border border-input rounded-lg focus:ring-2 focus:ring-ring bg-background text-foreground"
              placeholder="Rechercher nom, code-barres, marque..." />
          </div>
          <select value={brandFilter} onChange={e => { setBrandFilter(e.target.value); setCurrentPage(1); }}
            className="px-2.5 py-1.5 text-sm border border-input rounded-lg bg-background text-foreground">
            <option value="">Toutes les marques</option>
            {brands.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
          <select value={providerFilter} onChange={e => { setProviderFilter(e.target.value); setCurrentPage(1); }}
            className="px-2.5 py-1.5 text-sm border border-input rounded-lg bg-background text-foreground">
            <option value="">Tous les fournisseurs</option>
            {providers.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        {(searchQuery || brandFilter || providerFilter) && (
          <div className="mt-2">
            <button onClick={() => { setSearchQuery(''); setBrandFilter(''); setProviderFilter(''); }}
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
                    <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase">Stock</th>
                    <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {currentProducts.map(product => {
                    const isEditing = editingBarcode === product.barcode;
                    const totalStock = Object.values(product.stock_levels || {}).reduce((s: number, v: any) => s + (Number(v) || 0), 0);
                    const hasSheets = (sheetCounts[product.barcode] || 0) > 0;
                    return (
                      <tr key={product.barcode} className="hover:bg-accent/50">
                        <td className="px-3 py-2 text-[11px] text-muted-foreground font-mono">{product.barcode}</td>
                        <td className="px-3 py-2">
                          {isEditing ? (
                            <input type="text" value={editForm.name || ''} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                              className="w-full px-2 py-0.5 text-xs border border-input rounded bg-background text-foreground" />
                          ) : (
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-medium text-foreground">{product.name}</span>
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
                          <span className={`text-xs font-medium ${totalStock > 0 ? 'text-emerald-500' : 'text-destructive'}`}>
                            {totalStock}
                          </span>
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
                              <button onClick={() => startEdit(product)} className="p-1 text-primary hover:bg-primary/10 rounded" title="Modifier">
                                <Edit className="h-3.5 w-3.5" />
                              </button>
                              {canCreateQuote() && (
                                <button onClick={() => handleAddToCart(product)} className="p-1 text-emerald-500 hover:bg-emerald-500/10 rounded" title="Ajouter au devis">
                                  <ShoppingCart className="h-3.5 w-3.5" />
                                </button>
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