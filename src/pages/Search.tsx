import React, { useEffect, useRef, useCallback, useState } from 'react';
import { Search, Package, ArrowRight, Home, AlertCircle, SortAsc, SortDesc, Filter, ScanLine, Plus, X, Paperclip } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useSearchState } from '../hooks/useSearchState';
import { useAppContext } from '../context/AppContext';
import { BarcodeScanner } from '../components/BarcodeScanner';
import { useQuoteCart } from '../hooks/useQuoteCart';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../hooks/useAuth';
import { Product } from '../types';

export function SearchPage() {
  const navigate = useNavigate();
  const { state } = useAppContext();
  const { canAccessStockLocation, canAccessBrand, canCreateQuote, getDisplayPrice } = useAuth();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [showScanner, setShowScanner] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [addedProductIds, setAddedProductIds] = useState<Set<string>>(new Set());
  
  const { addToCart } = useQuoteCart();
  const { showToast } = useToast();
  
  const {
    query, setQuery, selectedBrand, setSelectedBrand,
    selectedStockLocation, setSelectedStockLocation,
    results, isLoading, searchError,
    sortBy, setSortBy, sortOrder, setSortOrder,
    restoreScrollPosition, saveScrollPosition, clearSearchState
  } = useSearchState();

  const uniqueBrands = React.useMemo(() => {
    const brands = new Set<string>();
    state.products.forEach(product => {
      const hasAccessibleStock = Object.keys(product.stock_levels || {}).some(location => 
        canAccessStockLocation(location) && (product.stock_levels[location] || 0) > 0
      );
      const hasAccessibleBrand = canAccessBrand(product.brand || '');
      if (!hasAccessibleStock || !hasAccessibleBrand) return;
      if (product.brand && product.brand.trim()) brands.add(product.brand.trim());
    });
    return Array.from(brands).sort();
  }, [state.products, canAccessStockLocation, canAccessBrand]);

  const uniqueStockLocations = React.useMemo(() => {
    const locations = new Set<string>();
    state.products.forEach(product => {
      if (product.stock_levels) {
        Object.keys(product.stock_levels).forEach(location => {
          if (canAccessStockLocation(location) && product.stock_levels[location] > 0) locations.add(location);
        });
      }
    });
    return Array.from(locations).sort();
  }, [state.products, canAccessStockLocation]);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth <= 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    if (results.length > 0) {
      const timer = setTimeout(() => restoreScrollPosition(), 100);
      return () => clearTimeout(timer);
    }
  }, [results, restoreScrollPosition]);

  useEffect(() => {
    const handleScroll = () => {
      const mainContainer = document.querySelector('main');
      if (mainContainer) saveScrollPosition(mainContainer.scrollTop);
    };
    const mainContainer = document.querySelector('main');
    if (mainContainer) {
      mainContainer.addEventListener('scroll', handleScroll, { passive: true });
      return () => mainContainer.removeEventListener('scroll', handleScroll);
    }
  }, [saveScrollPosition]);

  useEffect(() => {
    if (!query && inputRef.current && !showScanner) inputRef.current.focus();
  }, [query, showScanner]);

  const handleClearSearch = useCallback(() => {
    clearSearchState();
    if (inputRef.current) inputRef.current.focus();
  }, [clearSearchState]);

  const toggleSortOrder = useCallback(() => {
    setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
  }, [sortOrder, setSortOrder]);

  const handleBarcodeScanned = useCallback((barcode: string) => {
    setQuery(barcode);
    setShowScanner(false);
    if ('vibrate' in navigator) navigator.vibrate(100);
  }, [setQuery]);

  const handleAddToCart = useCallback((product: Product, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!canCreateQuote()) {
      showToast({ type: 'error', title: 'Accès refusé', message: 'Vous n\'avez pas l\'autorisation de créer des devis' });
      return;
    }
    const savedMargin = localStorage.getItem('inventory_margin_percentage');
    const marginPercentage = savedMargin ? parseInt(savedMargin) : 20;
    addToCart(product, 'normal', marginPercentage);
    showToast({ type: 'success', message: `${product.name} ajouté au panier de devis` });
    setAddedProductIds(prev => new Set(prev).add(product.barcode));
    setTimeout(() => {
      setAddedProductIds(prev => { const s = new Set(prev); s.delete(product.barcode); return s; });
    }, 2000);
    if ('vibrate' in navigator) navigator.vibrate(100);
  }, [addToCart, showToast, canCreateQuote]);

  const getSortLabel = (field: string) => {
    const labels: Record<string, string> = { name: 'Nom', price: 'Prix', brand: 'Marque', stock: 'Stock' };
    return labels[field] || field;
  };

  const filteredResults = React.useMemo(() => {
    return results.filter(product => {
      const hasAccessibleStock = Object.keys(product.stock_levels || {}).some(location => 
        canAccessStockLocation(location) && (product.stock_levels[location] || 0) > 0
      );
      return hasAccessibleStock && canAccessBrand(product.brand || '');
    });
  }, [results, canAccessStockLocation, canAccessBrand]);

  return (
    <div className="max-w-4xl mx-auto">
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-primary rounded-2xl mb-4" style={{ boxShadow: 'var(--shadow-glow)' }}>
          <Search className="h-8 w-8 text-primary-foreground" />
        </div>
        <h1 className="text-3xl font-bold text-foreground mb-2">Rechercher Produits</h1>
        <p className="text-muted-foreground">Trouvez des produits par barcode, nom ou marque</p>
      </div>

      {/* Search Input */}
      <div className="glass rounded-2xl shadow-xl p-6 md:p-8 mb-8">
        <div className="relative flex items-center space-x-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Entrez l'identifiant, nom du produit ou marque... (min. 3 caractères)"
              className="w-full pl-12 pr-4 py-4 text-lg border-2 border-input rounded-xl focus:ring-4 focus:ring-ring/30 focus:border-ring transition-all duration-200 bg-background text-foreground placeholder-muted-foreground shadow-inner"
            />
            {query && (
              <button onClick={handleClearSearch} className="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground p-1 hover:bg-accent rounded-full transition-colors">
                ✕
              </button>
            )}
          </div>
          {isMobile && (
            <button onClick={() => setShowScanner(true)} className="flex items-center justify-center w-14 h-14 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl transition-all duration-200 shadow-lg" title="Scanner code-barres">
              <ScanLine className="h-7 w-7" />
            </button>
          )}
        </div>

        {isMobile && (
          <div className="mt-4 flex items-center justify-center space-x-2 text-sm text-muted-foreground bg-accent/50 rounded-lg py-2 px-4">
            <ScanLine className="h-4 w-4" />
            <span className="font-medium">Appuyez sur l'icône pour scanner un code-barres</span>
          </div>
        )}

        {query.length > 0 && query.length < 3 && !selectedBrand && !selectedStockLocation && (
          <div className="mt-3 text-sm text-amber-600 bg-amber-500/10 rounded-lg py-2 px-4 border border-amber-500/20">
            Tapez au moins {3 - query.length} caractère{3 - query.length > 1 ? 's' : ''} de plus pour commencer la recherche
          </div>
        )}

        {/* Filters */}
        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-semibold text-foreground mb-3">Filtrer par Marque</label>
            <div className="relative">
              <select value={selectedBrand} onChange={(e) => setSelectedBrand(e.target.value)}
                className="w-full px-4 py-3 border-2 border-input rounded-xl focus:ring-4 focus:ring-ring/30 focus:border-ring transition-all bg-background text-foreground shadow-sm">
                <option value="">Toutes les marques</option>
                {uniqueBrands.map((brand) => <option key={brand} value={brand}>{brand}</option>)}
              </select>
              {selectedBrand && (
                <button onClick={() => setSelectedBrand('')} className="absolute right-8 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground p-1 hover:bg-accent rounded-full transition-colors" title="Effacer le filtre">
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
          <div>
            <label className="block text-sm font-semibold text-foreground mb-3">Filtrer par Emplacement</label>
            <div className="relative">
              <select value={selectedStockLocation} onChange={(e) => setSelectedStockLocation(e.target.value)}
                className="w-full px-4 py-3 border-2 border-input rounded-xl focus:ring-4 focus:ring-ring/30 focus:border-ring transition-all bg-background text-foreground shadow-sm">
                <option value="">Tous les emplacements</option>
                {uniqueStockLocations.map((location) => (
                  <option key={location} value={location}>{location.replace(/_/g, ' ').charAt(0).toUpperCase() + location.replace(/_/g, ' ').slice(1)}</option>
                ))}
              </select>
              {selectedStockLocation && (
                <button onClick={() => setSelectedStockLocation('')} className="absolute right-8 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground p-1 hover:bg-accent rounded-full transition-colors" title="Effacer le filtre">
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Active Filters */}
        {(selectedBrand || selectedStockLocation) && (
          <div className="mt-4 flex flex-wrap gap-3">
            <span className="text-sm font-medium text-muted-foreground">Filtres actifs:</span>
            {selectedBrand && (
              <span className="inline-flex items-center px-3 py-1.5 bg-primary/10 text-primary text-xs font-medium rounded-full border border-primary/20">
                Marque: {selectedBrand}
                <button onClick={() => setSelectedBrand('')} className="ml-2 hover:text-primary/70 p-0.5 rounded-full transition-colors"><X className="h-3 w-3" /></button>
              </span>
            )}
            {selectedStockLocation && (
              <span className="inline-flex items-center px-3 py-1.5 bg-emerald-500/10 text-emerald-500 text-xs font-medium rounded-full border border-emerald-500/20">
                Emplacement: {selectedStockLocation.replace(/_/g, ' ')}
                <button onClick={() => setSelectedStockLocation('')} className="ml-2 hover:text-emerald-400 p-0.5 rounded-full transition-colors"><X className="h-3 w-3" /></button>
              </span>
            )}
            <button onClick={() => { setSelectedBrand(''); setSelectedStockLocation(''); }} className="text-xs text-muted-foreground hover:text-foreground hover:underline transition-colors font-medium">
              Effacer tous les filtres
            </button>
          </div>
        )}
      </div>

      {/* Sorting */}
      {filteredResults.length > 0 && (
        <div className="glass rounded-xl shadow-lg p-4 mb-6">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center space-x-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium text-foreground">Trier par:</span>
            </div>
            <div className="flex items-center space-x-2">
              {(['name', 'price', 'brand', 'stock'] as const).map((field) => (
                <button key={field} onClick={() => setSortBy(field)}
                  className={`px-3 py-1 rounded-lg text-sm transition-colors ${sortBy === field ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground hover:bg-accent'}`}>
                  {getSortLabel(field)}
                </button>
              ))}
              <button onClick={toggleSortOrder} className="flex items-center space-x-1 px-3 py-1 bg-secondary text-secondary-foreground hover:bg-accent rounded-lg transition-colors">
                {sortOrder === 'asc' ? <SortAsc className="h-4 w-4" /> : <SortDesc className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Error */}
      {searchError && (
        <div className="mb-6 p-4 bg-destructive/10 border border-destructive/20 rounded-lg flex items-center space-x-3">
          <AlertCircle className="h-5 w-5 text-destructive flex-shrink-0" />
          <div>
            <p className="text-destructive font-medium">Erreur de Recherche</p>
            <p className="text-destructive/80 text-sm">{searchError}</p>
          </div>
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
          <p className="text-muted-foreground mt-2">Recherche...</p>
        </div>
      )}

      {/* No Results */}
      {!isLoading && ((query.length >= 3) || selectedBrand || selectedStockLocation) && filteredResults.length === 0 && !searchError && (
        <div className="text-center py-8">
          <Package className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground mb-4">
            Aucun produit trouvé pour les critères sélectionnés
            {query && <><br />Recherche: "{query}"</>}
            {selectedBrand && <><br />Marque: {selectedBrand}</>}
            {selectedStockLocation && <><br />Emplacement: {selectedStockLocation.replace(/_/g, ' ')}</>}
          </p>
          <button onClick={() => navigate('/')} className="flex items-center space-x-2 px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg transition-colors mx-auto">
            <Home className="h-4 w-4" /><span>Retour à l'accueil</span>
          </button>
        </div>
      )}

      {/* Results */}
      {filteredResults.length > 0 && (
        <div className="space-y-4" ref={scrollContainerRef}>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground">
              {filteredResults.length} produit{filteredResults.length !== 1 ? 's' : ''} trouvé{filteredResults.length !== 1 ? 's' : ''}
            </h2>
            <div className="text-sm text-muted-foreground">Trié par {getSortLabel(sortBy)} ({sortOrder === 'asc' ? 'croissant' : 'décroissant'})</div>
          </div>
          <div className="space-y-2">
            {filteredResults.map((product) => {
              const accessibleStockLevels = Object.entries(product.stock_levels || {}).filter(([location]) => canAccessStockLocation(location));
              const totalStock = accessibleStockLevels.reduce((sum, [, level]) => sum + level, 0);
              const displayPrice = getDisplayPrice(product);
              const isAdded = addedProductIds.has(product.barcode);
              return (
                <div key={product.barcode} className="glass rounded-lg px-3 py-2.5 shadow hover:shadow-md transition-all duration-200 group">
                  <div className="flex items-center justify-between gap-3">
                    <Link to={`/product/${encodeURIComponent(product.barcode)}`} className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-foreground text-sm truncate">{product.name}</h3>
                        {product.brand && <span className="px-1.5 py-0.5 bg-primary/10 text-primary text-[11px] rounded font-medium shrink-0">{product.brand}</span>}
                        {product.provider && <span className="px-1.5 py-0.5 bg-orange-500/10 text-orange-500 text-[11px] rounded font-medium shrink-0 hidden sm:inline">{product.provider}</span>}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                        <span>#{product.barcode}</span>
                        <span className="font-semibold text-emerald-500">{displayPrice.toFixed(2)} Dh</span>
                        <span>Stock: {totalStock}</span>
                        {accessibleStockLevels.map(([location, level]) => (
                          <span key={location} className="px-1.5 py-0.5 bg-secondary text-secondary-foreground rounded capitalize hidden md:inline">
                            {location.replace(/_/g, ' ')}: {level}
                          </span>
                        ))}
                      </div>
                    </Link>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {canCreateQuote() && (
                        <button onClick={(e) => handleAddToCart(product, e)}
                          className={`p-1.5 rounded-lg transition-all duration-200 ${
                            isAdded ? 'bg-emerald-600 text-white' : 'bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm'
                          }`}>
                          {isAdded ? <span className="text-xs px-0.5">✓</span> : <Plus className="h-4 w-4" />}
                        </button>
                      )}
                      <Link to={`/product/${encodeURIComponent(product.barcode)}`} className="p-1.5 text-muted-foreground hover:text-primary transition-colors">
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <BarcodeScanner isOpen={showScanner} onScan={handleBarcodeScanned} onClose={() => setShowScanner(false)} />
    </div>
  );
}