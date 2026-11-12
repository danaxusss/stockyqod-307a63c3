import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Package, ArrowLeft, ChevronRight, Copy, MapPin, ShoppingCart, Home, AlertCircle, Search, Calculator, Plus, Minus, Upload, Download, Loader, FileText, X, Images, ImagePlus, Globe, Settings } from 'lucide-react';
import { Product, TechnicalSheet, StockLocation } from '../types';
import { useAppContext } from '../context/AppContext';
import { searchStateManager } from '../utils/searchStateManager';
import { StockLocationsService } from '../utils/supabaseStockLocations';
import { useQuoteCart } from '../hooks/useQuoteCart';
import { useToast } from '../context/ToastContext';
import { QuoteManager } from '../utils/quoteManager';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useProductOverrides } from '../hooks/useProductOverrides';
import { resolveProductImageUrl, uploadPrimaryProductImage } from '../utils/productImages';
import { SectorPicker } from '../components/SectorPicker';
import { TechnicalSheetButton } from '../components/TechnicalSheetButton';
import { TechnicalSheetFinder } from '../components/TechnicalSheetFinder';
import { ImageViewer } from '../components/ImageViewer';
import { BusinessSectorsService, sectorNames, useBusinessSectors } from '../utils/businessSectors';
import { KIOSK_CATEGORIES, KIOSK_CATEGORY_HELP } from '../utils/kioskCategories';
import { formatMoney } from '../utils/format';

