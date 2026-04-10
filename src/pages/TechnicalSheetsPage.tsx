import React, { useState, useEffect, useCallback, useRef } from 'react';
import { FileText, Upload, Search, Link2, Trash2, Download, Eye, Share2, Copy, X, Plus, Loader, ExternalLink, Calendar, Package } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../hooks/useAuth';
import { useAppContext } from '../context/AppContext';
import { TechnicalSheet, SheetShareLink, Product } from '../types';

const CATEGORIES = ['Fours', 'Réfrigération', 'Lavage', 'Préparation', 'Cuisson', 'Ventilation', 'Divers'];

export function TechnicalSheetsPage() {
  const { showToast } = useToast();
  const { isAdmin } = useAuth();
  const { state } = useAppContext();

  const [sheets, setSheets] = useState<TechnicalSheet[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [filterManufacturer, setFilterManufacturer] = useState('');
  const [filterCategory, setFilterCategory] = useState('');

  // Upload state
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadManufacturer, setUploadManufacturer] = useState('');
  const [uploadCategory, setUploadCategory] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Detail modal
  const [selectedSheet, setSelectedSheet] = useState<TechnicalSheet | null>(null);
  const [linkedProducts, setLinkedProducts] = useState<Product[]>([]);
  const [productSearchQuery, setProductSearchQuery] = useState('');
  const [productSearchResults, setProductSearchResults] = useState<Product[]>([]);

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
      const { data, error } = await supabase
        .from('technical_sheets')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
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
      return matchesQuery && matchesManufacturer && matchesCategory;
    });
  }, [sheets, query, filterManufacturer, filterCategory]);

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
      const sheetId = crypto.randomUUID();
      const ext = uploadFile.name.split('.').pop() || 'pdf';
      const filePath = `${sheetId}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('technical-sheets')
        .upload(filePath, uploadFile, { upsert: true });
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from('technical-sheets').getPublicUrl(filePath);

      const { error: insertError } = await supabase
        .from('technical_sheets')
        .insert({
          id: sheetId,
          title: uploadTitle.trim(),
          manufacturer: uploadManufacturer.trim(),
          category: uploadCategory,
          file_url: urlData.publicUrl,
          file_size: uploadFile.size,
          file_type: uploadFile.type || 'application/pdf',
        });
      if (insertError) throw insertError;

      showToast({ type: 'success', message: 'Fiche technique ajoutée avec succès' });
      setShowUploadModal(false);
      setUploadFile(null);
      setUploadTitle('');
      setUploadManufacturer('');
      setUploadCategory('');
      fetchSheets();
    } catch (err) {
      console.error('Upload error:', err);
      showToast({ type: 'error', message: 'Erreur lors du téléchargement' });
    } finally {
      setIsUploading(false);
    }
  };

  const handleDeleteSheet = async (sheet: TechnicalSheet) => {
    if (!confirm(`Supprimer "${sheet.title}" ?`)) return;
    try {
      // Delete from storage
      const url = new URL(sheet.file_url);
      const pathParts = url.pathname.split('/technical-sheets/');
      if (pathParts.length > 1) {
        await supabase.storage.from('technical-sheets').remove([pathParts[1]]);
      }
      // Delete junction entries + sheet
      await supabase.from('technical_sheet_products').delete().eq('sheet_id', sheet.id);
      const { error } = await supabase.from('technical_sheets').delete().eq('id', sheet.id);
      if (error) throw error;
      showToast({ type: 'success', message: 'Fiche technique supprimée' });
      if (selectedSheet?.id === sheet.id) setSelectedSheet(null);
      fetchSheets();
    } catch (err) {
      console.error('Delete error:', err);
      showToast({ type: 'error', message: 'Erreur lors de la suppression' });
    }
  };

  // Detail modal: load linked products
  const openSheetDetail = async (sheet: TechnicalSheet) => {
    setSelectedSheet(sheet);
    setProductSearchQuery('');
    setProductSearchResults([]);
    try {
      const { data: links } = await supabase
        .from('technical_sheet_products')
        .select('product_barcode')
        .eq('sheet_id', sheet.id);
      const barcodes = (links || []).map((l: any) => l.product_barcode);
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
    ).slice(0, 10);
    setProductSearchResults(results);
  }, [productSearchQuery, state.products, linkedProducts]);

  const linkProduct = async (product: Product) => {
    if (!selectedSheet) return;
    try {
      const { error } = await supabase.from('technical_sheet_products').insert({
        sheet_id: selectedSheet.id,
        product_barcode: product.barcode,
      });
      if (error) throw error;
      setLinkedProducts(prev => [...prev, product]);
      setProductSearchQuery('');
      showToast({ type: 'success', message: `${product.name} lié` });
    } catch (err: any) {
      if (err?.code === '23505') {
        showToast({ type: 'info', message: 'Déjà lié' });
      } else {
        showToast({ type: 'error', message: 'Erreur lors de la liaison' });
      }
    }
  };

  const unlinkProduct = async (barcode: string) => {
    if (!selectedSheet) return;
    try {
      await supabase.from('technical_sheet_products').delete()
        .eq('sheet_id', selectedSheet.id).eq('product_barcode', barcode);
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

      const { error } = await supabase.from('sheet_share_links').insert({
        token,
        title: shareTitle.trim() || null,
        sheet_ids: Array.from(selectedForShare),
        expires_at: expiresAt,
      });
      if (error) throw error;

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
      const { data } = await supabase.from('sheet_share_links').select('*').order('created_at', { ascending: false });
      setShareLinks((data || []) as unknown as SheetShareLink[]);
      setShowShareLinks(true);
    } catch { /* ignore */ }
  };

  const deleteShareLink = async (id: string) => {
    try {
      await supabase.from('sheet_share_links').delete().eq('id', id);
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
        <div className="flex gap-2">
          <button onClick={fetchShareLinks} className="flex items-center gap-1.5 px-3 py-2 bg-secondary hover:bg-secondary/80 text-secondary-foreground rounded-lg text-sm transition-colors">
            <Link2 className="h-3.5 w-3.5" /> Liens partagés
          </button>
          {selectedForShare.size > 0 && (
            <button onClick={() => setShowShareModal(true)} className="flex items-center gap-1.5 px-3 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm transition-colors">
              <Share2 className="h-3.5 w-3.5" /> Partager ({selectedForShare.size})
            </button>
          )}
          {isAdmin && (
            <button onClick={() => setShowUploadModal(true)} className="flex items-center gap-1.5 px-3 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg text-sm transition-colors">
              <Upload className="h-3.5 w-3.5" /> Ajouter
            </button>
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
              {/* Select checkbox */}
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
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground mb-3">
                  <span>{formatFileSize(sheet.file_size)}</span>
                  <span className="flex items-center gap-0.5"><Eye className="h-3 w-3" /> {sheet.view_count}</span>
                  <span className="flex items-center gap-0.5"><Download className="h-3 w-3" /> {sheet.download_count}</span>
                </div>
                <div className="flex gap-1.5">
                  <a href={sheet.file_url} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1 px-2.5 py-1.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg text-xs transition-colors">
                    <ExternalLink className="h-3 w-3" /> Voir
                  </a>
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
              <span className="px-2 py-1 bg-secondary text-secondary-foreground text-xs rounded-lg">{formatFileSize(selectedSheet.file_size)}</span>
            </div>

            <a href={selectedSheet.file_url} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg text-sm transition-colors mb-4">
              <Download className="h-3.5 w-3.5" /> Télécharger
            </a>

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
              {productSearchResults.length > 0 && (
                <div className="mt-2 border border-border rounded-lg divide-y divide-border max-h-40 overflow-y-auto">
                  {productSearchResults.map(p => (
                    <button key={p.barcode} onClick={() => linkProduct(p)} className="w-full px-3 py-2 text-left hover:bg-accent transition-colors">
                      <p className="text-sm font-medium text-foreground truncate">{p.name}</p>
                      <p className="text-xs text-muted-foreground">#{p.barcode} • {p.brand}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
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
