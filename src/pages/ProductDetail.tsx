import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Package, ArrowLeft, Copy, MapPin, DollarSign, ShoppingCart, Home, AlertCircle, Users, Building, TrendingUp, Search, Calculator, Plus, Paperclip, Upload, Download, Trash2, Loader, FileText, X, Images } from 'lucide-react';
import { Product, TechnicalSheet } from '../types';
import { useAppContext } from '../context/AppContext';
import { searchStateManager } from '../utils/searchStateManager';
import { useQuoteCart } from '../hooks/useQuoteCart';
import { useToast } from '../context/ToastContext';
import { QuoteManager } from '../utils/quoteManager';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useProductOverrides } from '../hooks/useProductOverrides';

export function ProductDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { canAccessStockLocation, canAccessBrand, canCreateQuote, getDisplayPrice, getPriceDisplayType, isAdmin: isAdminUser } = useAuth();
  const { state } = useAppContext();
  const [product, setProduct] = useState<Product | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [marginPercentage, setMarginPercentage] = useState(() => {
    const saved = localStorage.getItem('inventory_margin_percentage');
    return saved ? parseInt(saved) : 30;
  });
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Linked sheets state
  const [linkedSheets, setLinkedSheets] = useState<TechnicalSheet[]>([]);
  const [sheetSearchQuery, setSheetSearchQuery] = useState('');
  const [sheetSearchResults, setSheetSearchResults] = useState<TechnicalSheet[]>([]);
  const [allSheets, setAllSheets] = useState<TechnicalSheet[]>([]);

  const { addToCart } = useQuoteCart();
  const { showToast } = useToast();
  const { getOriginalName, getAllNames } = useProductOverrides();
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
          const hasAccessibleBrand = getAllNames('brand', foundProduct.brand || '').some(name => canAccessBrand(name));
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
  }, [id, canAccessStockLocation, canAccessBrand, getAllNames, state.products]);

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

  // Linked photos state
  const [linkedPhotos, setLinkedPhotos] = useState<{ id: string; storage_path: string; title: string; file_name: string }[]>([]);

  const loadLinkedPhotos = useCallback(async () => {
    if (!product) return;
    try {
      const { data: links } = await (supabase as any)
        .from('product_photo_products')
        .select('photo_id')
        .eq('barcode', product.barcode);
      const ids = (links || []).map((l: any) => l.photo_id);
      if (ids.length > 0) {
        const { data } = await (supabase as any)
          .from('product_photos')
          .select('id, storage_path, title, file_name')
          .in('id', ids);
        setLinkedPhotos(data || []);
      } else {
        setLinkedPhotos([]);
      }
    } catch { setLinkedPhotos([]); }
  }, [product]);

  useEffect(() => { loadLinkedPhotos(); }, [loadLinkedPhotos]);

  // Load linked sheets
  const loadLinkedSheets = useCallback(async () => {
    if (!product) return;
    try {
      const { data: links } = await supabase
        .from('technical_sheet_products')
        .select('sheet_id')
        .eq('product_barcode', product.barcode);
      const sheetIds = (links || []).map((l: any) => l.sheet_id);
      if (sheetIds.length > 0) {
        const { data: sheetsData } = await supabase
          .from('technical_sheets')
          .select('*')
          .in('id', sheetIds);
        setLinkedSheets((sheetsData || []) as unknown as TechnicalSheet[]);
      } else {
        setLinkedSheets([]);
      }
    } catch { setLinkedSheets([]); }
  }, [product]);

  useEffect(() => { loadLinkedSheets(); }, [loadLinkedSheets]);

  // Load all sheets for search
  useEffect(() => {
    const loadAll = async () => {
      const { data } = await supabase.from('technical_sheets').select('*').order('title');
      setAllSheets((data || []) as unknown as TechnicalSheet[]);
    };
    loadAll();
  }, []);

  // Sheet search
  useEffect(() => {
    if (sheetSearchQuery.length < 2) { setSheetSearchResults([]); return; }
    const q = sheetSearchQuery.toLowerCase();
    const linkedIds = new Set(linkedSheets.map(s => s.id));
    const results = allSheets.filter(s =>
      !linkedIds.has(s.id) &&
      (s.title.toLowerCase().includes(q) || s.manufacturer.toLowerCase().includes(q))
    ).slice(0, 8);
    setSheetSearchResults(results);
  }, [sheetSearchQuery, allSheets, linkedSheets]);

  const linkSheet = async (sheet: TechnicalSheet) => {
    if (!product) return;
    try {
      await supabase.from('technical_sheet_products').insert({ sheet_id: sheet.id, product_barcode: product.barcode });
      setLinkedSheets(prev => [...prev, sheet]);
      setSheetSearchQuery('');
      showToast({ type: 'success', message: `"${sheet.title}" lié` });
    } catch { showToast({ type: 'error', message: 'Erreur lors de la liaison' }); }
  };

  const unlinkSheet = async (sheetId: string) => {
    if (!product) return;
    try {
      await supabase.from('technical_sheet_products').delete().eq('sheet_id', sheetId).eq('product_barcode', product.barcode);
      setLinkedSheets(prev => prev.filter(s => s.id !== sheetId));
      showToast({ type: 'success', message: 'Fiche délié' });
    } catch { showToast({ type: 'error', message: 'Erreur' }); }
  };

  const handleUploadAndLink = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !product) return;
    if (file.size > 50 * 1024 * 1024) { showToast({ type: 'error', message: 'Fichier trop volumineux (max 50 Mo)' }); return; }
    setIsUploading(true);
    try {
      const sheetId = crypto.randomUUID();
      const ext = file.name.split('.').pop() || 'pdf';
      const filePath = `${sheetId}.${ext}`;
      const { error: uploadError } = await supabase.storage.from('technical-sheets').upload(filePath, file, { upsert: true });
      if (uploadError) throw uploadError;
      const { data: urlData } = supabase.storage.from('technical-sheets').getPublicUrl(filePath);
      const title = file.name.replace(/\.[^.]+$/, '');
      const { error: insertError } = await supabase.from('technical_sheets').insert({
        id: sheetId, title, manufacturer: product.brand || '', category: '', file_url: urlData.publicUrl, file_size: file.size, file_type: file.type || 'application/pdf',
      });
      if (insertError) throw insertError;
      await supabase.from('technical_sheet_products').insert({ sheet_id: sheetId, product_barcode: product.barcode });
      const newSheet: TechnicalSheet = { id: sheetId, title, manufacturer: product.brand || '', category: '', sector: '', file_url: urlData.publicUrl, file_size: file.size, file_type: file.type || 'application/pdf', view_count: 0, download_count: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      setLinkedSheets(prev => [...prev, newSheet]);
      setAllSheets(prev => [...prev, newSheet]);
      showToast({ type: 'success', message: 'Fiche technique ajoutée et liée' });
    } catch (err) {
      console.error('Upload error:', err);
      showToast({ type: 'error', message: 'Erreur lors du téléchargement' });
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
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
  const hasLinkedSheets = linkedSheets.length > 0;

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
      <div className="mb-3">
        <button onClick={handleBackNavigation} className="flex items-center space-x-2 text-primary hover:underline text-sm">
          <ArrowLeft className="h-4 w-4" /><span>{cameFromSearch ? 'Retour à la Recherche' : 'Retour'}</span>
        </button>
      </div>

      <div className="glass rounded-xl shadow-xl overflow-hidden">
        {/* Header */}
        <div className="bg-primary px-5 py-4 text-primary-foreground" style={{ backgroundImage: 'var(--gradient-primary)' }}>
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-white/20 rounded-lg"><Package className="h-6 w-6" /></div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold truncate">{product.name}</h1>
                {hasLinkedSheets && (
                  <span className="shrink-0" title={`${linkedSheets.length} fiche(s) technique(s)`}>
                    <Paperclip className="h-5 w-5 text-primary-foreground/80" />
                  </span>
                )}
              </div>
              <div className="flex items-center flex-wrap gap-2 mt-0.5">
                <span className="text-primary-foreground/70 text-sm">#{product.barcode}</span>
                {product.brand && (
                  <span className="px-2 py-0.5 bg-white/20 text-primary-foreground text-xs rounded font-medium">
                    {product.brand}
                    {getOriginalName('brand', product.brand) && (
                      <span className="text-primary-foreground/60 text-[10px] ml-1">(ex: {getOriginalName('brand', product.brand)})</span>
                    )}
                  </span>
                )}
                {product.provider && (
                  <span className="px-2 py-0.5 bg-white/20 text-primary-foreground text-xs rounded font-medium">
                    {product.provider}
                    {getOriginalName('provider', product.provider) && (
                      <span className="text-primary-foreground/60 text-[10px] ml-1">(ex: {getOriginalName('provider', product.provider)})</span>
                    )}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="p-5">
          {/* Quick Info Bar */}
          <div className="grid grid-cols-3 gap-3 mb-5">
            <div className="text-center p-3 bg-primary/10 rounded-lg">
              <div className="text-xs text-muted-foreground">Stock Total</div>
              <div className="text-xl font-bold text-foreground">{totalStock}</div>
            </div>
            <div className="text-center p-3 bg-emerald-500/10 rounded-lg">
              <div className="text-xs text-muted-foreground">Prix Affiché</div>
              <div className="text-xl font-bold text-foreground">{displayPrice.toFixed(2)} Dh</div>
            </div>
            <div className="text-center p-3 bg-secondary rounded-lg">
              <div className="text-xs text-muted-foreground">Emplacements</div>
              <div className="text-xl font-bold text-foreground">{accessibleStockLocations.length}</div>
            </div>
          </div>

          {/* Price Calculator */}
          {canCreateQuote() && userPriceDisplayType !== 'reseller' && (
            <div className="mb-5 p-4 rounded-lg border bg-accent/30 border-primary/20">
              <div className="flex items-center gap-2 mb-3">
                <Calculator className="h-4 w-4" />
                <h2 className="text-sm font-semibold text-foreground">Calculateur de Prix</h2>
              </div>
              <div className="flex items-center gap-3 mb-3">
                <select value={marginPercentage} onChange={(e) => setMarginPercentage(parseInt(e.target.value))}
                  className="px-3 py-2 border border-input rounded-lg text-sm focus:ring-2 focus:ring-ring bg-background text-foreground">
                  {marginOptions.map((p) => <option key={p} value={p}>{p}%</option>)}
                </select>
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">{product.buyprice.toFixed(2)} Dh</span>
                  <span className="text-orange-400">+{marginPercentage}%</span>
                  <span className="text-foreground">=</span>
                  <span className="font-bold text-emerald-400">{finalPrice.toFixed(2)} Dh</span>
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={handleCopy} className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg text-sm transition-colors">
                  <Copy className="h-3.5 w-3.5" /><span>Copier</span>
                </button>
                <button onClick={handleAddToCart} className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm transition-colors">
                  <Plus className="h-3.5 w-3.5" /><span>Ajouter au Panier</span>
                </button>
              </div>
            </div>
          )}

          {/* Stock Locations */}
          {accessibleStockLocations.length > 0 && (
            <div className="mb-5">
              <h3 className="text-sm font-semibold text-foreground mb-2">Stock par Emplacement</h3>
              <div className="flex flex-wrap gap-2">
                {accessibleStockLocations.map(([location, level], index) => {
                  const cs = colorSchemes[index % colorSchemes.length];
                  return (
                    <div key={location} className={`flex items-center gap-2 px-3 py-2 ${cs.bg} rounded-lg`}>
                      <MapPin className={`h-4 w-4 ${cs.text}`} />
                      <span className={`text-sm ${cs.text} capitalize font-medium`}>{location.replace(/_/g, ' ')}</span>
                      <span className={`text-lg font-bold ${cs.textDark}`}>{level}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Pricing Details */}
          {userPriceDisplayType !== 'reseller' && (
            <div className="mb-5">
              <h3 className="text-sm font-semibold text-foreground mb-2">Détails de Prix</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                <div className="flex items-center gap-2 p-2.5 bg-emerald-500/10 rounded-lg">
                  <DollarSign className="h-4 w-4 text-emerald-400 shrink-0" />
                  <div><p className="text-[11px] text-emerald-400">Normal</p><p className="text-sm font-bold text-foreground">{product.price.toFixed(2)} Dh</p></div>
                </div>
                <div className="flex items-center gap-2 p-2.5 bg-violet-500/10 rounded-lg">
                  <Users className="h-4 w-4 text-violet-400 shrink-0" />
                  <div><p className="text-[11px] text-violet-400">Revendeur</p><p className="text-sm font-bold text-foreground">{product.reseller_price.toFixed(2)} Dh</p></div>
                </div>
                <div className="flex items-center gap-2 p-2.5 bg-orange-500/10 rounded-lg">
                  <ShoppingCart className="h-4 w-4 text-orange-400 shrink-0" />
                  <div><p className="text-[11px] text-orange-400">Achat</p><p className="text-sm font-bold text-foreground">{product.buyprice.toFixed(2)} Dh</p></div>
                </div>
                <div className="flex items-center gap-2 p-2.5 bg-indigo-500/10 rounded-lg">
                  <TrendingUp className="h-4 w-4 text-indigo-400 shrink-0" />
                  <div><p className="text-[11px] text-indigo-400">Marge Normale</p><p className="text-sm font-bold text-foreground">{normalMargin.toFixed(1)}%</p></div>
                </div>
                <div className="flex items-center gap-2 p-2.5 bg-rose-500/10 rounded-lg">
                  <TrendingUp className="h-4 w-4 text-rose-400 shrink-0" />
                  <div><p className="text-[11px] text-rose-400">Marge Revendeur</p><p className="text-sm font-bold text-foreground">{resellerMargin.toFixed(1)}%</p></div>
                </div>
                <div className="flex items-center gap-2 p-2.5 bg-teal-500/10 rounded-lg">
                  <Building className="h-4 w-4 text-teal-400 shrink-0" />
                  <div><p className="text-[11px] text-teal-400">Fournisseur</p><p className="text-sm font-bold text-foreground truncate">{product.provider || '—'}</p></div>
                </div>
              </div>
            </div>
          )}

          {/* Linked Sheets Section */}
          <div className="mb-5">
            <h3 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-1.5">
              <FileText className="h-4 w-4" /> Fiches Techniques ({linkedSheets.length})
            </h3>

            {linkedSheets.length > 0 ? (
              <div className="space-y-2 mb-3">
                {linkedSheets.map(sheet => (
                  <div key={sheet.id} className="flex items-center justify-between px-3 py-2 bg-secondary/50 rounded-lg">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground truncate">{sheet.title}</p>
                      <div className="flex gap-1.5 mt-0.5">
                        {sheet.manufacturer && <span className="text-[11px] text-muted-foreground">{sheet.manufacturer}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0 ml-2">
                      <a href={sheet.file_url} target="_blank" rel="noopener noreferrer"
                        className="p-1.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg transition-colors">
                        <Download className="h-3.5 w-3.5" />
                      </a>
                      {isAdminUser && (
                        <button onClick={() => unlinkSheet(sheet.id)} className="p-1.5 bg-destructive/10 hover:bg-destructive/20 text-destructive rounded-lg transition-colors">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground mb-2">Aucune fiche technique liée.</p>
            )}

            {/* Search existing sheets to link */}
            {isAdminUser && (
              <div className="space-y-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <input value={sheetSearchQuery} onChange={e => setSheetSearchQuery(e.target.value)}
                    placeholder="Rechercher une fiche à lier..."
                    className="w-full pl-9 pr-3 py-2 border border-input rounded-lg bg-background text-foreground text-sm" />
                </div>
                {sheetSearchResults.length > 0 && (
                  <div className="border border-border rounded-lg divide-y divide-border max-h-32 overflow-y-auto">
                    {sheetSearchResults.map(s => (
                      <button key={s.id} onClick={() => linkSheet(s)} className="w-full px-3 py-2 text-left hover:bg-accent transition-colors">
                        <p className="text-sm font-medium text-foreground truncate">{s.title}</p>
                        <p className="text-xs text-muted-foreground">{s.manufacturer}</p>
                      </button>
                    ))}
                  </div>
                )}

                {/* Upload new sheet */}
                <input ref={fileInputRef} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png"
                  onChange={handleUploadAndLink} className="hidden" id="techsheet-upload" />
                <label htmlFor="techsheet-upload"
                  className={`inline-flex items-center gap-1.5 px-4 py-2 bg-accent hover:bg-accent/80 text-foreground rounded-lg text-sm transition-colors cursor-pointer ${isUploading ? 'opacity-50 pointer-events-none' : ''}`}>
                  {isUploading ? <Loader className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                  <span>Ajouter une nouvelle fiche</span>
                </label>
              </div>
            )}
          </div>

          {/* Linked Photos Section */}
          {linkedPhotos.length > 0 && (
            <div className="mb-5">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                  <Images className="h-4 w-4 text-violet-500" /> Photos ({linkedPhotos.length})
                </h3>
                <a href={`/photos?barcode=${encodeURIComponent(product.barcode)}`} className="text-xs text-primary hover:underline">
                  Voir tout
                </a>
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {linkedPhotos.slice(0, 8).map(photo => (
                  <a
                    key={photo.id}
                    href={supabase.storage.from('product-photos').getPublicUrl(photo.storage_path).data.publicUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="aspect-square rounded-lg overflow-hidden border border-border/40 bg-secondary/30 hover:opacity-80 transition-opacity"
                    title={photo.title || photo.file_name}
                  >
                    <img
                      src={supabase.storage.from('product-photos').getPublicUrl(photo.storage_path).data.publicUrl}
                      alt={photo.title || photo.file_name}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="border-t border-border pt-4 flex flex-wrap gap-2">
            <button onClick={() => navigate('/')} className="flex items-center gap-1.5 px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg text-sm transition-colors">
              <Home className="h-3.5 w-3.5" /><span>Accueil</span>
            </button>
            <button onClick={handleBackToSearch} className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm transition-colors">
              <Search className="h-3.5 w-3.5" /><span>Recherche</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
