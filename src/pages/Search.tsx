import React, { useEffect, useRef, useCallback, useState } from 'react';
import { Search, Package, ArrowRight, Home, AlertCircle, SortAsc, SortDesc, Filter, ScanLine, Plus, X } from 'lucide-react';
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
    query,
    setQuery,
    selectedBrand,
    setSelectedBrand,
    selectedStockLocation,
    setSelectedStockLocation,
    results,
    isLoading,
    searchError,
    sortBy,
    setSortBy,
    sortOrder,
    setSortOrder,
    restoreScrollPosition,
    saveScrollPosition,
    clearSearchState
  } = useSearchState();

  // Get unique brands and stock locations from all products (filtered by user permissions)
  const uniqueBrands = React.useMemo(() => {
    const brands = new Set<string>();
    state.products.forEach(product => {
      // Only include products from accessible stock locations
      const hasAccessibleStock = Object.keys(product.stock_levels || {}).some(location => 
        canAccessStockLocation(location) && (product.stock_levels[location] || 0) > 0
      );
      
      // Only include brands that user has access to
      const hasAccessibleBrand = canAccessBrand(product.brand || '');
      
      if (!hasAccessibleStock || !hasAccessibleBrand) return;
      
      if (product.brand && product.brand.trim()) {
        brands.add(product.brand.trim());
      }
    });
    return Array.from(brands).sort();
  }, [state.products, canAccessStockLocation, canAccessBrand]);

  const uniqueStockLocations = React.useMemo(() => {
    const locations = new Set<string>();
    state.products.forEach(product => {
      if (product.stock_levels) {
        Object.keys(product.stock_levels).forEach(location => {
          if (canAccessStockLocation(location) && product.stock_levels[location] > 0) {
            locations.add(location);
          }
        });
      }
    });
    return Array.from(locations).sort();
  }, [state.products, canAccessStockLocation]);
  // Detect if device is mobile
  useEffect(() => {
    const checkMobile = () => {
      const mobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
                    window.innerWidth <= 768;
      setIsMobile(mobile);
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Restore scroll position when component mounts or results change
  useEffect(() => {
    if (results.length > 0) {
      // Small delay to ensure DOM is rendered
      const timer = setTimeout(() => {
        restoreScrollPosition();
      }, 100);
      
      return () => clearTimeout(timer);
    }
  }, [results, restoreScrollPosition]);

  // Set up scroll position tracking
  useEffect(() => {
    const handleScroll = () => {
      const mainContainer = document.querySelector('main');
      if (mainContainer) {
        saveScrollPosition(mainContainer.scrollTop);
      }
    };

    const mainContainer = document.querySelector('main');
    if (mainContainer) {
      mainContainer.addEventListener('scroll', handleScroll, { passive: true });
      return () => mainContainer.removeEventListener('scroll', handleScroll);
    }
  }, [saveScrollPosition]);

  // Focus input when component mounts (but only if no query exists)
  useEffect(() => {
    if (!query && inputRef.current && !showScanner) {
      inputRef.current.focus();
    }
  }, [query, showScanner]);

  const handleClearSearch = useCallback(() => {
    clearSearchState();
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, [clearSearchState]);

  const toggleSortOrder = useCallback(() => {
    setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
  }, [sortOrder, setSortOrder]);

  const handleBarcodeScanned = useCallback((barcode: string) => {
    console.log('Barcode scanned:', barcode);
    setQuery(barcode);
    setShowScanner(false);
    
    // Trigger haptic feedback if available
    if ('vibrate' in navigator) {
      navigator.vibrate(100);
    }
  }, [setQuery]);

  const handleAddToCart = useCallback((product: Product, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    
    if (!canCreateQuote()) {
      showToast({
        type: 'error',
        title: 'Accès refusé',
        message: 'Vous n\'avez pas l\'autorisation de créer des devis'
      });
      return;
    }
    
    // Get saved margin percentage or use default
    const savedMargin = localStorage.getItem('inventory_margin_percentage');
    const marginPercentage = savedMargin ? parseInt(savedMargin) : 20;
    
    // Add to cart with normal price type and saved margin
    addToCart(product, 'normal', marginPercentage);
    
    // Show toast notification
    showToast({
      type: 'success',
      message: `${product.name} ajouté au panier de devis`
    });
    
    // Show temporary feedback
    setAddedProductIds(prev => new Set(prev).add(product.barcode));
    setTimeout(() => {
      setAddedProductIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(product.barcode);
        return newSet;
      });
    }, 2000);
    
    // Trigger haptic feedback if available
    if ('vibrate' in navigator) {
      navigator.vibrate(100);
    }
  }, [addToCart, showToast, canCreateQuote]);

  const getSortIcon = () => {
    return sortOrder === 'asc' ? <SortAsc className="h-4 w-4" /> : <SortDesc className="h-4 w-4" />;
  };

  const getSortLabel = (field: string) => {
    const labels = {
      name: 'Nom',
      price: 'Prix',
      brand: 'Marque',
      stock: 'Stock'
    };
    return labels[field as keyof typeof labels] || field;
  };

  // Filter results based on user permissions
  const filteredResults = React.useMemo(() => {
    return results.filter(product => {
      // Check if user has access to any stock location for this product
      const hasAccessibleStock = Object.keys(product.stock_levels || {}).some(location => 
        canAccessStockLocation(location) && (product.stock_levels[location] || 0) > 0
      );
      
      // Check if user has access to this brand
      const hasAccessibleBrand = canAccessBrand(product.brand || '');
      
      return hasAccessibleStock && hasAccessibleBrand;
    });
  }, [results, canAccessStockLocation, canAccessBrand]);
  return (
    <div className="max-w-4xl mx-auto">
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-r from-blue-500 to-blue-600 rounded-2xl mb-4">
          <Search className="h-8 w-8 text-white" />
        </div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
          Rechercher Produits
        </h1>
        <p className="text-gray-600 dark:text-gray-400">
          Trouvez des produits par barcode, nom ou marque
        </p>
      </div>

      {/* Search Input with Barcode Scanner */}
      <div className="bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm rounded-3xl shadow-2xl p-8 mb-8 border border-white/30">
        <div className="relative flex items-center space-x-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Entrez l'identifiant, nom du produit ou marque... (min. 3 caractères)"
              className="w-full pl-12 pr-4 py-4 text-lg border-2 border-gray-300 dark:border-gray-600 rounded-xl focus:ring-4 focus:ring-blue-500/50 focus:border-blue-500 transition-all duration-200 bg-white dark:bg-slate-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 shadow-inner"
            />
            {query && (
              <button
                onClick={handleClearSearch}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1 hover:bg-gray-100 dark:hover:bg-gray-600 rounded-full transition-colors"
              >
                ✕
              </button>
            )}
          </div>

          {/* Barcode Scanner Button - Mobile Only */}
          {isMobile && (
            <button
              onClick={() => setShowScanner(true)}
              className="flex items-center justify-center w-14 h-14 bg-gradient-to-r from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700 text-white rounded-xl transition-all duration-200 shadow-lg hover:shadow-xl transform hover:scale-105 active:scale-95"
              title="Scanner code-barres"
            >
              <ScanLine className="h-7 w-7" />
            </button>
          )}
        </div>

        {/* Mobile Scanner Hint */}
        {isMobile && (
          <div className="mt-4 flex items-center justify-center space-x-2 text-sm text-gray-600 dark:text-gray-400 bg-purple-50 dark:bg-purple-900/20 rounded-lg py-2 px-4">
            <ScanLine className="h-4 w-4" />
            <span className="font-medium">Appuyez sur l'icône pour scanner un code-barres</span>
          </div>
        )}

        {/* Character Count Indicator */}
        {query.length > 0 && query.length < 3 && !selectedBrand && !selectedStockLocation && (
          <div className="mt-3 text-sm text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-lg py-2 px-4 border border-amber-200 dark:border-amber-800">
            Tapez au moins {3 - query.length} caractère{3 - query.length > 1 ? 's' : ''} de plus pour commencer la recherche
          </div>
        )}

        {/* Search Filters */}
        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Brand Filter */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
              Filtrer par Marque
            </label>
            <div className="relative">
              <select
                value={selectedBrand}
                onChange={(e) => setSelectedBrand(e.target.value)}
                className="w-full px-4 py-3 border-2 border-gray-300 dark:border-gray-600 rounded-xl focus:ring-4 focus:ring-blue-500/50 focus:border-blue-500 transition-all duration-200 bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm"
              >
                <option value="">Toutes les marques</option>
                {uniqueBrands.map((brand) => (
                  <option key={brand} value={brand}>
                    {brand}
                  </option>
                ))}
              </select>
              {selectedBrand && (
                <button
                  onClick={() => setSelectedBrand('')}
                  className="absolute right-8 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1 hover:bg-gray-100 dark:hover:bg-gray-600 rounded-full transition-colors"
                  title="Effacer le filtre"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>

          {/* Stock Location Filter */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
              Filtrer par Emplacement
            </label>
            <div className="relative">
              <select
                value={selectedStockLocation}
                onChange={(e) => setSelectedStockLocation(e.target.value)}
                className="w-full px-4 py-3 border-2 border-gray-300 dark:border-gray-600 rounded-xl focus:ring-4 focus:ring-blue-500/50 focus:border-blue-500 transition-all duration-200 bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm"
              >
                <option value="">Tous les emplacements</option>
                {uniqueStockLocations.map((location) => (
                  <option key={location} value={location}>
                    {location.replace(/_/g, ' ').charAt(0).toUpperCase() + location.replace(/_/g, ' ').slice(1)}
                  </option>
                ))}
              </select>
              {selectedStockLocation && (
                <button
                  onClick={() => setSelectedStockLocation('')}
                  className="absolute right-8 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1 hover:bg-gray-100 dark:hover:bg-gray-600 rounded-full transition-colors"
                  title="Effacer le filtre"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Active Filters Display */}
        {(selectedBrand || selectedStockLocation) && (
          <div className="mt-4 flex flex-wrap gap-3">
            <span className="text-sm font-medium text-gray-600 dark:text-gray-400">Filtres actifs:</span>
            {selectedBrand && (
              <span className="inline-flex items-center px-3 py-1.5 bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200 text-xs font-medium rounded-full border border-blue-200 dark:border-blue-800">
                Marque: {selectedBrand}
                <button
                  onClick={() => setSelectedBrand('')}
                  className="ml-2 hover:text-blue-600 dark:hover:text-blue-300 p-0.5 hover:bg-blue-200 dark:hover:bg-blue-800 rounded-full transition-colors"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            )}
            {selectedStockLocation && (
              <span className="inline-flex items-center px-3 py-1.5 bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200 text-xs font-medium rounded-full border border-green-200 dark:border-green-800">
                Emplacement: {selectedStockLocation.replace(/_/g, ' ')}
                <button
                  onClick={() => setSelectedStockLocation('')}
                  className="ml-2 hover:text-green-600 dark:hover:text-green-300 p-0.5 hover:bg-green-200 dark:hover:bg-green-800 rounded-full transition-colors"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            )}
            <button
              onClick={() => {
                setSelectedBrand('');
                setSelectedStockLocation('');
              }}
              className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:underline transition-colors font-medium"
            >
              Effacer tous les filtres
            </button>
          </div>
        )}
      </div>

      {/* Sorting Controls */}
      {filteredResults.length > 0 && (
        <div className="bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm rounded-xl shadow-lg p-4 mb-6">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center space-x-2">
              <Filter className="h-4 w-4 text-gray-500" />
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Trier par:</span>
            </div>
            
            <div className="flex items-center space-x-2">
              {(['name', 'price', 'brand', 'stock'] as const).map((field) => (
                <button
                  key={field}
                  onClick={() => setSortBy(field)}
                  className={`px-3 py-1 rounded-lg text-sm transition-colors ${
                    sortBy === field
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                  }`}
                >
                  {getSortLabel(field)}
                </button>
              ))}
              
              <button
                onClick={toggleSortOrder}
                className="flex items-center space-x-1 px-3 py-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
              >
                {getSortIcon()}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Error Display */}
      {searchError && (
        <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-center space-x-3">
          <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400 flex-shrink-0" />
          <div>
            <p className="text-red-700 dark:text-red-300 font-medium">Erreur de Recherche</p>
            <p className="text-red-600 dark:text-red-400 text-sm">{searchError}</p>
            <p className="text-red-500 dark:text-red-500 text-xs mt-1">
              Si ce problème persiste, veuillez vérifier la console du navigateur pour plus de détails.
            </p>
          </div>
        </div>
      )}

      {/* Loading State */}
      {isLoading && (
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
          <p className="text-gray-600 dark:text-gray-400 mt-2">Recherche...</p>
        </div>
      )}

      {/* No Results */}
      {!isLoading && ((query.length >= 3) || selectedBrand || selectedStockLocation) && filteredResults.length === 0 && !searchError && (
        <div className="text-center py-8">
          <Package className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            Aucun produit trouvé pour les critères sélectionnés
            {query && <><br />Recherche: "{query}"</>}
            {selectedBrand && <><br />Marque: {selectedBrand}</>}
            {selectedStockLocation && <><br />Emplacement: {selectedStockLocation.replace(/_/g, ' ')}</>}
          </p>
          <div className="space-y-2">
            <button
              onClick={() => navigate('/')}
              className="flex items-center space-x-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors mx-auto"
            >
              <Home className="h-4 w-4" />
              <span>Retour à l'accueil</span>
            </button>
            {isMobile && (
              <button
                onClick={() => setShowScanner(true)}
                className="flex items-center space-x-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors mx-auto"
              >
                <ScanLine className="h-4 w-4" />
                <span>Scanner un code-barres</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Search Results */}
      {filteredResults.length > 0 && (
        <div className="space-y-4" ref={scrollContainerRef}>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              {filteredResults.length} produit{filteredResults.length !== 1 ? 's' : ''} trouvé{filteredResults.length !== 1 ? 's' : ''}
            </h2>
            <div className="text-sm text-gray-500 dark:text-gray-400">
              Trié par {getSortLabel(sortBy)} ({sortOrder === 'asc' ? 'croissant' : 'décroissant'})
            </div>
          </div>
          
          <div className="space-y-3">
            {filteredResults.map((product) => {
              // Only show stock for locations user has access to
              const accessibleStockLevels = Object.entries(product.stock_levels || {})
                .filter(([location]) => canAccessStockLocation(location));
              
              const totalStock = accessibleStockLevels.reduce((sum, [, level]) => sum + level, 0);
              const displayPrice = getDisplayPrice(product);
              const isAdded = addedProductIds.has(product.barcode);
              
              return (
                <div
                  key={product.barcode}
                  className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm rounded-xl p-4 shadow-lg hover:shadow-xl transition-all duration-300 border border-white/20 group"
                >
                  <div className="flex items-center justify-between">
                    <Link
                      to={`/product/${encodeURIComponent(product.barcode)}`}
                      className="flex-1 min-w-0 hover:scale-[1.01] transition-transform duration-200"
                    >
                      <div className="flex items-center space-x-3 mb-2">
                        <div className="p-2 bg-blue-100 dark:bg-blue-900 rounded-lg">
                          <Package className="h-4 w-4 text-blue-600 dark:text-blue-300" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="font-semibold text-gray-900 dark:text-white truncate">
                            {product.name}
                          </h3>
                          {product.brand && (
                            <p className="text-sm text-gray-600 dark:text-gray-400">
                              {product.brand}
                            </p>
                          )}
                        </div>
                      </div>
                      
                      <div className="flex items-center space-x-4 text-sm text-gray-600 dark:text-gray-400">
                        <span>#{product.barcode}</span>
                        <span className="font-medium text-emerald-600 dark:text-emerald-400">
                          {displayPrice.toFixed(2)} Dh
                        </span>
                        <span>Stock: {totalStock}</span>
                      </div>
                      
                      {accessibleStockLevels.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {accessibleStockLevels.map(([location, level]) => (
                            <span
                              key={location}
                              className="px-2 py-1 bg-gray-100 dark:bg-gray-700 text-xs rounded-full capitalize"
                            >
                              {location.replace(/_/g, ' ')}: {level}
                            </span>
                          ))}
                        </div>
                      )}
                    </Link>
                    
                    {/* Add to Cart Button - Only for users with quote permissions */}
                    <div className="flex items-center space-x-2 ml-4">
                      {canCreateQuote() && (
                        <button
                          onClick={(e) => handleAddToCart(product, e)}
                          className={`flex items-center space-x-2 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 transform hover:scale-105 ${
                            isAdded
                              ? 'bg-green-600 text-white'
                              : 'bg-purple-600 hover:bg-purple-700 text-white shadow-md hover:shadow-lg'
                          }`}
                          title={isAdded ? 'Ajouté au panier !' : 'Ajouter au panier de devis'}
                        >
                          {isAdded ? (
                            <>
                              <span className="text-xs">✓</span>
                              <span className="hidden sm:inline">Ajouté !</span>
                            </>
                          ) : (
                            <>
                              <Plus className="h-4 w-4" />
                              <span className="hidden sm:inline">Ajouter</span>
                            </>
                          )}
                        </button>
                      )}
                      
                      <Link
                        to={`/product/${encodeURIComponent(product.barcode)}`}
                        className="p-2 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                        title="Voir les détails"
                      >
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Barcode Scanner Modal */}
      <BarcodeScanner
        isOpen={showScanner}
        onScan={handleBarcodeScanned}
        onClose={() => setShowScanner(false)}
      />
    </div>
  );
}