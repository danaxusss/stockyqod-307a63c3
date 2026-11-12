// @ts-nocheck
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { Package, Search, Edit, Check, X, Loader, SortAsc, SortDesc, ChevronLeft, ChevronRight, ShoppingCart, Info, Eye, Building, Tag, Briefcase, ListChecks, Save, CheckSquare, Square, CheckCircle2, AlertTriangle, RotateCcw, SlidersHorizontal, ChevronDown, ChevronUp, Plus, FileSearch } from 'lucide-react';
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
import { useIsMobile } from '../hooks/use-mobile';
import { SectorPicker } from '../components/SectorPicker';
import { SectorManagerDialog } from '../components/SectorManagerDialog';
import { BusinessSectorsService, sectorNames, useBusinessSectors } from '../utils/businessSectors';
import { TechnicalSheetButton } from '../components/TechnicalSheetButton';
import { TechnicalSheetFinder } from '../components/TechnicalSheetFinder';
import { ImageViewer } from '../components/ImageViewer';
import { loadSheetLinks, type SheetLink } from '../utils/technicalSheets';
import { KIOSK_CATEGORIES, type KioskCategory } from '../utils/kioskCategories';
import { PageHeader } from '../components/PageHeader';
import { RowMenu } from '../components/lists/RowMenu';
import { ColumnPicker } from '../components/lists/ColumnPicker';
import { usePersistentColumns } from '../components/lists/usePersistentColumns';
import { formatMoney } from '../utils/format';
import { effectiveChange, saveProductClassifications, type ClassificationChange } from '../utils/productClassification';

const PRODUCTS_PER_PAGE = 20;
type SortField = 'name' | 'brand' | 'price' | 'buyprice' | 'provider';
type SortOrder = 'asc' | 'desc';
// Sector filter value for products that have no sector yet.
const NO_SECTOR = '__none__';
// Bulk edits are grouped and saved this long after the last change.
const BULK_AUTOSAVE_MS = 900;

/** Sector names on one line: the first two, then "+N" (all names in the tooltip). */
function SectorChips({ names }: { names: string[] }) {
  if (!names.length) return <span className="text-[10px] text-muted-foreground">—</span>;
  return (
    <div className="flex max-w-44 flex-nowrap items-center gap-1 overflow-hidden" title={names.join(', ')}>
      {names.slice(0, 2).map(name => (
        <span key={name} className="truncate whitespace-nowrap rounded-full bg-secondary px-2 py-1 text-[10px] text-muted-foreground">{name}</span>
      ))}
      {names.length > 2 && <span className="shrink-0 whitespace-nowrap rounded-full bg-secondary px-1.5 py-1 text-[10px] font-medium text-muted-foreground">+{names.length - 2}</span>}
    </div>
  );
}

// Optional desktop columns; name, sale price and actions are always shown.
type OptionalColumn = 'brand' | 'buyprice' | 'provider' | 'kiosk' | 'sectors' | 'stock';
const COLUMN_OPTIONS: Array<{ key: OptionalColumn; label: string }> = [
  { key: 'brand', label: 'Marque' },
  { key: 'buyprice', label: 'Prix d’achat' },
  { key: 'provider', label: 'Fournisseur' },
  { key: 'stock', label: 'Stock' },
  { key: 'kiosk', label: 'Type kiosque' },
  { key: 'sectors', label: 'Secteur' },
];
const DEFAULT_COLUMNS: OptionalColumn[] = ['brand', 'buyprice', 'stock'];

const kioskCategoryLabel = (value?: Product['kiosk_category']) =>
  KIOSK_CATEGORIES.find(category => category.value === value)?.label || 'Non classé';

