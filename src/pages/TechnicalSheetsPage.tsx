import React, { useState, useEffect, useCallback, useRef } from 'react';
import { FileText, Upload, Search, Link2, Trash2, Download, Eye, Share2, Copy, X, Plus, Loader, ExternalLink, Calendar, Package, CheckSquare } from 'lucide-react';
import { sheetsApi } from '@/lib/apiClient';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../hooks/useAuth';
import { useAppContext } from '../context/AppContext';
import { TechnicalSheet, SheetShareLink, Product } from '../types';

const CATEGORIES = ['Fours', 'Réfrigération', 'Lavage', 'Préparation', 'Cuisson', 'Ventilation', 'Divers'];
const SECTORS = ['Cafeteria', 'Restaurant', 'Patisserie', 'Boucherie', 'Hotellerie', 'Autre'];

export function TechnicalSheetsPage() {
  const { showToast } = useToast();
  const { isAdmin } = useAuth();
  const { state } = useAppContext();

  const [sheets, setSheets] = useState<TechnicalSheet[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [filterManufacturer, setFilterManufacturer] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterSector, setFilterSector] = useState('');

  // Upload state
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadManufacturer, setUploadManufacturer] = useState('');
  const [uploadCategory, setUploadCategory] = useState('');
  const [uploadSector, setUploadSector] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Bulk import state
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkFiles, setBulkFiles] = useState<File[]>([]);
  const [bulkManufacturer, setBulkManufacturer] = useState('');
  const [bulkCategory, setBulkCategory] = useState('');
  const [bulkSector, setBulkSector] = useState('');
  const [isBulkUploading, setIsBulkUploading] = useState(false);
  const [bulkProgress, setBulkProgress] = useState(0);
  const bulkFileInputRef = useRef<HTMLInputElement>(null);

  // Detail modal
  const [selectedSheet, setSelectedSheet] = useState<TechnicalSheet | null>(null);
  const [linkedProducts, setLinkedProducts] = useState<Product[]>([]);
  const [productSearchQuery, setProductSearchQuery] = useState('');
  const [productSearchResults, setProductSearchResults] = useState<Product[]>([]);
  const [selectedProductsToLink, setSelectedProductsToLink] = useState<Set<string>>(new Set());

  // PDF viewer modal
  const [pdfViewerUrl, setPdfViewerUrl] = useState<string | null>(null);

  // Share modal
  const [showShareModal, setShowShareModal] = useState(false);
  const [selectedForShare, setSelectedForShare] = useState<Set<string>>(new Set());
  const [shareTitle, setShareTitle] = useState('');
  const [shareExpiry, setShareExpiry] = useState<string>('never');
  const [isCreatingShare, setIsCreatingShare] = useState(false);
  const [shareLinks, setShareLinks] = useState<SheetShareLink[]>([]);
  const [showShareLinks, setShowShareLinks] = useState(false);

  const fetchSheets = useCallback(async () => {
    setLoading(true);
    try {
      const { sheets: data } = await sheetsApi.getAll();
      setSheets((data || []) as unknown as TechnicalSheet[]);
    } catch (err) {
      console.error('Error fetching sheets:', err);
      showToast({ type: 'error', message: 'Erreur lors du chargement des fiches techniques' });
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { fetchSheets(); }, [fetchSheets]);

  // Filtered sheets
  const filteredSheets = React.useMemo(() => {
    return sheets.filter(s => {
      const matchesQuery = !query || query.length < 2 ||
        s.title.toLowerCase().includes(query.toLowerCase()) ||
        s.manufacturer.toLowerCase().includes(query.toLowerCase()) ||
        s.category.toLowerCase().includes(query.toLowerCase());
      const matchesManufacturer = !filterManufacturer || s.manufacturer === filterManufacturer;
      const matchesCategory = !filterCategory || s.category === filterCategory;
      const matchesSector = !filterSector || s.sector === filterSector;
      return matchesQuery && matchesManufacturer && matchesCategory && matchesSector;
    });
  }, [sheets, query, filterManufacturer, filterCategory, filterSector]);

  const uniqueManufacturers = React.useMemo(() => {
    const set = new Set(sheets.map(s => s.manufacturer).filter(Boolean));
    return Array.from(set).sort();
  }, [sheets]);

  // Upload handler
  const handleUpload = async () => {
    if (!uploadFile || !uploadTitle.trim()) {
      showToast({ type: 'error', message: 'Titre et fichier requis' });
      return;
    }
    if (uploadFile.size > 50 * 1024 * 1024) {
      showToast({ type: 'error', message: 'Fichier trop volumineux (max 50 Mo)' });
      return;
    }
    setIsUploading(true);
    try {
      const { url, size, mimetype } = await sheetsApi.uploadFile(uploadFile);
      await sheetsApi.create({
        title: uploadTitle.trim(),
        manufacturer: uploadManufacturer.trim(),
        category: uploadCategory,
        sector: uploadSector,
        file_url: url,
        file_size: size,
        file_type: mimetype || uploadFile.type || 'application/pdf',
      });

      showToast({ type: 'success', message: 'Fiche technique ajoutée avec succès' });
      setShowUploadModal(false);
      setUploadFile(null);
      setUploadTitle('');
      setUploadManufacturer('');
      setUploadCategory('');
      setUploadSector('');
      fetchSheets();
    } catch (err) {
      console.error('Upload error:', err);
      showToast({ type: 'error', message: 'Erreur lors du téléchargement' });
    } finally {
      setIsUploading(false);
    }
  };

  // Bulk import handler
  const handleBulkImport = async () => {
    if (bulkFiles.length === 0) {
      showToast({ type: 'error', message: 'Sélectionnez au moins un fichier' });
      return;
    }
    setIsBulkUploading(true);
    setBulkProgress(0);
    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < bulkFiles.length; i++) {
      const file = bulkFiles[i];
      try {
        if (file.size > 50 * 1024 * 1024) { errorCount++; continue; }
        const title = file.name.replace(/\.[^/.]+$/, '');
        const { url, size, mimetype } = await sheetsApi.uploadFile(file);
        await sheetsApi.create({
          title,
          manufacturer: bulkManufacturer.trim(),
          category: bulkCategory,
          sector: bulkSector,
          file_url: url,
          file_size: size,
          file_type: mimetype || file.type || 'application/pdf',
        });
        successCount++;
      } catch {
        errorCount++;
      }
      setBulkProgress(Math.round(((i + 1) / bulkFiles.length) * 100));
    }

    showToast({
      type: errorCount > 0 ? 'warning' : 'success',
      message: `${successCount} fichier(s) importé(s)${errorCount > 0 ? `, ${errorCount} erreur(s)` : ''}`
    });
    setShowBulkModal(false);
    setBulkFiles([]);
    setBulkManufacturer('');
    setBulkCategory('');
    setBulkSector('');
    setBulkProgress(0);
    fetchSheets();
    setIsBulkUploading(false);
  };

  const handleDeleteSheet = async (sheet: TechnicalSheet) => {
    if (!confirm(`Supprimer "${sheet.title}" ?`)) return;
    try {
      await sheetsApi.delete(sheet.id);
      showToast({ type: 'success', message: 'Fiche technique supprimée' });
      if (selectedSheet?.id === sheet.id) setSelectedSheet(null);
      fetchSheets();
    } catch (err) {
      console.error('Delete error:', err);
      showToast({ type: 'error', message: 'Erreur lors de la suppression' });
    }
  };

  // View PDF in-app
  const handleViewPdf = async (fileUrl: string) => {
    try {
      const response = await fetch(fileUrl);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      setPdfViewerUrl(blobUrl);
    } catch {
      showToast({ type: 'error', message: 'Impossible d\'ouvrir le fichier' });
    }
  };

  const closePdfViewer = () => {
    if (pdfViewerUrl) URL.revokeObjectURL(pdfViewerUrl);
    setPdfViewerUrl(null);
  };

  // Detail modal: load linked products
  const openSheetDetail = async (sheet: TechnicalSheet) => {
    setSelectedSheet(sheet);
    setProductSearchQuery('');
    setProductSearchResults([]);
    setSelectedProductsToLink(new Set());
    try {
      const { sheet: fullSheet } = await sheetsApi.getById(sheet.id);
      const barcodes = ((fullSheet as any).products || []).map((l: any) => l.product_barcode);
      const linked = state.products.filter(p => barcodes.includes(p.barcode));
      setLinkedProducts(linked);
    } catch {
      setLinkedProducts([]);
    }
  };

  // Search products for linking
  useEffect(() => {
    if (productSearchQuery.length < 2) { setProductSearchResults([]); return; }
    const q = productSearchQuery.toLowerCase();
    const results = state.products.filter(p =>
      (p.name.toLowerCase().includes(q) || p.barcode.toLowerCase().includes(q) || p.brand.toLowerCase().includes(q))
      && !linkedProducts.some(lp => lp.barcode === p.barcode)
    ).slice(0, 20);
    setProductSearchResults(results);
  }, [productSearchQuery, state.products, linkedProducts]);

  const toggleProductSelect = (barcode: string) => {
    setSelectedProductsToLink(prev => {
      const next = new Set(prev);
      if (next.has(barcode)) next.delete(barcode); else next.add(barcode);
      return next;
    });
  };

  const linkSelectedProducts = async () => {
    if (!selectedSheet || selectedProductsToLink.size === 0) return;
    try {
      const barcodes = Array.from(selectedProductsToLink);
      await sheetsApi.linkProducts(selectedSheet.id, barcodes);
      const newLinked = state.products.filter(p => selectedProductsToLink.has(p.barcode));
      setLinkedProducts(prev => [...prev, ...newLinked]);
      setSelectedProductsToLink(new Set());
      setProductSearchResults(prev => prev.filter(p => !selectedProductsToLink.has(p.barcode)));
      showToast({ type: 'success', message: `${barcodes.length} produit(s) lié(s)` });
    } catch (err: any) {
      showToast({ type: 'error', message: 'Erreur lors de la liaison' });
    }
  };

  const linkProduct = async (product: Product) => {
    if (!selectedSheet) return;
    try {
      await sheetsApi.linkProducts(selectedSheet.id, [product.barcode]);
      setLinkedProducts(prev => [...prev, product]);
      showToast({ type: 'success', message: `${product.name} lié` });
    } catch (err: any) {
      showToast({ type: 'error', message: 'Erreur lors de la liaison' });
    }
  };

  const unlinkProduct = async (barcode: string) => {
    if (!selectedSheet) return;
    try {
      await sheetsApi.unlinkProduct(selectedSheet.id, barcode);
      setLinkedProducts(prev => prev.filter(p => p.barcode !== barcode));
      showToast({ type: 'success', message: 'Produit délié' });
    } catch {
      showToast({ type: 'error', message: 'Erreur' });
    }
  };

  // Share
  const toggleShareSelect = (id: string) => {
    setSelectedForShare(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const createShareLink = async () => {
    if (selectedForShare.size === 0) {
      showToast({ type: 'error', message: 'Sélectionnez au moins une fiche' });
      return;
    }
    setIsCreatingShare(true);
    try {
      const token = crypto.randomUUID().slice(0, 12);
      let expiresAt: string | null = null;
      if (shareExpiry === '1d') expiresAt = new Date(Date.now() + 86400000).toISOString();
      else if (shareExpiry === '7d') expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
      else if (shareExpiry === '30d') expiresAt = new Date(Date.now() + 30 * 86400000).toISOString();

      await sheetsApi.createShareLink({
        token,
        title: shareTitle.trim() || null,
        sheet_ids: Array.from(selectedForShare),
        expires_at: expiresAt,
      });

      const shareUrl = `${window.location.origin}/share/${token}`;
      await navigator.clipboard.writeText(shareUrl);
      showToast({ type: 'success', message: 'Lien de partage copié !' });
      setShowShareModal(false);
      setSelectedForShare(new Set());
      setShareTitle('');
      setShareExpiry('never');
    } catch (err) {
      console.error('Share error:', err);
      showToast({ type: 'error', message: 'Erreur lors de la création du lien' });
    } finally {
      setIsCreatingShare(false);
    }
  };

  const fetchShareLinks = async () => {
    try {
      const { links } = await sheetsApi.getShareLinks();
      setShareLinks((links || []) as unknown as SheetShareLink[]);
      setShowShareLinks(true);
    } catch { /* ignore */ }
  };

  const deleteShareLink = async (id: string) => {
    try {
      await sheetsApi.deleteShareLink(id);
      setShareLinks(prev => prev.filter(l => l.id !== id));
      showToast({ type: 'success', message: 'Lien supprimé' });
    } catch {
      showToast({ type: 'error', message: 'Erreur' });
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <FileText className="h-6 w-6 text-primary" /> Fiches Techniques
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{sheets.length} fiche{sheets.length !== 1 ? 's' : ''} technique{sheets.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex gap-2 flex-wrap justify-end">
          <button onClick={fetchShareLinks} className="flex items-center gap-1.5 px-3 py-2 bg-secondary hover:bg-secondary/80 text-secondary-foreground rounded-lg text-sm transition-colors">
            <Link2 className="h-3.5 w-3.5" /> Liens partagés
          </button>
          {selectedForShare.size > 0 && (
            <button onClick={() => setShowShareModal(true)} className="flex items-center gap-1.5 px-3 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm transition-colors">
              <Share2 className="h-3.5 w-3.5" /> Partager ({selectedForShare.size})
            </button>
          )}
          {isAdmin && (
            <>
              <button onClick={() => setShowBulkModal(true)} className="flex items-center gap-1.5 px-3 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-sm transition-colors">
                <Upload className="h-3.5 w-3.5" /> Import en masse
              </button>
              <button onClick={() => setShowUploadModal(true)} className="flex items-center gap-1.5 px-3 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg text-sm transition-colors">
                <Plus className="h-3.5 w-3.5" /> Ajouter
              </button>
            </>
          )}
        </div>
      </div>

      {/* Search & Filters */}
      <div className="glass rounded-xl p-4 mb-6">
        <div className="flex flex-col md:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Rechercher par titre, fabricant..."
              className="w-full pl-10 pr-4 py-2.5 border border-input rounded-lg bg-background text-foreground text-sm focus:ring-2 focus:ring-ring" />
          </div>
          <select value={filterManufacturer} onChange={e => setFilterManufacturer(e.target.value)}
            className="px-3 py-2.5 border border-input rounded-lg bg-background text-foreground text-sm">
            <option value="">Tous fabricants</option>
            {uniqueManufacturers.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)}
            className="px-3 py-2.5 border border-input rounded-lg bg-background text-foreground text-sm">
            <option value="">Toutes catégories</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={filterSector} onChange={e => setFilterSector(e.target.value)}
            className="px-3 py-2.5 border border-input rounded-lg bg-background text-foreground text-sm">
            <option value="">Tous secteurs</option>
            {SECTORS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      {/* Sheets Grid */}
      {loading ? (
        <div className="text-center py-12"><Loader className="h-8 w-8 animate-spin text-primary mx-auto" /></div>
      ) : filteredSheets.length === 0 ? (
        <div className="text-center py-12">
          <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">Aucune fiche technique trouvée</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredSheets.map(sheet => (
            <div key={sheet.id} className="glass rounded-xl p-4 hover:shadow-lg transition-all duration-200 group relative">
              <div className="absolute top-3 left-3">
                <input type="checkbox" checked={selectedForShare.has(sheet.id)}
                  onChange={() => toggleShareSelect(sheet.id)}
                  className="h-4 w-4 rounded border-input text-primary focus:ring-primary" />
              </div>

              <div className="ml-7">
                <h3 className="font-semibold text-foreground text-sm truncate mb-1 cursor-pointer hover:text-primary"
                  onClick={() => openSheetDetail(sheet)}>{sheet.title}</h3>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {sheet.manufacturer && (
                    <span className="px-1.5 py-0.5 bg-primary/10 text-primary text-[11px] rounded font-medium">{sheet.manufacturer}</span>
                  )}
                  {sheet.category && (
                    <span className="px-1.5 py-0.5 bg-violet-500/10 text-violet-500 text-[11px] rounded font-medium">{sheet.category}</span>
                  )}
                  {sheet.sector && (
                    <span className="px-1.5 py-0.5 bg-amber-500/10 text-amber-600 text-[11px] rounded font-medium">{sheet.sector}</span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground mb-3">
                  <span>{formatFileSize(sheet.file_size)}</span>
                  <span className="flex items-center gap-0.5"><Eye className="h-3 w-3" /> {sheet.view_count}</span>
                  <span className="flex items-center gap-0.5"><Download className="h-3 w-3" /> {sheet.download_count}</span>
                </div>
                <div className="flex gap-1.5">
                  <button onClick={() => handleViewPdf(sheet.file_url)}
                    className="flex items-center gap-1 px-2.5 py-1.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg text-xs transition-colors">
                    <Eye className="h-3 w-3" /> Voir
                  </button>
                  <button onClick={() => openSheetDetail(sheet)}
                    className="flex items-center gap-1 px-2.5 py-1.5 bg-secondary hover:bg-secondary/80 text-secondary-foreground rounded-lg text-xs transition-colors">
                    <Package className="h-3 w-3" /> Produits
                  </button>
                  {isAdmin && (
                    <button onClick={() => handleDeleteSheet(sheet)}
                      className="flex items-center gap-1 px-2.5 py-1.5 bg-destructive/10 hover:bg-destructive/20 text-destructive rounded-lg text-xs transition-colors">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Upload Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowUploadModal(false)}>
          <div className="bg-card rounded-xl p-6 max-w-md w-full shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-foreground">Ajouter une Fiche Technique</h2>
              <button onClick={() => setShowUploadModal(false)} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Titre *</label>
                <input value={uploadTitle} onChange={e => setUploadTitle(e.target.value)}
                  className="w-full px-3 py-2 border border-input rounded-lg bg-background text-foreground text-sm" placeholder="Nom du document" />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Fabricant</label>
                <input value={uploadManufacturer} onChange={e => setUploadManufacturer(e.target.value)}
                  className="w-full px-3 py-2 border border-input rounded-lg bg-background text-foreground text-sm" placeholder="Ex: Electrolux, Rational..." />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Catégorie</label>
                <select value={uploadCategory} onChange={e => setUploadCategory(e.target.value)}
                  className="w-full px-3 py-2 border border-input rounded-lg bg-background text-foreground text-sm">
                  <option value="">Aucune</option>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Secteur</label>
                <select value={uploadSector} onChange={e => setUploadSector(e.target.value)}
                  className="w-full px-3 py-2 border border-input rounded-lg bg-background text-foreground text-sm">
                  <option value="">Aucun</option>
                  {SECTORS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Fichier *</label>
                <input ref={fileInputRef} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png"
                  onChange={e => setUploadFile(e.target.files?.[0] || null)}
                  className="w-full text-sm text-foreground file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-primary file:text-primary-foreground file:text-sm file:cursor-pointer" />
                {uploadFile && <p className="text-xs text-muted-foreground mt-1">{formatFileSize(uploadFile.size)}</p>}
              </div>
              <button onClick={handleUpload} disabled={isUploading || !uploadFile || !uploadTitle.trim()}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg text-sm transition-colors disabled:opacity-50">
                {isUploading ? <Loader className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {isUploading ? 'Téléchargement...' : 'Ajouter'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Import Modal */}
      {showBulkModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => !isBulkUploading && setShowBulkModal(false)}>
          <div className="bg-card rounded-xl p-6 max-w-md w-full shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-foreground">Import en masse</h2>
              <button onClick={() => !isBulkUploading && setShowBulkModal(false)} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
            </div>
            <p className="text-sm text-muted-foreground mb-4">Sélectionnez plusieurs fichiers. Le nom du fichier sera utilisé comme titre.</p>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Fichiers *</label>
                <input ref={bulkFileInputRef} type="file" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png"
                  onChange={e => setBulkFiles(Array.from(e.target.files || []))}
                  className="w-full text-sm text-foreground file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-primary file:text-primary-foreground file:text-sm file:cursor-pointer" />
                {bulkFiles.length > 0 && <p className="text-xs text-muted-foreground mt-1">{bulkFiles.length} fichier(s) sélectionné(s)</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Fabricant (commun)</label>
                <input value={bulkManufacturer} onChange={e => setBulkManufacturer(e.target.value)}
                  className="w-full px-3 py-2 border border-input rounded-lg bg-background text-foreground text-sm" placeholder="Ex: Electrolux" />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Catégorie (commune)</label>
                <select value={bulkCategory} onChange={e => setBulkCategory(e.target.value)}
                  className="w-full px-3 py-2 border border-input rounded-lg bg-background text-foreground text-sm">
                  <option value="">Aucune</option>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Secteur (commun)</label>
                <select value={bulkSector} onChange={e => setBulkSector(e.target.value)}
                  className="w-full px-3 py-2 border border-input rounded-lg bg-background text-foreground text-sm">
                  <option value="">Aucun</option>
                  {SECTORS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              {isBulkUploading && (
                <div className="w-full bg-secondary rounded-full h-2.5">
                  <div className="bg-primary h-2.5 rounded-full transition-all" style={{ width: `${bulkProgress}%` }} />
                </div>
              )}
              <button onClick={handleBulkImport} disabled={isBulkUploading || bulkFiles.length === 0}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-sm transition-colors disabled:opacity-50">
                {isBulkUploading ? <Loader className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {isBulkUploading ? `Import... ${bulkProgress}%` : `Importer ${bulkFiles.length} fichier(s)`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sheet Detail Modal */}
      {selectedSheet && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setSelectedSheet(null)}>
          <div className="bg-card rounded-xl p-6 max-w-lg w-full shadow-2xl max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-foreground truncate pr-4">{selectedSheet.title}</h2>
              <button onClick={() => setSelectedSheet(null)} className="text-muted-foreground hover:text-foreground shrink-0"><X className="h-5 w-5" /></button>
            </div>

            {/* Metadata */}
            <div className="flex flex-wrap gap-2 mb-4">
              {selectedSheet.manufacturer && <span className="px-2 py-1 bg-primary/10 text-primary text-xs rounded-lg">{selectedSheet.manufacturer}</span>}
              {selectedSheet.category && <span className="px-2 py-1 bg-violet-500/10 text-violet-500 text-xs rounded-lg">{selectedSheet.category}</span>}
              {selectedSheet.sector && <span className="px-2 py-1 bg-amber-500/10 text-amber-600 text-xs rounded-lg">{selectedSheet.sector}</span>}
              <span className="px-2 py-1 bg-secondary text-secondary-foreground text-xs rounded-lg">{formatFileSize(selectedSheet.file_size)}</span>
            </div>

            <div className="flex gap-2 mb-4">
              <button onClick={() => handleViewPdf(selectedSheet.file_url)}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg text-sm transition-colors">
                <Eye className="h-3.5 w-3.5" /> Voir
              </button>
              <a href={selectedSheet.file_url} download
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-secondary hover:bg-secondary/80 text-secondary-foreground rounded-lg text-sm transition-colors">
                <Download className="h-3.5 w-3.5" /> Télécharger
              </a>
            </div>

            {/* Linked Products */}
            <div className="border-t border-border pt-4">
              <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-1.5">
                <Package className="h-4 w-4" /> Produits liés ({linkedProducts.length})
              </h3>

              {linkedProducts.length > 0 && (
                <div className="space-y-1.5 mb-3">
                  {linkedProducts.map(p => (
                    <div key={p.barcode} className="flex items-center justify-between px-3 py-2 bg-secondary/50 rounded-lg">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{p.name}</p>
                        <p className="text-xs text-muted-foreground">#{p.barcode} • {p.brand}</p>
                      </div>
                      <button onClick={() => unlinkProduct(p.barcode)} className="text-destructive hover:text-destructive/80 shrink-0 ml-2">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Search to link */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <input value={productSearchQuery} onChange={e => setProductSearchQuery(e.target.value)}
                  placeholder="Rechercher un produit à lier..."
                  className="w-full pl-9 pr-3 py-2 border border-input rounded-lg bg-background text-foreground text-sm" />
              </div>

              {selectedProductsToLink.size > 0 && (
                <button onClick={linkSelectedProducts}
                  className="mt-2 w-full flex items-center justify-center gap-2 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm transition-colors">
                  <CheckSquare className="h-3.5 w-3.5" /> Lier {selectedProductsToLink.size} produit(s)
                </button>
              )}

              {productSearchResults.length > 0 && (
                <div className="mt-2 border border-border rounded-lg divide-y divide-border max-h-48 overflow-y-auto">
                  {productSearchResults.map(p => (
                    <div key={p.barcode} className="flex items-center px-3 py-2 hover:bg-accent transition-colors">
                      <input type="checkbox" checked={selectedProductsToLink.has(p.barcode)}
                        onChange={() => toggleProductSelect(p.barcode)}
                        className="h-4 w-4 rounded border-input text-primary focus:ring-primary mr-3 shrink-0" />
                      <button onClick={() => toggleProductSelect(p.barcode)} className="flex-1 text-left min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{p.name}</p>
                        <p className="text-xs text-muted-foreground">#{p.barcode} • {p.brand}</p>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* PDF Viewer Modal */}
      {pdfViewerUrl && (
        <div className="fixed inset-0 bg-black/80 z-[60] flex flex-col" onClick={closePdfViewer}>
          <div className="flex items-center justify-end p-3">
            <button onClick={closePdfViewer} className="p-2 bg-white/10 hover:bg-white/20 rounded-lg text-white transition-colors">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="flex-1 px-4 pb-4" onClick={e => e.stopPropagation()}>
            <iframe src={pdfViewerUrl} className="w-full h-full rounded-lg bg-white" title="PDF Viewer" />
          </div>
        </div>
      )}

      {/* Share Modal */}
      {showShareModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowShareModal(false)}>
          <div className="bg-card rounded-xl p-6 max-w-md w-full shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-foreground">Créer un lien de partage</h2>
              <button onClick={() => setShowShareModal(false)} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
            </div>
            <p className="text-sm text-muted-foreground mb-4">{selectedForShare.size} fiche{selectedForShare.size > 1 ? 's' : ''} sélectionnée{selectedForShare.size > 1 ? 's' : ''}</p>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Titre de la collection (optionnel)</label>
                <input value={shareTitle} onChange={e => setShareTitle(e.target.value)}
                  className="w-full px-3 py-2 border border-input rounded-lg bg-background text-foreground text-sm" placeholder="Ex: Documentation Fours Electrolux" />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Expiration</label>
                <select value={shareExpiry} onChange={e => setShareExpiry(e.target.value)}
                  className="w-full px-3 py-2 border border-input rounded-lg bg-background text-foreground text-sm">
                  <option value="never">Jamais</option>
                  <option value="1d">1 jour</option>
                  <option value="7d">7 jours</option>
                  <option value="30d">30 jours</option>
                </select>
              </div>
              <button onClick={createShareLink} disabled={isCreatingShare}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm transition-colors disabled:opacity-50">
                {isCreatingShare ? <Loader className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />}
                Créer et copier le lien
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Share Links List Modal */}
      {showShareLinks && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowShareLinks(false)}>
          <div className="bg-card rounded-xl p-6 max-w-lg w-full shadow-2xl max-h-[70vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-foreground">Liens de partage</h2>
              <button onClick={() => setShowShareLinks(false)} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
            </div>
            {shareLinks.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">Aucun lien de partage</p>
            ) : (
              <div className="space-y-3">
                {shareLinks.map(link => {
                  const isExpired = link.expires_at && new Date(link.expires_at) < new Date();
                  const shareUrl = `${window.location.origin}/share/${link.token}`;
                  return (
                    <div key={link.id} className={`p-3 rounded-lg border ${isExpired ? 'border-destructive/30 bg-destructive/5' : 'border-border bg-secondary/30'}`}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium text-sm text-foreground">{link.title || 'Sans titre'}</span>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-muted-foreground flex items-center gap-0.5"><Eye className="h-3 w-3" /> {link.view_count}</span>
                          {isExpired && <span className="text-xs text-destructive font-medium">Expiré</span>}
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground mb-2">{link.sheet_ids.length} fiche{link.sheet_ids.length > 1 ? 's' : ''} • {new Date(link.created_at).toLocaleDateString('fr-FR')}</p>
                      <div className="flex gap-1.5">
                        <button onClick={async () => { await navigator.clipboard.writeText(shareUrl); showToast({ type: 'success', message: 'Lien copié' }); }}
                          className="flex items-center gap-1 px-2 py-1 bg-primary/10 text-primary rounded text-xs hover:bg-primary/20">
                          <Copy className="h-3 w-3" /> Copier
                        </button>
                        <a href={shareUrl} target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-1 px-2 py-1 bg-secondary text-secondary-foreground rounded text-xs hover:bg-secondary/80">
                          <ExternalLink className="h-3 w-3" /> Ouvrir
                        </a>
                        <button onClick={() => deleteShareLink(link.id)}
                          className="flex items-center gap-1 px-2 py-1 bg-destructive/10 text-destructive rounded text-xs hover:bg-destructive/20">
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default TechnicalSheetsPage;