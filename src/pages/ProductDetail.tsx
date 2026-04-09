import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Package, ArrowLeft, Copy, MapPin, DollarSign, ShoppingCart, Home, AlertCircle, Users, Building, TrendingUp, Search, Calculator, Plus } from 'lucide-react';
import { Product } from '../types';
import { useAppContext } from '../context/AppContext';
import { searchStateManager } from '../utils/searchStateManager';
import { useQuoteCart } from '../hooks/useQuoteCart';
import { useToast } from '../context/ToastContext';
import { QuoteManager } from '../utils/quoteManager';
import { useAuth } from '../hooks/useAuth';

export function ProductDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { canAccessStockLocation, canAccessBrand, canCreateQuote, getDisplayPrice, getPriceDisplayType } = useAuth();
  const { state } = useAppContext();
  const [product, setProduct] = useState<Product | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [marginPercentage, setMarginPercentage] = useState(() => {
    const saved = localStorage.getItem('inventory_margin_percentage');
    return saved ? parseInt(saved) : 30;
  });

  const { addToCart } = useQuoteCart();
  const { showToast } = useToast();
  const quoteManager = QuoteManager.getInstance();
  
  // Get user's price display type to determine what to show
  const userPriceDisplayType = getPriceDisplayType();

  // Check if we came from search page
  const [cameFromSearch, setCameFromSearch] = useState(false);

  useEffect(() => {
    // Check if there's a saved search state
    const searchState = searchStateManager.getState();
    setCameFromSearch(!!searchState);
  }, []);

  // Save margin percentage to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem('inventory_margin_percentage', marginPercentage.toString());
  }, [marginPercentage]);

  useEffect(() => {
    const loadProduct = async () => {
      if (!id) {
        setNotFound(true);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setNotFound(false);
      setError(null);
      
      try {
        console.log('Chargement du produit avec ID:', id);
        console.log('ID décodé:', decodeURIComponent(id));
        
        // Search in loaded products from context
        const decodedId = decodeURIComponent(id);
        const foundProduct = state.products.find(p => p.barcode === id || p.barcode === decodedId) || null;
        
        console.log('Produit trouvé:', foundProduct);
        
        if (foundProduct) {
          // Check if user has access to any stock location for this product
          const hasAccessibleStock = Object.keys(foundProduct.stock_levels || {}).some(location => 
            canAccessStockLocation(location)
          );
          
          // Check if user has access to this brand
          const hasAccessibleBrand = canAccessBrand(foundProduct.brand || '');
          
          if (!hasAccessibleStock) {
            setError('Vous n\'avez pas accès aux emplacements de stock de ce produit');
            setNotFound(true);
            setIsLoading(false);
            return;
          }
          
          if (!hasAccessibleBrand) {
            setError('Vous n\'avez pas accès à cette marque de produit');
            setNotFound(true);
            setIsLoading(false);
            return;
          }
          
          setProduct(foundProduct);
        } else {
          setNotFound(true);
        }
      } catch (error) {
        console.error('Échec du chargement du produit:', error);
        setError(error instanceof Error ? error.message : 'Échec du chargement du produit');
        setNotFound(true);
      } finally {
        setIsLoading(false);
      }
    };

    loadProduct();
  }, [id, canAccessStockLocation]);

  const calculateFinalPrice = () => {
    if (!product) return 0;
    return quoteManager.calculateFinalPrice(product.buyprice, marginPercentage);
  };

  const calculateMargin = (sellingPrice: number, purchasePrice: number) => {
    if (purchasePrice === 0) return 0;
    return ((sellingPrice - purchasePrice) / purchasePrice) * 100;
  };

  const handleCopy = async () => {
    if (!product) return;

    if (!canCreateQuote()) {
      showToast({
        type: 'error',
        title: 'Accès refusé',
        message: 'Vous n\'avez pas l\'autorisation de copier des produits pour les devis'
      });
      return;
    }
    const finalPrice = calculateFinalPrice();
    // Format: Brand, ID, Title, quantity (0), price
    const copyText = `${product.brand}\t${product.barcode}\t${product.name}\t0\t${finalPrice.toFixed(2)}`;
    
    try {
      await navigator.clipboard.writeText(copyText);
      showToast({
        type: 'success',
        message: 'Produit copié dans le presse-papiers'
      });
    } catch (error) {
      console.error('Échec de la copie dans le presse-papiers:', error);
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = copyText;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      showToast({
        type: 'success',
        message: 'Produit copié dans le presse-papiers'
      });
    }
  };

  const handleAddToCart = () => {
    if (!product) return;

    if (!canCreateQuote()) {
      showToast({
        type: 'error',
        title: 'Accès refusé',
        message: 'Vous n\'avez pas l\'autorisation de créer des devis'
      });
      return;
    }
    // Always use 'normal' price type since toggle is removed
    addToCart(product, 'normal', marginPercentage);
    
    showToast({
      type: 'success',
      title: 'Ajouté au panier',
      message: `${product.name} ajouté au panier de devis`
    });

    // Trigger haptic feedback if available
    if ('vibrate' in navigator) {
      navigator.vibrate(100);
    }
  };

  const handleBackToSearch = () => {
    navigate('/search');
  };

  const handleBackNavigation = () => {
    if (cameFromSearch) {
      navigate('/search');
    } else {
      navigate(-1);
    }
  };

  // Generate margin percentage options
  const marginOptions = [];
  for (let i = 5; i <= 100; i += 5) {
    marginOptions.push(i);
  }

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto">
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="text-gray-600 dark:text-gray-400 mt-4">Chargement du produit...</p>
        </div>
      </div>
    );
  }

  if (notFound || !product) {
    return (
      <div className="max-w-5xl mx-auto">
        <div className="bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm rounded-2xl shadow-xl p-8 text-center">
          <Package className="h-16 w-16 text-gray-400 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
            Produit Non Trouvé
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mb-2">
            Aucun produit trouvé avec l'identifiant : <code className="bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded">{id}</code>
          </p>
          {error && (
            <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-center justify-center space-x-2">
              <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            </div>
          )}
          <div className="flex flex-wrap gap-3 justify-center mt-6">
            <button
              onClick={() => navigate('/')}
              className="flex items-center space-x-2 px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
            >
              <Home className="h-4 w-4" />
              <span>Accueil</span>
            </button>
            {cameFromSearch && (
              <button
                onClick={handleBackToSearch}
                className="flex items-center space-x-2 px-6 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors"
              >
                <Search className="h-4 w-4" />
                <span>Retour à la Recherche</span>
              </button>
            )}
            <button
              onClick={() => navigate('/search')}
              className="px-6 py-2 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg transition-colors"
            >
              Rechercher Produits
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Filter stock locations based on user permissions
  const accessibleStockLocations = Object.entries(product.stock_levels || {})
    .filter(([location]) => canAccessStockLocation(location));
  const totalStock = accessibleStockLocations.reduce((sum, [, level]) => sum + level, 0);
  const displayPrice = getDisplayPrice(product);
  const finalPrice = calculateFinalPrice();
  
  // Calculate margins using corrected formula
  const normalMargin = calculateMargin(product.price, product.buyprice);
  const resellerMargin = calculateMargin(product.reseller_price, product.buyprice);
  const calculatedMargin = calculateMargin(finalPrice, product.buyprice);

  return (
    <div className="max-w-5xl mx-auto">
      {/* Back Button */}
      <div className="mb-6">
        <button
          onClick={handleBackNavigation}
          className="flex items-center space-x-2 text-blue-600 dark:text-blue-400 hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>{cameFromSearch ? 'Retour à la Recherche' : 'Retour'}</span>
        </button>
      </div>

      <div className="bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm rounded-2xl shadow-xl overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-500 to-blue-600 p-6 text-white">
          <div className="flex items-center space-x-4">
            <div className="p-3 bg-white/20 rounded-xl">
              <Package className="h-8 w-8" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">{product.name}</h1>
              {product.brand && <p className="text-blue-100 text-lg">{product.brand}</p>}
            </div>
          </div>
        </div>

        <div className="p-6">
          {/* Price Calculator Section - Only for users with quote permissions */}
          {canCreateQuote() && userPriceDisplayType !== 'reseller' && (
            <div className="mb-8 p-6 rounded-xl border bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-900/20 dark:to-purple-900/20 border-indigo-200 dark:border-indigo-800">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center space-x-2">
                  <Calculator className="h-5 w-5" />
                  <span>Calculateur de Prix</span>
                </h2>
              </div>

              {/* Margin Percentage Selector */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                  Pourcentage de Marge
                </label>
                <select
                  value={marginPercentage}
                  onChange={(e) => setMarginPercentage(parseInt(e.target.value))}
                  className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                >
                  {marginOptions.map((percentage) => (
                    <option key={percentage} value={percentage}>
                      {percentage}%
                    </option>
                  ))}
                </select>
              </div>

              {/* Price Calculation Display */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <div className="text-center p-4 bg-white dark:bg-slate-700 rounded-lg shadow-sm">
                  <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">Prix d'Achat</div>
                  <div className="text-xl font-bold text-gray-900 dark:text-white">
                    {product.buyprice.toFixed(2)} Dh
                  </div>
                </div>
                
                <div className="text-center p-4 bg-white dark:bg-slate-700 rounded-lg shadow-sm">
                  <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">Marge Appliquée</div>
                  <div className="text-xl font-bold text-orange-600 dark:text-orange-400">
                    +{marginPercentage}%
                  </div>
                </div>
                
                <div className="text-center p-4 bg-white dark:bg-slate-700 rounded-lg shadow-sm">
                  <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">Prix Final</div>
                  <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400">
                    {finalPrice.toFixed(2)} Dh
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  onClick={handleCopy}
                  className="flex-1 flex items-center justify-center space-x-2 px-4 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors"
                >
                  <Copy className="h-4 w-4" />
                  <span>Copier pour Excel</span>
                </button>

                <button
                  onClick={handleAddToCart}
                  className="flex-1 flex items-center justify-center space-x-2 px-4 py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors"
                >
                  <Plus className="h-4 w-4" />
                  <span>Ajouter au Panier</span>
                </button>
              </div>

              <p className="text-sm text-gray-600 dark:text-gray-400 mt-3 text-center">
                Prix calculé: {product.buyprice.toFixed(2)} Dh + {marginPercentage}% = {finalPrice.toFixed(2)} Dh
              </p>
            </div>
          )}

          {/* Main Details Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
            {/* Basic Information */}
            <div className="space-y-6">
              <h3 className="text-xl font-semibold text-gray-900 dark:text-white border-b border-gray-200 dark:border-gray-700 pb-2">
                Informations Produit
              </h3>
              
              <div className="space-y-4">
                <div className="flex items-center space-x-3 p-4 bg-gray-50 dark:bg-slate-700 rounded-xl">
                  <Package className="h-6 w-6 text-gray-600 dark:text-gray-300" />
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Identifiant</p>
                    <p className="text-xl font-semibold text-gray-900 dark:text-white break-all">{product.barcode}</p>
                  </div>
                </div>

                <div className="flex items-center space-x-3 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-xl">
                  <Package className="h-6 w-6 text-blue-600 dark:text-blue-300" />
                  <div>
                    <p className="text-sm text-blue-600 dark:text-blue-400">Quantité Totale</p>
                    <p className="text-2xl font-bold text-blue-900 dark:text-blue-100">
                      {totalStock}
                    </p>
                  </div>
                </div>
                
                <div className="flex items-center space-x-3 p-4 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl">
                  <DollarSign className="h-6 w-6 text-emerald-600 dark:text-emerald-300" />
                  <div>
                    <p className="text-sm text-emerald-600 dark:text-emerald-400">Prix Affiché</p>
                    <p className="text-2xl font-bold text-emerald-900 dark:text-emerald-100">
                      {displayPrice.toFixed(2)} Dh
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Stock by Location */}
            <div className="space-y-6">
              <h3 className="text-xl font-semibold text-gray-900 dark:text-white border-b border-gray-200 dark:border-gray-700 pb-2">
                Stock par Emplacement
              </h3>
              
              <div className="space-y-4">
                {accessibleStockLocations.length > 0 ? (
                  accessibleStockLocations.map(([location, level], index) => {
                    const colors = [
                      { bg: 'bg-purple-50 dark:bg-purple-900/20', text: 'text-purple-600 dark:text-purple-300', textDark: 'text-purple-900 dark:text-purple-100' },
                      { bg: 'bg-orange-50 dark:bg-orange-900/20', text: 'text-orange-600 dark:text-orange-300', textDark: 'text-orange-900 dark:text-orange-100' },
                      { bg: 'bg-red-50 dark:bg-red-900/20', text: 'text-red-600 dark:text-red-300', textDark: 'text-red-900 dark:text-red-100' },
                      { bg: 'bg-yellow-50 dark:bg-yellow-900/20', text: 'text-yellow-600 dark:text-yellow-300', textDark: 'text-yellow-900 dark:text-yellow-100' },
                      { bg: 'bg-pink-50 dark:bg-pink-900/20', text: 'text-pink-600 dark:text-pink-300', textDark: 'text-pink-900 dark:text-pink-100' },
                      { bg: 'bg-indigo-50 dark:bg-indigo-900/20', text: 'text-indigo-600 dark:text-indigo-300', textDark: 'text-indigo-900 dark:text-indigo-100' }
                    ];
                    const colorScheme = colors[index % colors.length];
                    
                    return (
                      <div key={location} className={`flex items-center space-x-3 p-4 ${colorScheme.bg} rounded-xl`}>
                        <MapPin className={`h-6 w-6 ${colorScheme.text}`} />
                        <div>
                          <p className={`text-sm ${colorScheme.text} capitalize font-medium`}>
                            {location.replace(/_/g, ' ')}
                          </p>
                          <p className={`text-2xl font-bold ${colorScheme.textDark}`}>
                            {level}
                          </p>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="flex items-center space-x-3 p-4 bg-gray-50 dark:bg-slate-700 rounded-xl">
                    <MapPin className="h-6 w-6 text-gray-600 dark:text-gray-300" />
                    <div>
                      <p className="text-sm text-gray-500 dark:text-gray-400">Emplacements Stock</p>
                      <p className="text-xl font-semibold text-gray-900 dark:text-white">Aucun emplacement accessible</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Pricing Details - Show All Prices */}
          {userPriceDisplayType !== 'reseller' && (
            <div className="border-t border-gray-200 dark:border-gray-700 pt-8 mb-8">
              <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-6">Tous les Détails de Prix</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {/* Regular Selling Price */}
                <div className="flex items-center space-x-3 p-4 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl">
                  <DollarSign className="h-6 w-6 text-emerald-600 dark:text-emerald-300" />
                  <div>
                    <p className="text-sm text-emerald-600 dark:text-emerald-400">Prix Normal</p>
                    <p className="text-2xl font-bold text-emerald-900 dark:text-emerald-100">
                      {product.price.toFixed(2)} Dh
                    </p>
                  </div>
                </div>

                {/* Reseller Price */}
                <div className="flex items-center space-x-3 p-4 bg-purple-50 dark:bg-purple-900/20 rounded-xl">
                  <Users className="h-6 w-6 text-purple-600 dark:text-purple-300" />
                  <div>
                    <p className="text-sm text-purple-600 dark:text-purple-400">Prix Revendeur</p>
                    <p className="text-2xl font-bold text-purple-900 dark:text-purple-100">
                      {product.reseller_price.toFixed(2)} Dh
                    </p>
                  </div>
                </div>

                {/* Buy Price */}
                <div className="flex items-center space-x-3 p-4 bg-orange-50 dark:bg-orange-900/20 rounded-xl">
                  <ShoppingCart className="h-6 w-6 text-orange-600 dark:text-orange-300" />
                  <div>
                    <p className="text-sm text-orange-600 dark:text-orange-400">Prix d'Achat</p>
                    <p className="text-2xl font-bold text-orange-900 dark:text-orange-100">
                      {product.buyprice.toFixed(2)} Dh
                    </p>
                  </div>
                </div>

                {/* Regular Profit Margin */}
                <div className="flex items-center space-x-3 p-4 bg-indigo-50 dark:bg-indigo-900/20 rounded-xl">
                  <TrendingUp className="h-6 w-6 text-indigo-600 dark:text-indigo-300" />
                  <div>
                    <p className="text-sm text-indigo-600 dark:text-indigo-400">Marge Normale</p>
                    <p className="text-2xl font-bold text-indigo-900 dark:text-indigo-100">
                      {normalMargin.toFixed(1)}%
                    </p>
                  </div>
                </div>

                {/* Reseller Profit Margin */}
                <div className="flex items-center space-x-3 p-4 bg-rose-50 dark:bg-rose-900/20 rounded-xl">
                  <TrendingUp className="h-6 w-6 text-rose-600 dark:text-rose-300" />
                  <div>
                    <p className="text-sm text-rose-600 dark:text-rose-400">Marge Revendeur</p>
                    <p className="text-2xl font-bold text-rose-900 dark:text-rose-100">
                      {resellerMargin.toFixed(1)}%
                    </p>
                  </div>
                </div>

                {/* Provider */}
                <div className="flex items-center space-x-3 p-4 bg-teal-50 dark:bg-teal-900/20 rounded-xl">
                  <Building className="h-6 w-6 text-teal-600 dark:text-teal-300" />
                  <div>
                    <p className="text-sm text-teal-600 dark:text-teal-400">Fournisseur</p>
                    <p className="text-lg font-bold text-teal-900 dark:text-teal-100 truncate">
                      {product.provider || 'Non spécifié'}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Tech Sheet Link */}
          {product.techsheet && (
            <div className="border-t border-gray-200 dark:border-gray-700 pt-6 mt-6">
              <a
                href={product.techsheet}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center space-x-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
              >
                <Package className="h-4 w-4" />
                <span>Ouvrir Fiche Technique</span>
              </a>
            </div>
          )}

          {/* Action Buttons - Simplified */}
          <div className="border-t border-gray-200 dark:border-gray-700 pt-6 mt-6 flex flex-wrap gap-3">
            <button
              onClick={() => navigate('/')}
              className="flex items-center space-x-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
            >
              <Home className="h-4 w-4" />
              <span>Accueil</span>
            </button>
            
            <button
              onClick={handleBackToSearch}
              className="flex items-center space-x-2 px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors"
            >
              <Search className="h-4 w-4" />
              <span>Retour à la Recherche</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}