export function ProductDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { canAccessStockLocation, canAccessBrand, canCreateQuote, getDisplayPrice, getPriceDisplayType, canEditProducts, companyId, currentUser } = useAuth();
  const { state, syncData, applyProductChanges } = useAppContext();
  const [product, setProduct] = useState<Product | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [marginPercentage, setMarginPercentage] = useState(() => {
    const saved = localStorage.getItem('inventory_margin_percentage');
    return saved ? parseInt(saved) : 30;
  });
  const [quantity, setQuantity] = useState(1);
  const [isSheetUploading, setIsSheetUploading] = useState(false);
  const sheetFileInputRef = useRef<HTMLInputElement>(null);
  const [isImageUploading, setIsImageUploading] = useState(false);
  const { sectors } = useBusinessSectors();
  const imageFileInputRef = useRef<HTMLInputElement>(null);
  
  // Linked sheets state
  const [linkedSheets, setLinkedSheets] = useState<TechnicalSheet[]>([]);
  const [sheetSearchQuery, setSheetSearchQuery] = useState('');
  const [sheetSearchResults, setSheetSearchResults] = useState<TechnicalSheet[]>([]);
  const [allSheets, setAllSheets] = useState<TechnicalSheet[]>([]);
  const [sheetFinderOpen, setSheetFinderOpen] = useState(false);

  const { addToCart } = useQuoteCart();
  const { showToast } = useToast();
  const { getOriginalName, getAllNames } = useProductOverrides();
  const quoteManager = QuoteManager.getInstance();
  const userPriceDisplayType = getPriceDisplayType();
  const [cameFromSearch, setCameFromSearch] = useState(false);
  const [stockLocations, setStockLocations] = useState<StockLocation[]>([]);

  useEffect(() => {
    const searchState = searchStateManager.getState();
    setCameFromSearch(!!searchState);
    StockLocationsService.getStockLocations().then(setStockLocations).catch(() => {});
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
    addToCart(product, 'normal', marginPercentage, quantity);
    showToast({ type: 'success', title: 'Ajouté au devis', message: `${quantity > 1 ? `${quantity} × ` : ''}${product.name} ajouté au devis` });
    setQuantity(1);
    if ('vibrate' in navigator) navigator.vibrate(100);
  };

  // Linked photos state
  const [linkedPhotos, setLinkedPhotos] = useState<{ id: string; storage_path: string; title: string; file_name: string }[]>([]);
  const [viewerImage, setViewerImage] = useState<{ src: string; alt: string } | null>(null);

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
    setIsSheetUploading(true);
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
      setIsSheetUploading(false);
      if (sheetFileInputRef.current) sheetFileInputRef.current.value = '';
    }
  };

  const handlePrimaryImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !product) return;
    if (!companyId) {
      showToast({ type: 'error', message: 'Aucune société associée' });
      if (imageFileInputRef.current) imageFileInputRef.current.value = '';
      return;
    }
    if (product.image && !window.confirm('Ce produit possède déjà une image. Voulez-vous la remplacer ?')) {
      if (imageFileInputRef.current) imageFileInputRef.current.value = '';
      return;
    }

    setIsImageUploading(true);
    try {
      const storagePath = await uploadPrimaryProductImage({
        product,
        file,
        companyId,
        createdBy: currentUser?.username,
        replaceExisting: !!product.image,
      });
      setProduct(current => current ? { ...current, image: storagePath } : current);
      await Promise.all([syncData(true), loadLinkedPhotos()]);
      showToast({ type: 'success', message: product.image ? 'Image produit remplacée' : 'Image produit ajoutée' });
    } catch (uploadError) {
      const message = uploadError instanceof Error ? uploadError.message : 'Erreur lors de l’import de l’image';
      showToast({ type: 'error', message });
    } finally {
      setIsImageUploading(false);
      if (imageFileInputRef.current) imageFileInputRef.current.value = '';
    }
  };

  const updateSectors = async (sectorIds: string[]) => {
    if (!product) return;
    const previous = product.sector_ids || [];
    setProduct(current => current ? { ...current, sector_ids: sectorIds } : current);
    try {
      await BusinessSectorsService.setProductSectors(product.barcode, sectorIds);
      // Without this the product list (and this page, when reopened) keeps the old sectors until the next sync.
      applyProductChanges({ [product.barcode]: { sector_ids: sectorIds } });
      showToast({ type: 'success', message: 'Secteurs enregistrés' });
    } catch (sectorError) {
      setProduct(current => current ? { ...current, sector_ids: previous } : current);
      showToast({ type: 'error', title: 'Secteur non enregistré', message: sectorError instanceof Error ? sectorError.message : 'Erreur inconnue' });
    }
  };

  const updateKioskCategory = async (value: Product['kiosk_category']) => {
    if (!product || !canEditProducts) return;
    const previous = product.kiosk_category || null;
    setProduct(current => current ? { ...current, kiosk_category: value } : current);
    const { error: categoryError } = await supabase.from('products')
      .update({ kiosk_category: value })
      .eq('barcode', product.barcode);
    if (categoryError) {
      setProduct(current => current ? { ...current, kiosk_category: previous } : current);
      showToast({ type: 'error', title: 'Classement impossible', message: categoryError.message });
      return;
    }
    applyProductChanges({ [product.barcode]: { kiosk_category: value } });
    showToast({ type: 'success', message: 'Type kiosque mis à jour' });
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
        <div className="rounded-xl border border-border bg-card p-8 text-center shadow-sm">
          <Package className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-foreground mb-2">Produit introuvable</h1>
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
              <button onClick={handleBackToSearch} className="flex items-center space-x-2 px-6 py-2 border border-border hover:bg-secondary text-foreground rounded-lg transition-colors">
                <Search className="h-4 w-4" /><span>Retour à la recherche</span>
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
  // Same rule as before: resellers see their price but do not build quotes here.
  const canAddToQuote = canCreateQuote() && userPriceDisplayType !== 'reseller';
  const imageUrl = resolveProductImageUrl(product.image);
  const brandOriginal = product.brand ? getOriginalName('brand', product.brand) : null;
  const providerOriginal = product.provider ? getOriginalName('provider', product.provider) : null;
  const kioskLabel = KIOSK_CATEGORIES.find(category => category.value === product.kiosk_category)?.label || 'Non classé';
  const sectorLabel = sectorNames(product.sector_ids, sectors).join(', ') || 'Aucun secteur';
  const photoUrl = (path: string) => supabase.storage.from('product-photos').getPublicUrl(path).data.publicUrl;
  const panel = 'rounded-xl border border-border bg-card shadow-sm';
  const locationLabel = (locKey: string) => {
    const loc = stockLocations.find(l =>
      l.abbreviation === locKey ||
      l.name === locKey ||
      l.name.toLowerCase().replace(/\s+/g, '_') === locKey
    );
    const label = loc?.name || locKey.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    return { label, abbrev: loc?.abbreviation || locKey };
  };

  const quantityStepper = (size: 'md' | 'lg' = 'md') => (
    <div className="flex shrink-0 items-center rounded-lg border border-input bg-background">
      <button type="button" onClick={() => setQuantity(q => Math.max(1, q - 1))} disabled={quantity <= 1} aria-label="Diminuer la quantité"
        className={`flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-40 ${size === 'lg' ? 'h-11 w-10' : 'h-10 w-9'}`}><Minus className="h-4 w-4" /></button>
      <input type="number" min={1} value={quantity} onChange={e => setQuantity(Math.max(1, parseInt(e.target.value) || 1))} onFocus={e => e.target.select()} aria-label="Quantité"
        className="h-10 w-10 border-0 bg-transparent p-0 text-center text-sm font-semibold tabular-nums text-foreground [appearance:textfield] focus:ring-0 [&::-webkit-inner-spin-button]:appearance-none" />
      <button type="button" onClick={() => setQuantity(q => q + 1)} aria-label="Augmenter la quantité"
        className={`flex items-center justify-center text-muted-foreground hover:text-foreground ${size === 'lg' ? 'h-11 w-10' : 'h-10 w-9'}`}><Plus className="h-4 w-4" /></button>
    </div>
  );

  return (
    <div className="mx-auto max-w-6xl pb-28 md:pb-0">
      {viewerImage && <ImageViewer src={viewerImage.src} alt={viewerImage.alt} onClose={() => setViewerImage(null)} />}

      {/* Title */}
      <div className="mb-4">
        <nav aria-label="Fil d’Ariane" className="hidden items-center gap-1.5 text-sm text-muted-foreground sm:flex">
          <button type="button" onClick={handleBackNavigation} className="mr-1 flex items-center gap-1 text-primary-text hover:underline">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />{cameFromSearch ? 'Retour à la recherche' : 'Retour'}
          </button>
          <span aria-hidden="true">·</span>
          <Link to="/products" className="hover:text-foreground">Produits</Link>
          <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="truncate text-foreground">{product.name}</span>
        </nav>
        <div className="mt-1 flex items-start gap-2">
          <h1 className="min-w-0 text-xl font-bold leading-tight tracking-tight text-foreground sm:text-2xl">{product.name}</h1>
          <TechnicalSheetButton
            sheets={linkedSheets}
            canSearch={canEditProducts}
            onSearch={() => setSheetFinderOpen(true)}
            className="mt-0.5 shrink-0 p-1"
            iconClassName="h-5 w-5"
          />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {[
            product.brand ? `${product.brand}${brandOriginal ? ` (ex : ${brandOriginal})` : ''}` : '',
            product.barcode,
            product.provider ? `${product.provider}${providerOriginal ? ` (ex : ${providerOriginal})` : ''}` : '',
          ].filter(Boolean).join(' · ')}
        </p>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[22rem_minmax(0,1fr)]">
        {/* Image and gallery */}
        <div className="space-y-3">
          <div className="mx-auto flex aspect-[4/5] max-h-[34vh] w-auto max-w-full items-center sm:max-h-none sm:w-full sm:max-w-[18rem] lg:max-w-[22rem] justify-center overflow-hidden rounded-xl border border-border bg-white">
            {imageUrl ? (
              <button type="button" onClick={() => setViewerImage({ src: imageUrl, alt: product.name })} aria-label="Agrandir l’image" className="h-full w-full cursor-zoom-in">
                <img src={imageUrl} alt={product.name} className="h-full w-full object-contain" />
              </button>
            ) : (
              <div className="px-4 text-center text-muted-foreground">
                <img src={`${import.meta.env.BASE_URL || '/'}stocky-logo.png`} alt="" className="mx-auto h-16 w-28 object-contain opacity-35" />
                <p className="mt-2 text-xs">Pas encore d’image</p>
              </div>
            )}
          </div>
          {linkedPhotos.length > 0 && (
            <div className="mx-auto max-w-[22rem]">
              <div className="mb-1.5 flex items-center justify-between">
                <p className="flex items-center gap-1.5 text-sm font-medium text-foreground"><Images className="h-4 w-4 text-primary-text" aria-hidden="true" />Photos ({linkedPhotos.length})</p>
                <a href={`/photos?barcode=${encodeURIComponent(product.barcode)}`} className="text-sm text-primary-text hover:underline">Voir tout</a>
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {linkedPhotos.slice(0, 8).map(photo => (
                  <button
                    type="button"
                    key={photo.id}
                    onClick={() => setViewerImage({ src: photoUrl(photo.storage_path), alt: photo.title || photo.file_name })}
                    className="aspect-[4/5] cursor-zoom-in overflow-hidden rounded-lg border border-border bg-white transition-opacity hover:opacity-80"
                    title={photo.title || photo.file_name}
                  >
                    <img src={photoUrl(photo.storage_path)} alt={photo.title || photo.file_name} className="h-full w-full object-contain" loading="lazy" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="min-w-0 space-y-4">
          {/* Price, stock and add to quote */}
          <section className={`${panel} p-4 sm:p-5`} aria-label="Prix et disponibilité">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-sm text-muted-foreground">{userPriceDisplayType === 'reseller' ? 'Prix revendeur' : 'Prix'}</p>
                <p className="text-3xl font-bold tabular-nums tracking-tight text-foreground">{formatMoney(displayPrice)}</p>
              </div>
              <span className={`rounded-full px-3 py-1 text-sm font-semibold ${totalStock > 0 ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-secondary text-muted-foreground'}`}>
                {totalStock > 0 ? `${totalStock} en stock` : 'Sur commande'}
              </span>
            </div>

            {canAddToQuote && (
              <div className="mt-4 border-t border-border pt-4">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  <label className="flex items-center gap-1.5 text-muted-foreground">
                    <Calculator className="h-4 w-4" aria-hidden="true" />Marge
                    <select value={marginPercentage} onChange={(e) => setMarginPercentage(parseInt(e.target.value))}
                      className="rounded-md border border-input bg-background px-2 py-1 text-sm font-semibold text-foreground">
                      {marginOptions.map((p) => <option key={p} value={p}>{p} %</option>)}
                    </select>
                  </label>
                  <span className="text-muted-foreground">achat {formatMoney(product.buyprice)} + {marginPercentage} % =</span>
                  <span className="font-semibold tabular-nums text-foreground">{formatMoney(finalPrice)}</span>
                </div>
                <div className="mt-3 hidden items-center gap-2 lg:flex">
                  {quantityStepper('md')}
                  <button type="button" onClick={handleAddToCart}
                    className="flex h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90">
                    <ShoppingCart className="h-4 w-4" aria-hidden="true" />Ajouter au devis
                  </button>
                  <button type="button" onClick={handleCopy} title="Copier la ligne (marque, code, désignation, prix)"
                    className="flex h-10 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-semibold text-foreground hover:bg-secondary">
                    <Copy className="h-4 w-4" aria-hidden="true" />Copier
                  </button>
                </div>
                <button type="button" onClick={handleCopy} className="mt-3 flex items-center gap-1.5 text-sm font-semibold text-primary-text lg:hidden">
                  <Copy className="h-4 w-4" aria-hidden="true" />Copier la ligne
                </button>
              </div>
            )}
          </section>

          {/* Stock by location */}
          <section className={panel} aria-labelledby="product-stock-title">
            <div className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-5">
              <h2 id="product-stock-title" className="font-semibold text-foreground">Stock par emplacement</h2>
              <span className="text-sm text-muted-foreground">{accessibleStockLocations.length} emplacement{accessibleStockLocations.length !== 1 ? 's' : ''}</span>
            </div>
            {accessibleStockLocations.length > 0 ? (
              <ul className="divide-y divide-border">
                {accessibleStockLocations.map(([locKey, level]) => {
                  const { label, abbrev } = locationLabel(locKey);
                  return (
                    <li key={locKey} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
                      <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span className="min-w-0 flex-1 text-sm text-foreground">
                        {label}
                        {abbrev !== label && <span className="ml-1.5 font-mono text-xs text-muted-foreground">{abbrev}</span>}
                      </span>
                      <span className={`text-sm font-semibold tabular-nums ${level > 0 ? 'text-foreground' : 'text-muted-foreground'}`}>{level}</span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="px-5 py-4 text-sm text-muted-foreground">Aucun stock dans vos emplacements.</p>
            )}
          </section>

          {/* Prices and classification */}
          <section className={panel} aria-labelledby="product-details-title">
            <h2 id="product-details-title" className="border-b border-border px-4 py-3 font-semibold text-foreground sm:px-5">Détails</h2>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-4 py-4 text-sm sm:grid-cols-3 sm:px-5">
              {userPriceDisplayType !== 'reseller' && (
                <>
                  <div><dt className="text-muted-foreground">Prix normal</dt><dd className="font-semibold tabular-nums text-foreground">{formatMoney(product.price)}</dd></div>
                  <div><dt className="text-muted-foreground">Prix revendeur</dt><dd className="font-semibold tabular-nums text-foreground">{formatMoney(product.reseller_price)}</dd></div>
                  <div><dt className="text-muted-foreground">Prix d’achat</dt><dd className="font-semibold tabular-nums text-foreground">{formatMoney(product.buyprice)}</dd></div>
                  <div><dt className="text-muted-foreground">Marge normale</dt><dd className="font-semibold tabular-nums text-foreground">{normalMargin.toFixed(1).replace('.', ',')} %</dd></div>
                  <div><dt className="text-muted-foreground">Marge revendeur</dt><dd className="font-semibold tabular-nums text-foreground">{resellerMargin.toFixed(1).replace('.', ',')} %</dd></div>
                  <div><dt className="text-muted-foreground">Fournisseur</dt><dd className="truncate font-semibold text-foreground">{product.provider || '—'}</dd></div>
                </>
              )}
              <div><dt className="text-muted-foreground">Type kiosque</dt><dd className="font-semibold text-foreground">{kioskLabel}</dd></div>
              <div className="col-span-2"><dt className="text-muted-foreground">Secteur</dt><dd className="font-semibold text-foreground">{sectorLabel}</dd></div>
            </dl>
          </section>

          {/* Technical sheets */}
          <section className={panel} aria-labelledby="product-sheets-title">
            <h2 id="product-sheets-title" className="flex items-center gap-1.5 border-b border-border px-4 py-3 font-semibold text-foreground sm:px-5">
              <FileText className="h-4 w-4" aria-hidden="true" />Fiches techniques ({linkedSheets.length})
            </h2>
            {linkedSheets.length > 0 ? (
              <ul className="divide-y divide-border">
                {linkedSheets.map(sheet => (
                  <li key={sheet.id} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">{sheet.title}</p>
                      {sheet.manufacturer && <p className="text-xs text-muted-foreground">{sheet.manufacturer}</p>}
                    </div>
                    <a href={sheet.file_url} target="_blank" rel="noopener noreferrer" aria-label={`Ouvrir ${sheet.title}`}
                      className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-semibold text-foreground hover:bg-secondary">
                      <Download className="h-4 w-4" aria-hidden="true" />Ouvrir
                    </a>
                    {canEditProducts && (
                      <button type="button" onClick={() => unlinkSheet(sheet.id)} title="Retirer le lien (la fiche reste dans la bibliothèque)" aria-label={`Retirer ${sheet.title}`}
                        className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 py-4 text-sm text-muted-foreground">Aucune fiche technique liée.</p>
            )}
          </section>
        </div>
      </div>

      {/* Settings, for those who can edit products */}
      {canEditProducts && (
        <section className={`${panel} mt-5`} aria-labelledby="product-settings-title">
          <div className="flex items-center gap-2 border-b border-border px-4 py-3 sm:px-5">
            <Settings className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <h2 id="product-settings-title" className="font-semibold text-foreground">Paramètres</h2>
          </div>
          <div className="grid gap-6 p-4 sm:p-5 md:grid-cols-2">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Image principale</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Partagée par la liste Stocky, le catalogue, le kiosque et les exports de devis. Format portrait 4:5 recommandé (par exemple 1080 × 1350 px) : elle s’affiche en entier, sans être recadrée.
              </p>
              <input ref={imageFileInputRef} type="file" accept="image/*" onChange={handlePrimaryImageUpload} className="hidden" id="product-image-upload" />
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={() => imageFileInputRef.current?.click()} disabled={isImageUploading || !companyId}
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                  {isImageUploading ? <Loader className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                  {isImageUploading ? 'Import en cours…' : product.image ? 'Remplacer l’image' : 'Ajouter une image'}
                </button>
                <button type="button" onClick={() => navigate(`/photos/finder?barcode=${encodeURIComponent(product.barcode)}`)}
                  className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-semibold text-foreground hover:bg-secondary">
                  <Globe className="h-4 w-4" />Chercher sur le web
                </button>
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">JPG, PNG ou WebP · maximum 10 Mo</p>
            </div>

            <div className="space-y-4">
              <label className="block">
                <span className="mb-1 block text-sm font-semibold text-foreground">Type de produit pour le kiosque</span>
                <select value={product.kiosk_category || ''} onChange={event => updateKioskCategory((event.target.value || null) as Product['kiosk_category'])}
                  className="h-10 w-full max-w-xs rounded-lg border border-input bg-background px-3 text-sm text-foreground">
                  <option value="">Non classé</option>
                  {KIOSK_CATEGORIES.map(category => <option key={category.value} value={category.value}>{category.label}</option>)}
                </select>
                <span className="mt-1 block text-xs leading-snug text-muted-foreground">{KIOSK_CATEGORY_HELP}</span>
              </label>
              <div>
                <span className="mb-1 block text-sm font-semibold text-foreground">Secteur</span>
                <div className="max-w-xs">
                  <SectorPicker sectors={sectors} value={product.sector_ids || []} onChange={updateSectors}
                    onCreate={name => BusinessSectorsService.create(name)} size="md" />
                </div>
              </div>
            </div>

            <div className="md:col-span-2">
              <h3 className="text-sm font-semibold text-foreground">Lier une fiche technique</h3>
              <div className="relative mt-2 max-w-md">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <input value={sheetSearchQuery} onChange={e => setSheetSearchQuery(e.target.value)}
                  placeholder="Rechercher une fiche de la bibliothèque…" aria-label="Rechercher une fiche à lier"
                  className="w-full rounded-lg border border-input bg-background py-2 pl-9 pr-3 text-sm text-foreground" />
              </div>
              {sheetSearchResults.length > 0 && (
                <div className="mt-2 max-h-40 max-w-md divide-y divide-border overflow-y-auto rounded-lg border border-border">
                  {sheetSearchResults.map(s => (
                    <button key={s.id} type="button" onClick={() => linkSheet(s)} className="w-full px-3 py-2 text-left transition-colors hover:bg-secondary">
                      <p className="truncate text-sm font-medium text-foreground">{s.title}</p>
                      <p className="text-xs text-muted-foreground">{s.manufacturer}</p>
                    </button>
                  ))}
                </div>
              )}
              <input ref={sheetFileInputRef} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png"
                onChange={handleUploadAndLink} className="hidden" id="techsheet-upload" />
              <div className="mt-3 flex flex-wrap gap-2">
                <label htmlFor="techsheet-upload"
                  className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-semibold text-foreground hover:bg-secondary ${isSheetUploading ? 'pointer-events-none opacity-50' : ''}`}>
                  {isSheetUploading ? <Loader className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  Ajouter une nouvelle fiche
                </label>
                <button type="button" onClick={() => setSheetFinderOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-semibold text-foreground hover:bg-secondary">
                  <Globe className="h-4 w-4" />Rechercher en ligne
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Phone: price and add to quote stay at hand, above the tab bar */}
      {canAddToQuote && (
        <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-20 border-t border-border bg-card px-4 py-2.5 shadow-[0_-4px_16px_rgba(17,24,39,0.06)] md:hidden">
          <div className="mx-auto flex max-w-3xl items-center gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground">Prix</p>
              <p className="truncate text-lg font-bold tabular-nums leading-tight text-foreground">{formatMoney(displayPrice)}</p>
            </div>
            {quantityStepper('md')}
            <button type="button" onClick={handleAddToCart}
              className="flex h-11 shrink-0 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground">
              Ajouter
            </button>
          </div>
        </div>
      )}

      {sheetFinderOpen && (
        <TechnicalSheetFinder
          product={product}
          linkedSheetIds={linkedSheets.map(sheet => sheet.id)}
          onLinked={sheet => {
            setLinkedSheets(prev => prev.some(linked => linked.id === sheet.id) ? prev : [...prev, sheet]);
            setAllSheets(prev => prev.some(known => known.id === sheet.id) ? prev : [...prev, sheet]);
          }}
          onClose={() => setSheetFinderOpen(false)}
        />
      )}
    </div>
  );
}
