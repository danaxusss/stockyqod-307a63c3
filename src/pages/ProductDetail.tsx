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
  const userPriceDisplayType = getPriceDisplayType();
  const [cameFromSearch, setCameFromSearch] = useState(false);

  useEffect(() => {
    const searchState = searchStateManager.getState();
    setCameFromSearch(!!searchState);
  }, []);

  useEffect(() => {
    localStorage.setItem('inventory_margin_percentage', marginPercentage.toString());
  }, [marginPercentage]);

  useEffect(() => {
    const loadProduct = async () => {
      if (!id) { setNotFound(true); setIsLoading(false); return; }
      setIsLoading(true); setNotFound(false); setError(null);
      try {
        const decodedId = decodeURIComponent(id);
        const foundProduct = state.products.find(p => p.barcode === id || p.barcode === decodedId) || null;
        if (foundProduct) {
          const hasAccessibleStock = Object.keys(foundProduct.stock_levels || {}).some(location => canAccessStockLocation(location));
          const hasAccessibleBrand = canAccessBrand(foundProduct.brand || '');
          if (!hasAccessibleStock) { setError('Vous n\'avez pas accès aux emplacements de stock de ce produit'); setNotFound(true); setIsLoading(false); return; }
          if (!hasAccessibleBrand) { setError('Vous n\'avez pas accès à cette marque de produit'); setNotFound(true); setIsLoading(false); return; }
          setProduct(foundProduct);
        } else { setNotFound(true); }
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Échec du chargement du produit');
        setNotFound(true);
      } finally { setIsLoading(false); }
    };
    loadProduct();
  }, [id, canAccessStockLocation]);

  const calculateFinalPrice = () => { if (!product) return 0; return quoteManager.calculateFinalPrice(product.buyprice, marginPercentage); };
  const calculateMargin = (sellingPrice: number, purchasePrice: number) => { if (purchasePrice === 0) return 0; return ((sellingPrice - purchasePrice) / purchasePrice) * 100; };

  const handleCopy = async () => {
    if (!product || !canCreateQuote()) { showToast({ type: 'error', title: 'Accès refusé', message: 'Vous n\'avez pas l\'autorisation' }); return; }
    const finalPrice = calculateFinalPrice();
    const copyText = `${product.brand}\t${product.barcode}\t${product.name}\t0\t${finalPrice.toFixed(2)}`;
    try { await navigator.clipboard.writeText(copyText); showToast({ type: 'success', message: 'Produit copié dans le presse-papiers' }); } catch {
      const textArea = document.createElement('textarea'); textArea.value = copyText; document.body.appendChild(textArea); textArea.select(); document.execCommand('copy'); document.body.removeChild(textArea);
      showToast({ type: 'success', message: 'Produit copié dans le presse-papiers' });
    }
  };

  const handleAddToCart = () => {
    if (!product || !canCreateQuote()) { showToast({ type: 'error', title: 'Accès refusé', message: 'Vous n\'avez pas l\'autorisation de créer des devis' }); return; }
    addToCart(product, 'normal', marginPercentage);
    showToast({ type: 'success', title: 'Ajouté au panier', message: `${product.name} ajouté au panier de devis` });
    if ('vibrate' in navigator) navigator.vibrate(100);
  };

  const handleBackToSearch = () => navigate('/search');
  const handleBackNavigation = () => { if (cameFromSearch) navigate('/search'); else navigate(-1); };

  const marginOptions = [];
  for (let i = 5; i <= 100; i += 5) marginOptions.push(i);

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto">
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="text-muted-foreground mt-4">Chargement du produit...</p>
        </div>
      </div>
    );
  }

  if (notFound || !product) {
    return (
      <div className="max-w-5xl mx-auto">
        <div className="glass rounded-2xl shadow-xl p-8 text-center">
          <Package className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-foreground mb-2">Produit Non Trouvé</h1>
          <p className="text-muted-foreground mb-2">Aucun produit trouvé avec l'identifiant : <code className="bg-secondary px-2 py-1 rounded">{id}</code></p>
          {error && (
            <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg flex items-center justify-center space-x-2">
              <AlertCircle className="h-4 w-4 text-destructive" /><p className="text-sm text-destructive">{error}</p>
            </div>
          )}
          <div className="flex flex-wrap gap-3 justify-center mt-6">
            <button onClick={() => navigate('/')} className="flex items-center space-x-2 px-6 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg transition-colors">
              <Home className="h-4 w-4" /><span>Accueil</span>
            </button>
            {cameFromSearch && (
              <button onClick={handleBackToSearch} className="flex items-center space-x-2 px-6 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors">
                <Search className="h-4 w-4" /><span>Retour à la Recherche</span>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const accessibleStockLocations = Object.entries(product.stock_levels || {}).filter(([location]) => canAccessStockLocation(location));
  const totalStock = accessibleStockLocations.reduce((sum, [, level]) => sum + level, 0);
  const displayPrice = getDisplayPrice(product);
  const finalPrice = calculateFinalPrice();
  const normalMargin = calculateMargin(product.price, product.buyprice);
  const resellerMargin = calculateMargin(product.reseller_price, product.buyprice);

  const colorSchemes = [
    { bg: 'bg-violet-500/10', text: 'text-violet-400', textDark: 'text-violet-300' },
    { bg: 'bg-orange-500/10', text: 'text-orange-400', textDark: 'text-orange-300' },
    { bg: 'bg-rose-500/10', text: 'text-rose-400', textDark: 'text-rose-300' },
    { bg: 'bg-amber-500/10', text: 'text-amber-400', textDark: 'text-amber-300' },
    { bg: 'bg-pink-500/10', text: 'text-pink-400', textDark: 'text-pink-300' },
    { bg: 'bg-indigo-500/10', text: 'text-indigo-400', textDark: 'text-indigo-300' },
  ];

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-6">
        <button onClick={handleBackNavigation} className="flex items-center space-x-2 text-primary hover:underline">
          <ArrowLeft className="h-4 w-4" /><span>{cameFromSearch ? 'Retour à la Recherche' : 'Retour'}</span>
        </button>
      </div>

      <div className="glass rounded-2xl shadow-xl overflow-hidden">
        {/* Header */}
        <div className="bg-primary p-6 text-primary-foreground" style={{ backgroundImage: 'var(--gradient-primary)' }}>
          <div className="flex items-center space-x-4">
            <div className="p-3 bg-white/20 rounded-xl"><Package className="h-8 w-8" /></div>
            <div>
              <h1 className="text-2xl font-bold">{product.name}</h1>
              {product.brand && <p className="text-primary-foreground/70 text-lg">{product.brand}</p>}
            </div>
          </div>
        </div>

        <div className="p-6">
          {/* Price Calculator */}
          {canCreateQuote() && userPriceDisplayType !== 'reseller' && (
            <div className="mb-8 p-6 rounded-xl border bg-accent/30 border-primary/20">
              <h2 className="text-lg font-semibold text-foreground flex items-center space-x-2 mb-6">
                <Calculator className="h-5 w-5" /><span>Calculateur de Prix</span>
              </h2>
              <div className="mb-6">
                <label className="block text-sm font-medium text-muted-foreground mb-3">Pourcentage de Marge</label>
                <select value={marginPercentage} onChange={(e) => setMarginPercentage(parseInt(e.target.value))}
                  className="w-full px-4 py-3 border border-input rounded-lg focus:ring-2 focus:ring-ring bg-background text-foreground">
                  {marginOptions.map((p) => <option key={p} value={p}>{p}%</option>)}
                </select>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <div className="text-center p-4 bg-secondary rounded-lg">
                  <div className="text-sm text-muted-foreground mb-1">Prix d'Achat</div>
                  <div className="text-xl font-bold text-foreground">{product.buyprice.toFixed(2)} Dh</div>
                </div>
                <div className="text-center p-4 bg-secondary rounded-lg">
                  <div className="text-sm text-muted-foreground mb-1">Marge Appliquée</div>
                  <div className="text-xl font-bold text-orange-400">+{marginPercentage}%</div>
                </div>
                <div className="text-center p-4 bg-secondary rounded-lg">
                  <div className="text-sm text-muted-foreground mb-1">Prix Final</div>
                  <div className="text-xl font-bold text-emerald-400">{finalPrice.toFixed(2)} Dh</div>
                </div>
              </div>
              <div className="flex flex-col sm:flex-row gap-3">
                <button onClick={handleCopy} className="flex-1 flex items-center justify-center space-x-2 px-4 py-3 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg transition-colors">
                  <Copy className="h-4 w-4" /><span>Copier pour Excel</span>
                </button>
                <button onClick={handleAddToCart} className="flex-1 flex items-center justify-center space-x-2 px-4 py-3 bg-violet-600 hover:bg-violet-700 text-white rounded-lg transition-colors">
                  <Plus className="h-4 w-4" /><span>Ajouter au Panier</span>
                </button>
              </div>
              <p className="text-sm text-muted-foreground mt-3 text-center">
                Prix calculé: {product.buyprice.toFixed(2)} Dh + {marginPercentage}% = {finalPrice.toFixed(2)} Dh
              </p>
            </div>
          )}

          {/* Main Details Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
            <div className="space-y-6">
              <h3 className="text-xl font-semibold text-foreground border-b border-border pb-2">Informations Produit</h3>
              <div className="space-y-4">
                <div className="flex items-center space-x-3 p-4 bg-secondary rounded-xl">
                  <Package className="h-6 w-6 text-muted-foreground" />
                  <div><p className="text-sm text-muted-foreground">Identifiant</p><p className="text-xl font-semibold text-foreground break-all">{product.barcode}</p></div>
                </div>
                <div className="flex items-center space-x-3 p-4 bg-primary/10 rounded-xl">
                  <Package className="h-6 w-6 text-primary" />
                  <div><p className="text-sm text-primary">Quantité Totale</p><p className="text-2xl font-bold text-foreground">{totalStock}</p></div>
                </div>
                <div className="flex items-center space-x-3 p-4 bg-emerald-500/10 rounded-xl">
                  <DollarSign className="h-6 w-6 text-emerald-400" />
                  <div><p className="text-sm text-emerald-400">Prix Affiché</p><p className="text-2xl font-bold text-foreground">{displayPrice.toFixed(2)} Dh</p></div>
                </div>
              </div>
            </div>

            <div className="space-y-6">
              <h3 className="text-xl font-semibold text-foreground border-b border-border pb-2">Stock par Emplacement</h3>
              <div className="space-y-4">
                {accessibleStockLocations.length > 0 ? (
                  accessibleStockLocations.map(([location, level], index) => {
                    const cs = colorSchemes[index % colorSchemes.length];
                    return (
                      <div key={location} className={`flex items-center space-x-3 p-4 ${cs.bg} rounded-xl`}>
                        <MapPin className={`h-6 w-6 ${cs.text}`} />
                        <div>
                          <p className={`text-sm ${cs.text} capitalize font-medium`}>{location.replace(/_/g, ' ')}</p>
                          <p className={`text-2xl font-bold ${cs.textDark}`}>{level}</p>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="flex items-center space-x-3 p-4 bg-secondary rounded-xl">
                    <MapPin className="h-6 w-6 text-muted-foreground" />
                    <div><p className="text-sm text-muted-foreground">Emplacements Stock</p><p className="text-xl font-semibold text-foreground">Aucun emplacement accessible</p></div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Pricing Details */}
          {userPriceDisplayType !== 'reseller' && (
            <div className="border-t border-border pt-8 mb-8">
              <h3 className="text-xl font-semibold text-foreground mb-6">Tous les Détails de Prix</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <div className="flex items-center space-x-3 p-4 bg-emerald-500/10 rounded-xl">
                  <DollarSign className="h-6 w-6 text-emerald-400" />
                  <div><p className="text-sm text-emerald-400">Prix Normal</p><p className="text-2xl font-bold text-foreground">{product.price.toFixed(2)} Dh</p></div>
                </div>
                <div className="flex items-center space-x-3 p-4 bg-violet-500/10 rounded-xl">
                  <Users className="h-6 w-6 text-violet-400" />
                  <div><p className="text-sm text-violet-400">Prix Revendeur</p><p className="text-2xl font-bold text-foreground">{product.reseller_price.toFixed(2)} Dh</p></div>
                </div>
                <div className="flex items-center space-x-3 p-4 bg-orange-500/10 rounded-xl">
                  <ShoppingCart className="h-6 w-6 text-orange-400" />
                  <div><p className="text-sm text-orange-400">Prix d'Achat</p><p className="text-2xl font-bold text-foreground">{product.buyprice.toFixed(2)} Dh</p></div>
                </div>
                <div className="flex items-center space-x-3 p-4 bg-indigo-500/10 rounded-xl">
                  <TrendingUp className="h-6 w-6 text-indigo-400" />
                  <div><p className="text-sm text-indigo-400">Marge Normale</p><p className="text-2xl font-bold text-foreground">{normalMargin.toFixed(1)}%</p></div>
                </div>
                <div className="flex items-center space-x-3 p-4 bg-rose-500/10 rounded-xl">
                  <TrendingUp className="h-6 w-6 text-rose-400" />
                  <div><p className="text-sm text-rose-400">Marge Revendeur</p><p className="text-2xl font-bold text-foreground">{resellerMargin.toFixed(1)}%</p></div>
                </div>
                <div className="flex items-center space-x-3 p-4 bg-teal-500/10 rounded-xl">
                  <Building className="h-6 w-6 text-teal-400" />
                  <div><p className="text-sm text-teal-400">Fournisseur</p><p className="text-lg font-bold text-foreground truncate">{product.provider || 'Non spécifié'}</p></div>
                </div>
              </div>
            </div>
          )}

          {/* Tech Sheet */}
          {product.techsheet && (
            <div className="border-t border-border pt-6 mt-6">
              <a href={product.techsheet} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center space-x-2 px-6 py-3 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg transition-colors">
                <Package className="h-4 w-4" /><span>Ouvrir Fiche Technique</span>
              </a>
            </div>
          )}

          {/* Action Buttons */}
          <div className="border-t border-border pt-6 mt-6 flex flex-wrap gap-3">
            <button onClick={() => navigate('/')} className="flex items-center space-x-2 px-6 py-3 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg transition-colors">
              <Home className="h-4 w-4" /><span>Accueil</span>
            </button>
            <button onClick={handleBackToSearch} className="flex items-center space-x-2 px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors">
              <Search className="h-4 w-4" /><span>Retour à la Recherche</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}