export default function ProductsPage() {
  const { state, applyProductChanges } = useAppContext();
  const { showToast } = useToast();
  const { addToCart } = useQuoteCart();
  const { canCreateQuote, getPriceDisplayType, isStock, canEditProducts } = useAuth();
  const { getOriginalName, getAllNames, getDisplayName } = useProductOverrides();
  const [searchQuery, setSearchQuery] = useState('');
  const [brandFilter, setBrandFilter] = useState('');
  const [providerFilter, setProviderFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [sectorFilter, setSectorFilter] = useState('');
  const [managingSectors, setManagingSectors] = useState(false);
  // Phones get product cards instead of the wide table, and collapsed filters.
  const isMobile = useIsMobile();
  const [showFilters, setShowFilters] = useState(false);
  // Phones: the bulk bar can fold to one line so it hides less of the list.
  const [bulkBarOpen, setBulkBarOpen] = useState(true);
  // Bulk mode: kiosk type and sectors become editable on every row. Changes
  // are saved automatically shortly after the last edit ("Enregistrer" saves
  // at once), and whatever is left is saved when leaving bulk mode or the page.
  const [bulkMode, setBulkMode] = useState(false);
  const [pending, setPending] = useState<Record<string, ClassificationChange>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [savingBulk, setSavingBulk] = useState(false);
  const [bulkError, setBulkError] = useState('');
  const [bulkSavedCount, setBulkSavedCount] = useState(0);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const saveInFlight = useRef<Promise<number> | null>(null);
  const applyChangesRef = useRef(applyProductChanges);
  applyChangesRef.current = applyProductChanges;
  const { sectors } = useBusinessSectors();
  const [currentPage, setCurrentPage] = useState(1);
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');
  const [editingBarcode, setEditingBarcode] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<Product>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [sheetLinks, setSheetLinks] = useState<Record<string, SheetLink[]>>({});
  const [sheetFinderProduct, setSheetFinderProduct] = useState<Product | null>(null);
  const [stockLocations, setStockLocations] = useState<StockLocation[]>([]);
  const [quickViewProduct, setQuickViewProduct] = useState<Product | null>(null);
  const [quickImageOpen, setQuickImageOpen] = useState(false);
  const { columns, toggle: toggleColumn } = usePersistentColumns<OptionalColumn>('stocky.products.columns', DEFAULT_COLUMNS, COLUMN_OPTIONS.map(option => option.key));

  const products = state.products || [];

  useEscapeKey(() => setQuickViewProduct(null), !!quickViewProduct);
  useEffect(() => { setQuickImageOpen(false); }, [quickViewProduct]);

  useEffect(() => {
    if (!quickViewProduct) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [quickViewProduct]);

  // Linked technical sheets, shown as the sheet icon in each row's actions.
  useEffect(() => {
    loadSheetLinks().then(setSheetLinks).catch(() => { /* the icon falls back to search */ });
  }, []);


  useEffect(() => {
    StockLocationsService.getStockLocations().then(setStockLocations).catch(() => {});
  }, []);

  const pendingCount = Object.keys(pending).length;
  const activeFilterCount = [brandFilter, providerFilter, categoryFilter, sectorFilter].filter(Boolean).length;

  // Values shown in a row: the pending bulk edit when there is one, else the saved value.
  const shownKioskCategory = (product: Product) =>
    pending[product.barcode] && 'kiosk_category' in pending[product.barcode] ? pending[product.barcode].kiosk_category ?? null : product.kiosk_category ?? null;
  const shownSectors = (product: Product): string[] =>
    pending[product.barcode] && 'sector_ids' in pending[product.barcode] ? pending[product.barcode].sector_ids ?? [] : product.sector_ids ?? [];

  const sectorCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    products.forEach(product => (product.sector_ids || []).forEach(id => { counts[id] = (counts[id] || 0) + 1; }));
    return counts;
  }, [products]);

  useEffect(() => {
    if (!pendingCount) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [pendingCount]);

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
    // Filters use saved values, so rows don't disappear while being edited.
    if (categoryFilter) list = list.filter(p => (p.kiosk_category ?? null) === categoryFilter);
    if (sectorFilter) {
      list = list.filter(p => {
        const ids = p.sector_ids || [];
        return sectorFilter === NO_SECTOR ? ids.length === 0 : ids.includes(sectorFilter);
      });
    }
    list.sort((a, b) => {
      const aV = a[sortField] ?? '';
      const bV = b[sortField] ?? '';
      if (aV < bV) return sortOrder === 'asc' ? -1 : 1;
      if (aV > bV) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });
    return list;
  }, [products, searchQuery, brandFilter, providerFilter, categoryFilter, sectorFilter, sortField, sortOrder, getAllNames]);

  const totalPages = Math.ceil(filtered.length / PRODUCTS_PER_PAGE);
  const startIdx = (currentPage - 1) * PRODUCTS_PER_PAGE;
  const currentProducts = filtered.slice(startIdx, startIdx + PRODUCTS_PER_PAGE);

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortOrder(o => o === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortOrder('asc'); }
  };

  const startEdit = (product: Product) => {
    setEditingBarcode(product.barcode);
    setEditForm({
      name: product.name, price: product.price, buyprice: product.buyprice, reseller_price: product.reseller_price, provider: product.provider,
      kiosk_category: product.kiosk_category ?? null, sector_ids: product.sector_ids || [],
    });
  };

  const cancelEdit = () => { setEditingBarcode(null); setEditForm({}); };

  const saveEdit = async (barcode: string) => {
    setIsSaving(true);
    try {
      const values = {
        name: editForm.name,
        price: editForm.price,
        buyprice: editForm.buyprice,
        reseller_price: editForm.reseller_price,
        provider: editForm.provider,
        ...(canEditProducts ? { kiosk_category: editForm.kiosk_category ?? null, sector_ids: editForm.sector_ids || [] } : {}),
      };
      const { error } = await supabase.from('products').update(values).eq('barcode', barcode);
      if (error) throw error;
      applyProductChanges({ [barcode]: values });
      showToast({ type: 'success', message: 'Produit mis à jour' });
      setEditingBarcode(null);
      setEditForm({});
    } catch (error) {
      showToast({ type: 'error', title: 'Erreur lors de la mise à jour', message: error?.message || 'Erreur inconnue' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddToCart = (product: Product, qty?: number) => {
    const priceType = getPriceDisplayType();
    const quantity = qty ?? 1;
    addToCart(product, priceType === 'reseller' ? 'reseller' : 'normal', 20, quantity);
    showToast({ type: 'success', message: `${product.name} ajouté au devis` });
  };

  // Row edit (pencil): kiosk type and sectors save as soon as they change;
  // the other fields wait for the ✓ button.
  const autoSaveClassification = async (product: Product, change: ClassificationChange) => {
    const previous = { kiosk_category: editForm.kiosk_category ?? null, sector_ids: editForm.sector_ids || [] };
    setEditForm(f => ({ ...f, ...change }));
    const result = await saveProductClassifications({ [product.barcode]: change });
    if (result.failed.length) {
      setEditForm(f => ({ ...f, ...Object.fromEntries(Object.keys(change).map(key => [key, previous[key]])) }));
      showToast({ type: 'error', title: 'Non enregistré', message: result.failed[0].message });
      return;
    }
    applyProductChanges(result.saved);
    showToast({ type: 'success', message: `${product.name} : enregistré` });
  };

  const editPending = (product: Product, change: ClassificationChange) => {
    setBulkError('');
    setPending(current => {
      const next = effectiveChange(product, { ...current[product.barcode], ...change });
      const copy = { ...current };
      if (Object.keys(next).length) copy[product.barcode] = next;
      else delete copy[product.barcode];
      return copy;
    });
  };

  const productsByBarcode = useMemo(() => new Map(products.map(product => [product.barcode, product])), [products]);
  const selectedProducts = () => [...selected].map(barcode => productsByBarcode.get(barcode)).filter(Boolean) as Product[];

  const applyToSelection = (change: (product: Product) => ClassificationChange) => {
    selectedProducts().forEach(product => editPending(product, change(product)));
  };

  const toggleSelected = (barcode: string) => setSelected(current => {
    const next = new Set(current);
    if (next.has(barcode)) next.delete(barcode); else next.add(barcode);
    return next;
  });

  const pageSelected = currentProducts.length > 0 && currentProducts.every(product => selected.has(product.barcode));
  const togglePageSelection = () => setSelected(current => {
    const next = new Set(current);
    currentProducts.forEach(product => { if (pageSelected) next.delete(product.barcode); else next.add(product.barcode); });
    return next;
  });

  // Re-open a folded bar when a selection starts, so the actions are at hand.
  useEffect(() => { if (selected.size === 1) setBulkBarOpen(true); }, [selected.size]);

  const startBulk = () => { cancelEdit(); setBulkError(''); setBulkSavedCount(0); setBulkMode(true); };

  /**
   * Save every pending bulk edit; returns how many could not be saved. Waits
   * for a save already running, then saves what is still pending.
   */
  const flushPending = useCallback(async (): Promise<number> => {
    while (saveInFlight.current) await saveInFlight.current;
    const snapshot = pendingRef.current;
    if (!Object.keys(snapshot).length) return 0;
    const run = (async () => {
      setSavingBulk(true);
      try {
        const result = await saveProductClassifications(snapshot);
        applyChangesRef.current(result.saved);
        // Keep edits made while saving: only drop entries that were saved as-is.
        const dropSaved = (current: Record<string, ClassificationChange>) => {
          const next = { ...current };
          Object.keys(result.saved).forEach(barcode => { if (next[barcode] === snapshot[barcode]) delete next[barcode]; });
          return next;
        };
        pendingRef.current = dropSaved(pendingRef.current);
        setPending(dropSaved);
        setBulkSavedCount(count => count + Object.keys(result.saved).length);
        if (result.failed.length) {
          setBulkError(`${result.failed.length} produit(s) non enregistré(s) — ${result.failed[0].barcode} : ${result.failed[0].message}`);
        }
        return result.failed.length;
      } catch (error) {
        setBulkError(error?.message || 'Enregistrement impossible');
        return Object.keys(snapshot).length;
      } finally {
        setSavingBulk(false);
      }
    })();
    saveInFlight.current = run;
    try {
      return await run;
    } finally {
      saveInFlight.current = null;
    }
  }, []);

  // Autosave: shortly after the last change; paused after a failure until the
  // user retries or edits again (no retry loop).
  useEffect(() => {
    if (!bulkMode || !pendingCount || savingBulk || bulkError) return;
    const timer = setTimeout(() => { flushPending(); }, BULK_AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [bulkMode, pendingCount, pending, savingBulk, bulkError, flushPending]);

  // Leaving the page (another menu, a product sheet…) must not lose edits.
  useEffect(() => () => {
    const left = pendingRef.current;
    if (Object.keys(left).length) {
      saveProductClassifications(left).then(result => applyChangesRef.current(result.saved)).catch(() => undefined);
    }
  }, []);

  const leaveBulk = async () => {
    const failed = await flushPending();
    if (failed && !window.confirm(`${failed} modification(s) n’ont pas pu être enregistrées. Quitter quand même et les abandonner ?`)) return;
    setPending({});
    setSelected(new Set());
    setBulkError('');
    setBulkMode(false);
  };

  // Cells shared by the desktop table and the phone cards.
  const renderKioskType = (product: Product, isEditing: boolean, editable: boolean, kioskCategory: Product['kiosk_category']) => editable ? (
    <select value={(isEditing ? editForm.kiosk_category : kioskCategory) || ''} aria-label={`Type kiosque de ${product.name}`}
      onChange={event => {
        const value = (event.target.value || null) as Product['kiosk_category'];
        if (isEditing) autoSaveClassification(product, { kiosk_category: value });
        else editPending(product, { kiosk_category: value });
      }}
      className="min-w-28 rounded-md border border-input bg-background px-2 py-1.5 text-xs text-foreground md:py-1 md:text-[11px]">
      <option value="">Non classé</option>
      {KIOSK_CATEGORIES.map(category => <option key={category.value} value={category.value}>{category.label}</option>)}
    </select>
  ) : (
    <span className="whitespace-nowrap rounded-full bg-secondary px-2 py-1 text-[10px] text-muted-foreground">{kioskCategoryLabel(kioskCategory)}</span>
  );

  const renderSectors = (product: Product, isEditing: boolean, editable: boolean, rowSectors: string[]) => editable ? (
    <SectorPicker sectors={sectors} value={isEditing ? editForm.sector_ids || [] : rowSectors}
      onChange={ids => { if (isEditing) autoSaveClassification(product, { sector_ids: ids }); else editPending(product, { sector_ids: ids }); }}
      onCreate={name => BusinessSectorsService.create(name)} />
  ) : (
    <SectorChips names={sectorNames(rowSectors, sectors)} />
  );

  const renderStock = (product: Product) => {
    const totalStock = Object.values(product.stock_levels || {}).reduce((sum: number, value: any) => sum + (Number(value) || 0), 0);
    return (
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
    );
  };

  // Row actions: the technical sheet when one is linked, "+ Devis", and the
  // rest in the ⋯ menu.
  const renderActions = (product: Product, isEditing: boolean) => isEditing ? (
    <div className="flex items-center justify-end gap-1">
      <button onClick={() => saveEdit(product.barcode)} disabled={isSaving} aria-label="Enregistrer"
        className="flex h-9 w-9 items-center justify-center rounded-lg text-emerald-600 hover:bg-emerald-500/10">
        {isSaving ? <Loader className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
      </button>
      <button onClick={cancelEdit} aria-label="Annuler" className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary">
        <X className="h-4 w-4" />
      </button>
    </div>
  ) : (() => {
    const sheets = sheetLinks[product.barcode] || [];
    return (
      <div className="flex shrink-0 items-center justify-end gap-1">
        {sheets.length > 0 && (
          <TechnicalSheetButton sheets={sheets} canSearch={canEditProducts} onSearch={() => setSheetFinderProduct(product)}
            className="flex h-9 w-9 items-center justify-center" iconClassName="h-4 w-4" />
        )}
        {canCreateQuote() && (
          <button onClick={() => handleAddToCart(product)} title="Ajouter au devis" aria-label={`Ajouter ${product.name} au devis`}
            className="flex h-9 items-center gap-1 rounded-lg border border-primary/30 px-2.5 text-xs font-semibold text-primary hover:bg-primary/10">
            <Plus className="h-3.5 w-3.5" />Devis
          </button>
        )}
        <RowMenu label={`Actions pour ${product.name}`} items={[
          { label: 'Aperçu rapide', icon: <Eye className="h-4 w-4 text-muted-foreground" />, onSelect: () => setQuickViewProduct(product) },
          { label: 'Fiche produit', icon: <Info className="h-4 w-4 text-muted-foreground" />, to: `/product/${encodeURIComponent(product.barcode)}` },
          ...(canEditProducts && !bulkMode ? [{ label: 'Modifier', icon: <Edit className="h-4 w-4 text-primary" />, onSelect: () => startEdit(product) }] : []),
          ...(canEditProducts && sheets.length === 0 ? [{ label: 'Rechercher une fiche technique', icon: <FileSearch className="h-4 w-4 text-muted-foreground" />, onSelect: () => setSheetFinderProduct(product) }] : []),
        ]} />
      </div>
    );
  })();

  const getSortIcon = (field: SortField) => {
    if (sortField !== field) return null;
    return sortOrder === 'asc' ? <SortAsc className="h-3 w-3" /> : <SortDesc className="h-3 w-3" />;
  };

  const formatCurrency = (n: number) => formatMoney(n);
  // Kiosk type and sectors are shown while classifying (bulk mode or a row
  // being edited) even when their columns are hidden; so are the edited fields.
  const showColumn = (key: OptionalColumn) => columns.includes(key)
    || ((key === 'kiosk' || key === 'sectors') && (bulkMode || !!editingBarcode))
    || ((key === 'buyprice' || key === 'provider') && !!editingBarcode);

  return (
    <div className={`mx-auto max-w-7xl space-y-4 ${bulkMode ? 'pb-48 sm:pb-28' : ''}`}>
      <PageHeader
        title="Produits"
        subtitle={`${products.length} produit${products.length !== 1 ? 's' : ''}`}
        actions={<>
          {!isMobile && <ColumnPicker options={COLUMN_OPTIONS} shown={columns} onToggle={toggleColumn} />}
          {canEditProducts && <>
            <button onClick={() => setManagingSectors(true)} className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-secondary">
              <Briefcase className="h-4 w-4" /><span className="sm:hidden">Secteurs</span><span className="hidden sm:inline">Gérer les secteurs</span>
            </button>
            <button onClick={bulkMode ? leaveBulk : startBulk} aria-pressed={bulkMode}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium ${bulkMode ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-foreground hover:bg-secondary'}`}>
              <ListChecks className="h-4 w-4" />{bulkMode
                ? <><span className="sm:hidden">Terminer</span><span className="hidden sm:inline">Quitter la modification groupée</span></>
                : 'Modification groupée'}
            </button>
          </>}
        </>}
      >
      <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
        <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <div className="flex gap-2 lg:col-span-1 xl:col-span-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input type="text" value={searchQuery} onChange={e => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                aria-label="Rechercher un produit"
                className="w-full rounded-lg border border-input bg-background py-2 pl-9 pr-3 text-sm text-foreground focus:ring-2 focus:ring-ring"
                placeholder="Nom, code-barres, marque…" />
            </div>
            {isMobile && (
              <button onClick={() => setShowFilters(open => !open)} aria-expanded={showFilters}
                className={`relative flex items-center gap-1.5 rounded-lg border px-3 text-sm ${showFilters ? 'border-primary text-primary' : 'border-input text-foreground'}`}>
                <SlidersHorizontal className="h-4 w-4" />Filtres
                {activeFilterCount > 0 && <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">{activeFilterCount}</span>}
              </button>
            )}
          </div>
          {(!isMobile || showFilters) && <>
          <select value={brandFilter} onChange={e => { setBrandFilter(e.target.value); setCurrentPage(1); }} aria-label="Marque"
            className="rounded-lg border border-input bg-background px-2.5 py-2 text-sm text-foreground">
            <option value="">Toutes les marques</option>
            {brands.map(b => <option key={b} value={b}>{getDisplayName('brand', b)}</option>)}
          </select>
          <select value={providerFilter} onChange={e => { setProviderFilter(e.target.value); setCurrentPage(1); }} aria-label="Fournisseur"
            className="rounded-lg border border-input bg-background px-2.5 py-2 text-sm text-foreground">
            <option value="">Tous les fournisseurs</option>
            {providers.map(p => <option key={p} value={p}>{getDisplayName('provider', p)}</option>)}
          </select>
          <select value={categoryFilter} onChange={e => { setCategoryFilter(e.target.value); setCurrentPage(1); }} aria-label="Type kiosque"
            className="rounded-lg border border-input bg-background px-2.5 py-2 text-sm text-foreground">
            <option value="">Tous les types kiosque</option>
            {KIOSK_CATEGORIES.map(category => <option key={category.value} value={category.value}>{category.label}</option>)}
          </select>
          <select value={sectorFilter} onChange={e => { setSectorFilter(e.target.value); setCurrentPage(1); }} aria-label="Secteur"
            className="rounded-lg border border-input bg-background px-2.5 py-2 text-sm text-foreground">
            <option value="">Tous les secteurs</option>
            {sectors.map(sector => <option key={sector.id} value={sector.id}>{sector.name}</option>)}
            <option value={NO_SECTOR}>Sans secteur</option>
          </select>
          {isMobile && (
            <select value={`${sortField}:${sortOrder}`} aria-label="Trier par"
              onChange={e => { const [field, order] = e.target.value.split(':'); setSortField(field as SortField); setSortOrder(order as SortOrder); }}
              className="rounded-lg border border-input bg-background px-2.5 py-2 text-sm text-foreground">
              <option value="name:asc">Nom (A → Z)</option>
              <option value="name:desc">Nom (Z → A)</option>
              <option value="price:asc">Prix de vente croissant</option>
              <option value="price:desc">Prix de vente décroissant</option>
              <option value="brand:asc">Marque (A → Z)</option>
              <option value="provider:asc">Fournisseur (A → Z)</option>
            </select>
          )}
          </>}
        </div>
        {(searchQuery || brandFilter || providerFilter || categoryFilter || sectorFilter) && (
          <button onClick={() => { setSearchQuery(''); setBrandFilter(''); setProviderFilter(''); setCategoryFilter(''); setSectorFilter(''); }}
            className="mt-2 flex items-center gap-1 px-1 text-xs text-muted-foreground hover:text-foreground">
            <X className="h-3 w-3" /><span>Effacer filtres</span>
          </button>
        )}
      </div>
      </PageHeader>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        {products.length === 0 ? (
          <div className="p-8 text-center">
            <Package className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <h3 className="text-base font-medium text-foreground">Aucun produit</h3>
          </div>
        ) : (
          <>
            {isMobile ? (
              <div className="divide-y divide-border">
                {bulkMode && (
                  <button onClick={togglePageSelection} className="flex w-full items-center gap-2 bg-secondary/60 px-3 py-2.5 text-xs text-muted-foreground">
                    {pageSelected ? <CheckSquare className="h-5 w-5 text-primary" /> : <Square className="h-5 w-5" />}
                    {pageSelected ? 'Désélectionner la page' : 'Sélectionner la page'}
                  </button>
                )}
                {currentProducts.map(product => {
                  const isEditing = editingBarcode === product.barcode;
                  const kioskCategory = shownKioskCategory(product);
                  const rowSectors = shownSectors(product);
                  const editClassification = canEditProducts && (bulkMode || isEditing);
                  const isSelected = selected.has(product.barcode);
                  return (
                    <div key={product.barcode} className={`p-3 ${pending[product.barcode] ? 'bg-amber-500/5' : isSelected ? 'bg-primary/5' : ''}`}>
                      <div className="flex gap-3">
                        {bulkMode && (
                          <button onClick={() => toggleSelected(product.barcode)} aria-label={`Sélectionner ${product.name}`} aria-pressed={isSelected} className="-ml-1 self-center p-1 text-muted-foreground">
                            {isSelected ? <CheckSquare className="h-5 w-5 text-primary" /> : <Square className="h-5 w-5" />}
                          </button>
                        )}
                        <button type="button" onClick={() => setQuickViewProduct(product)} title="Aperçu rapide"
                          className="h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-border bg-secondary/30 flex items-center justify-center">
                          {product.image
                            ? <img src={resolveProductImageUrl(product.image) || ''} alt={product.name} className="h-full w-full object-contain" loading="lazy" />
                            : <img src={`${import.meta.env.BASE_URL || '/'}stocky-logo.png`} alt="Stocky" className="h-9 w-9 object-contain opacity-35" />}
                        </button>
                        <div className="min-w-0 flex-1">
                          {isEditing ? (
                            <input type="text" value={editForm.name || ''} aria-label="Nom" onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                              className="w-full rounded border border-input bg-background px-2 py-1.5 text-sm text-foreground" />
                          ) : (
                            <Link to={`/product/${encodeURIComponent(product.barcode)}`} className="line-clamp-2 text-sm font-medium leading-snug text-foreground">{product.name}</Link>
                          )}
                          <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">{product.barcode}{product.brand ? ` · ${product.brand}` : ''}{product.provider && !isEditing ? ` · ${product.provider}` : ''}</p>
                          {isEditing ? (
                            <div className="mt-2 grid grid-cols-3 gap-2">
                              <label className="text-[10px] text-muted-foreground">Achat<input type="number" step="0.01" value={editForm.buyprice || 0} onChange={e => setEditForm(f => ({ ...f, buyprice: parseFloat(e.target.value) || 0 }))} className="mt-0.5 w-full rounded border border-input bg-background px-2 py-1.5 text-sm text-foreground" /></label>
                              <label className="text-[10px] text-muted-foreground">Vente<input type="number" step="0.01" value={editForm.price || 0} onChange={e => setEditForm(f => ({ ...f, price: parseFloat(e.target.value) || 0 }))} className="mt-0.5 w-full rounded border border-input bg-background px-2 py-1.5 text-sm text-foreground" /></label>
                              <label className="text-[10px] text-muted-foreground">Fournisseur<input type="text" value={editForm.provider || ''} onChange={e => setEditForm(f => ({ ...f, provider: e.target.value }))} className="mt-0.5 w-full rounded border border-input bg-background px-2 py-1.5 text-sm text-foreground" /></label>
                            </div>
                          ) : (
                            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                              <span className="text-sm font-semibold text-foreground">{formatCurrency(product.price)}</span>
                              <span className="text-[11px] text-muted-foreground">achat {formatCurrency(product.buyprice)}</span>
                              {renderStock(product)}
                            </div>
                          )}
                        </div>
                      </div>
                      {editClassification ? (
                        <>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            {renderKioskType(product, isEditing, editClassification, kioskCategory)}
                            {renderSectors(product, isEditing, editClassification, rowSectors)}
                          </div>
                          {isEditing && <div className="mt-2 flex justify-end">{renderActions(product, true)}</div>}
                        </>
                      ) : (
                        <div className="mt-2 flex items-center gap-2">
                          <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
                            {renderKioskType(product, false, false, kioskCategory)}
                            {renderSectors(product, false, false, rowSectors)}
                          </div>
                          {!bulkMode && renderActions(product, false)}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-secondary/40">
                  <tr>
                    {bulkMode && (
                      <th className="w-8 px-3 py-2">
                        <button onClick={togglePageSelection} aria-label={pageSelected ? 'Désélectionner la page' : 'Sélectionner la page'} className="text-muted-foreground hover:text-foreground">
                          {pageSelected ? <CheckSquare className="h-4 w-4 text-primary" /> : <Square className="h-4 w-4" />}
                        </button>
                      </th>
                    )}
                    <th className="w-16 px-3 py-2"><span className="sr-only">Image</span></th>
                    {([
                      ['name', 'Produit', true, ''],
                      ['brand', 'Marque', showColumn('brand'), ''],
                      ['buyprice', 'Achat', showColumn('buyprice'), 'text-right'],
                      ['price', 'Vente', true, 'text-right'],
                      ['provider', 'Fournisseur', showColumn('provider'), ''],
                    ] as [SortField, string, boolean, string][]).filter(([, , shown]) => shown).map(([field, label, , align]) => (
                      <th key={field} onClick={() => handleSort(field)} aria-sort={sortField === field ? (sortOrder === 'asc' ? 'ascending' : 'descending') : undefined}
                        className={`cursor-pointer px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground ${align || 'text-left'}`}>
                        <span className={`inline-flex items-center gap-1 ${align ? 'justify-end' : ''}`}>{label}{getSortIcon(field)}</span>
                      </th>
                    ))}
                    {showColumn('kiosk') && <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Type kiosque</th>}
                    {showColumn('sectors') && <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Secteur</th>}
                    {showColumn('stock') && <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Stock</th>}
                    <th className="px-3 py-2"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {currentProducts.map(product => {
                    const isEditing = editingBarcode === product.barcode;
                    const kioskCategory = shownKioskCategory(product);
                    const rowSectors = shownSectors(product);
                    const isPending = !!pending[product.barcode];
                    const editClassification = canEditProducts && (bulkMode || isEditing);
                    const isSelected = selected.has(product.barcode);
                    // A click on the row (not on a control) opens the quick view.
                    const openQuickView = (event: React.MouseEvent) => {
                      if (bulkMode || isEditing) return;
                      if ((event.target as HTMLElement).closest('a,button,input,select,label,[role="menu"],[role="dialog"]')) return;
                      setQuickViewProduct(product);
                    };
                    return (
                      <tr key={product.barcode} onClick={openQuickView}
                        className={`${isPending ? 'bg-amber-500/5 hover:bg-amber-500/10' : isSelected ? 'bg-primary/5' : 'hover:bg-secondary/60'} ${bulkMode || isEditing ? '' : 'cursor-pointer'}`}>
                        {bulkMode && (
                          <td className="px-3 py-2">
                            <button onClick={() => toggleSelected(product.barcode)} aria-label={`Sélectionner ${product.name}`} aria-pressed={isSelected} className="text-muted-foreground hover:text-foreground">
                              {isSelected ? <CheckSquare className="h-4 w-4 text-primary" /> : <Square className="h-4 w-4" />}
                            </button>
                          </td>
                        )}
                        <td className="px-3 py-2">
                          <button type="button" onClick={() => setQuickViewProduct(product)} title="Aperçu rapide"
                            className="flex h-14 w-11 items-center justify-center overflow-hidden rounded-md border border-border bg-white transition-colors hover:border-primary/60">
                            {product.image ? (
                              <img src={resolveProductImageUrl(product.image) || ''} alt={product.name} className="h-full w-full object-contain" loading="lazy" />
                            ) : (
                              <img src={`${import.meta.env.BASE_URL || '/'}stocky-logo.png`} alt="Stocky" className="h-7 w-7 object-contain opacity-35" />
                            )}
                          </button>
                        </td>
                        <td className="min-w-[14rem] max-w-md px-3 py-2">
                          {isEditing ? (
                            <input type="text" value={editForm.name || ''} aria-label="Nom" onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                              className="w-full rounded border border-input bg-background px-2 py-1 text-sm text-foreground" />
                          ) : (
                            <Link to={`/product/${encodeURIComponent(product.barcode)}`} title="Voir la fiche produit"
                              className="line-clamp-2 font-medium leading-snug text-foreground hover:text-primary hover:underline">
                              {product.name}
                            </Link>
                          )}
                          <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">{product.barcode}</p>
                        </td>
                        {showColumn('brand') && (
                          <td className="px-3 py-2 text-foreground">
                            {product.brand}
                            {getOriginalName('brand', product.brand) && (
                              <span className="ml-1 text-xs text-muted-foreground">(ex : {getOriginalName('brand', product.brand)})</span>
                            )}
                          </td>
                        )}
                        {showColumn('buyprice') && (
                          <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-muted-foreground">
                            {isEditing ? (
                              <input type="number" value={editForm.buyprice || 0} aria-label="Prix d’achat" onChange={e => setEditForm(f => ({ ...f, buyprice: parseFloat(e.target.value) || 0 }))}
                                className="w-24 rounded border border-input bg-background px-2 py-1 text-right text-sm text-foreground" step="0.01" />
                            ) : formatCurrency(product.buyprice)}
                          </td>
                        )}
                        <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums text-foreground">
                          {isEditing ? (
                            <input type="number" value={editForm.price || 0} aria-label="Prix de vente" onChange={e => setEditForm(f => ({ ...f, price: parseFloat(e.target.value) || 0 }))}
                              className="w-24 rounded border border-input bg-background px-2 py-1 text-right text-sm text-foreground" step="0.01" />
                          ) : formatCurrency(product.price)}
                        </td>
                        {showColumn('provider') && (
                          <td className="px-3 py-2 text-foreground">
                            {isEditing ? (
                              <input type="text" value={editForm.provider || ''} aria-label="Fournisseur" onChange={e => setEditForm(f => ({ ...f, provider: e.target.value }))}
                                className="w-28 rounded border border-input bg-background px-2 py-1 text-sm text-foreground" />
                            ) : (
                              <>
                                {product.provider || '—'}
                                {product.provider && getOriginalName('provider', product.provider) && (
                                  <span className="ml-1 text-xs text-muted-foreground">(ex : {getOriginalName('provider', product.provider)})</span>
                                )}
                              </>
                            )}
                          </td>
                        )}
                        {showColumn('kiosk') && <td className="px-3 py-2">{renderKioskType(product, isEditing, editClassification, kioskCategory)}</td>}
                        {showColumn('sectors') && <td className="px-3 py-2">{renderSectors(product, isEditing, editClassification, rowSectors)}</td>}
                        {showColumn('stock') && <td className="px-3 py-2">{renderStock(product)}</td>}
                        <td className="px-3 py-2">{renderActions(product, isEditing)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            )}
            {totalPages > 1 && (
              <div className="px-4 py-2.5 border-t border-border flex items-center justify-between">
                <div className="text-xs text-muted-foreground">
                  {startIdx + 1}-{Math.min(startIdx + PRODUCTS_PER_PAGE, filtered.length)} sur {filtered.length}
                </div>
                <div className="flex items-center space-x-1.5">
                  <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}
                    className="p-1 border border-border rounded hover:bg-secondary disabled:opacity-50"><ChevronLeft className="h-3.5 w-3.5" /></button>
                  <span className="px-2 text-xs text-muted-foreground">{currentPage}/{totalPages}</span>
                  <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}
                    className="p-1 border border-border rounded hover:bg-secondary disabled:opacity-50"><ChevronRight className="h-3.5 w-3.5" /></button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {sheetFinderProduct && (
        <TechnicalSheetFinder
          product={sheetFinderProduct}
          linkedSheetIds={(sheetLinks[sheetFinderProduct.barcode] || []).map(sheet => sheet.id)}
          onLinked={sheet => setSheetLinks(links => {
            const current = links[sheetFinderProduct.barcode] || [];
            if (current.some(linked => linked.id === sheet.id)) return links;
            return { ...links, [sheetFinderProduct.barcode]: [...current, { id: sheet.id, title: sheet.title, file_url: sheet.file_url }] };
          })}
          onClose={() => setSheetFinderProduct(null)}
        />
      )}

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
                <button onClick={() => setQuickViewProduct(null)} className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary" title="Fermer">
                  <X className="h-4 w-4" />
                </button>
              </div>

              {quickImageOpen && quickImageUrl && <ImageViewer src={quickImageUrl} alt={quickViewProduct.name} onClose={() => setQuickImageOpen(false)} />}
              <div className="p-4 grid md:grid-cols-[240px_1fr] gap-5">
                <div className="mx-auto w-full max-w-[15rem] md:max-w-none aspect-[4/5] rounded-xl border border-border bg-secondary/20 overflow-hidden flex items-center justify-center">
                  {quickImageUrl ? (
                    <button type="button" onClick={() => setQuickImageOpen(true)} aria-label="Agrandir l’image" className="h-full w-full cursor-zoom-in">
                      <img src={quickImageUrl} alt={quickViewProduct.name} className="w-full h-full object-contain" />
                    </button>
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
                    <Link to={`/product/${encodeURIComponent(quickViewProduct.barcode)}`} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border hover:bg-secondary text-sm">
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

      {bulkMode && (
        <div role="region" aria-label="Modification groupée" className="fixed inset-x-2 bottom-[4.5rem] z-40 mx-auto max-w-5xl rounded-xl border border-border bg-card/95 p-2.5 text-xs shadow-2xl backdrop-blur sm:inset-x-3 sm:bottom-3 sm:right-20">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <span className="font-medium text-foreground">{selected.size} sélectionné(s)</span>
            {isMobile && (
              <button onClick={() => setBulkBarOpen(open => !open)} aria-expanded={bulkBarOpen} aria-label={bulkBarOpen ? 'Réduire la barre' : 'Afficher les actions'}
                className="rounded-md border border-border p-1 text-muted-foreground">
                {bulkBarOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
              </button>
            )}
            {(!isMobile || bulkBarOpen) && <>
            {filtered.length > selected.size && (
              <button onClick={() => setSelected(new Set(filtered.map(product => product.barcode)))} className="text-primary hover:underline">
                Sélectionner les {filtered.length} produits filtrés
              </button>
            )}
            {selected.size > 0 && <button onClick={() => setSelected(new Set())} className="text-muted-foreground hover:underline">Désélectionner</button>}
            <span className="mx-1 hidden h-4 w-px bg-border sm:block" />
            <div className="-mx-1 flex w-full gap-2 overflow-x-auto px-1 sm:mx-0 sm:w-auto sm:overflow-visible sm:px-0">
            <select value="" disabled={!selected.size} aria-label="Type kiosque pour la sélection"
              onChange={e => { const value = e.target.value; if (value) applyToSelection(() => ({ kiosk_category: value === 'none' ? null : value })); }}
              className="shrink-0 rounded-md border border-input bg-background px-2 py-1.5 disabled:opacity-50 sm:py-1">
              <option value="">Type kiosque…</option>
              <option value="none">Non classé</option>
              {KIOSK_CATEGORIES.map(category => <option key={category.value} value={category.value}>{category.label}</option>)}
            </select>
            <select value="" disabled={!selected.size} aria-label="Ajouter un secteur à la sélection"
              onChange={e => { const id = e.target.value; if (id) applyToSelection(product => ({ sector_ids: [...new Set([...shownSectors(product), id])] })); }}
              className="shrink-0 rounded-md border border-input bg-background px-2 py-1.5 disabled:opacity-50 sm:py-1">
              <option value="">Ajouter un secteur…</option>
              {sectors.map(sector => <option key={sector.id} value={sector.id}>{sector.name}</option>)}
            </select>
            <select value="" disabled={!selected.size} aria-label="Retirer un secteur de la sélection"
              onChange={e => { const id = e.target.value; if (id) applyToSelection(product => ({ sector_ids: shownSectors(product).filter(item => item !== id) })); }}
              className="shrink-0 rounded-md border border-input bg-background px-2 py-1.5 disabled:opacity-50 sm:py-1">
              <option value="">Retirer un secteur…</option>
              {sectors.map(sector => <option key={sector.id} value={sector.id}>{sector.name}</option>)}
            </select>
            </div>
            </>}
            <div className={`ml-auto flex items-center justify-end gap-2 sm:w-auto ${isMobile && bulkBarOpen ? 'w-full' : ''}`} aria-live="polite">
              {bulkError ? (
                <>
                  <span className="inline-flex items-center gap-1 font-medium text-destructive"><AlertTriangle className="h-3.5 w-3.5" />{bulkError}</span>
                  <button onClick={() => { setBulkError(''); flushPending(); }} className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 hover:bg-secondary"><RotateCcw className="h-3.5 w-3.5" />Réessayer</button>
                </>
              ) : savingBulk ? (
                <span className="inline-flex items-center gap-1 text-muted-foreground"><Loader className="h-3.5 w-3.5 animate-spin" />Enregistrement…</span>
              ) : pendingCount ? (
                <span className="font-medium text-amber-600">{pendingCount} <span className="sm:hidden">en attente…</span><span className="hidden sm:inline">produit(s) en attente d’enregistrement…</span></span>
              ) : bulkSavedCount ? (
                <span className="inline-flex items-center gap-1 text-emerald-600"><CheckCircle2 className="h-3.5 w-3.5" /><span className="sm:hidden">Enregistré</span><span className="hidden sm:inline">Modifications enregistrées</span></span>
              ) : (
                <span className="text-muted-foreground"><span className="sm:hidden">Auto</span><span className="hidden sm:inline">Enregistrement automatique</span></span>
              )}
              <button onClick={() => flushPending()} disabled={!pendingCount || savingBulk} aria-label="Enregistrer" className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 font-medium text-primary-foreground disabled:opacity-40 sm:py-1">
                <Save className="h-3.5 w-3.5" /><span className="hidden sm:inline">Enregistrer</span>
              </button>
              <button onClick={leaveBulk} className="rounded-md border border-border px-2.5 py-1.5 hover:bg-secondary sm:py-1">Terminer</button>
            </div>
          </div>
        </div>
      )}

      {managingSectors && <SectorManagerDialog sectors={sectors} productCounts={sectorCounts} canDelete={isStock} onClose={() => setManagingSectors(false)} />}

      {/* Stats */}
      {filtered.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
            <p className="text-[11px] text-muted-foreground">Produits affichés</p>
            <p className="text-base font-bold text-foreground">{filtered.length}</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
            <p className="text-[11px] text-muted-foreground">Marques</p>
            <p className="text-base font-bold text-foreground">{new Set(filtered.map(p => p.brand)).size}</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
            <p className="text-[11px] text-muted-foreground">Stock total</p>
            <p className="text-base font-bold text-foreground">
              {filtered.reduce((s, p) => s + Object.values(p.stock_levels || {}).reduce((a: number, v: any) => a + (Number(v) || 0), 0), 0)}
            </p>
          </div>
          <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
            <p className="text-[11px] text-muted-foreground">Fournisseurs</p>
            <p className="text-base font-bold text-foreground">{new Set(filtered.map(p => p.provider).filter(Boolean)).size}</p>
          </div>
        </div>
      )}
    </div>
  );
}
