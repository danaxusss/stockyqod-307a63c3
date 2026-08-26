import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Images, Upload, Search, Link2, Trash2, Download, X, Loader, CheckSquare, Square, ChevronLeft, ChevronRight, ZoomIn, AlertTriangle, ImagePlus } from 'lucide-react';
import { zipSync } from 'fflate';
import { useLocation } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../hooks/useAuth';
import { useUserAuth } from '../hooks/useUserAuth';
import { useAppContext } from '../context/AppContext';
import { useEscapeKey } from '../hooks/useShortcuts';
import { ProductPhoto, Product } from '../types';
import {
  analyzeProductImageFiles,
  PRODUCT_IMAGE_BATCH_LIMIT,
  type ProductImageBatchAnalysis,
  uploadPrimaryProductImage,
} from '../utils/productImages';

function getPublicUrl(storagePath: string) {
  return supabase.storage.from('product-photos').getPublicUrl(storagePath).data.publicUrl;
}

export default function ProductPhotosPage() {
  const { showToast } = useToast();
  const { companyId: adminCompanyId, currentUser } = useAuth();
  const { authenticatedUser } = useUserAuth();
  const companyId = adminCompanyId || authenticatedUser?.company_id || null;
  const { state, syncData } = useAppContext();

  const [gridCols, setGridCols] = useState<6 | 9 | 12>(6);
  const [pageSize, setPageSize] = useState<50 | 100 | 200 | 500>(100);
  const [page, setPage] = useState(1);

  const location = useLocation();
  const initialSearch = new URLSearchParams(location.search).get('barcode') || '';

  const [photos, setPhotos] = useState<ProductPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(initialSearch);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [batchAnalysis, setBatchAnalysis] = useState<ProductImageBatchAnalysis | null>(null);
  const [existingImageMode, setExistingImageMode] = useState<'skip' | 'replace'>('skip');

  // Lightbox
  const [lightbox, setLightbox] = useState<ProductPhoto | null>(null);
  const [lightboxIdx, setLightboxIdx] = useState(0);

  // Link modal
  const [linkModal, setLinkModal] = useState<ProductPhoto | null>(null);
  const [linkSearch, setLinkSearch] = useState('');
  const [linkResults, setLinkResults] = useState<Product[]>([]);
  const [pendingLinks, setPendingLinks] = useState<Set<string>>(new Set());
  const [isLinking, setIsLinking] = useState(false);

  const bulkFileInputRef = useRef<HTMLInputElement>(null);

  const fetchPhotos = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from('product_photos')
        .select('*, product_photo_products(barcode, product_name)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setPhotos((data || []) as unknown as ProductPhoto[]);
    } catch (err: any) {
      console.error('Photos load error:', err);
      showToast({ type: 'error', message: `Erreur: ${err?.message || 'chargement photos'}` });
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { fetchPhotos(); }, [fetchPhotos]);

  const filtered = React.useMemo(() => {
    if (!search || search.length < 2) return photos;
    const q = search.toLowerCase();
    return photos.filter(p =>
      p.title.toLowerCase().includes(q) ||
      (p.product_photo_products || []).some(pp => pp.barcode.toLowerCase().includes(q) || pp.product_name.toLowerCase().includes(q))
    );
  }, [photos, search]);

  // Reset to page 1 whenever search or page size changes
  useEffect(() => { setPage(1); }, [search, pageSize]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  // Product image import: the file name (without extension) must equal the exact barcode/reference.
  const handleBulkFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    if (!companyId) { showToast({ type: 'error', message: 'Aucune société associée' }); return; }
    const analysis = analyzeProductImageFiles(Array.from(files), state.products);
    setExistingImageMode('skip');
    setBatchAnalysis(analysis);
    if (bulkFileInputRef.current) bulkFileInputRef.current.value = '';
  };

  const closeBatchAnalysis = () => {
    if (isUploading) return;
    setBatchAnalysis(null);
    setUploadProgress(0);
  };

  const confirmBulkImport = async () => {
    if (!batchAnalysis || !companyId) return;
    const toUpload = existingImageMode === 'replace'
      ? batchAnalysis.candidates
      : batchAnalysis.newImages;
    if (toUpload.length === 0) {
      showToast({ type: 'warning', message: 'Aucune nouvelle image à importer avec les options sélectionnées' });
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);
    let ok = 0, fail = 0;
    for (let i = 0; i < toUpload.length; i++) {
      const candidate = toUpload[i];
      try {
        await uploadPrimaryProductImage({
          product: candidate.product,
          file: candidate.file,
          companyId,
          createdBy: currentUser?.username,
          replaceExisting: candidate.replacesExisting && existingImageMode === 'replace',
        });
        ok++;
      } catch (error) {
        console.error(`Image upload failed for ${candidate.product.barcode}:`, error);
        fail++;
      }
      setUploadProgress(Math.round(((i + 1) / toUpload.length) * 100));
    }
    const skippedExisting = existingImageMode === 'skip' ? batchAnalysis.replacements.length : 0;
    showToast({
      type: fail > 0 ? 'warning' : 'success',
      message: `${ok} image(s) produit importée(s)${skippedExisting ? `, ${skippedExisting} existante(s) ignorée(s)` : ''}${fail > 0 ? `, ${fail} erreur(s)` : ''}`,
    });
    setIsUploading(false);
    setUploadProgress(0);
    setBatchAnalysis(null);
    await Promise.all([fetchPhotos(), syncData(true)]);
  };

  const handleDelete = async (photo: ProductPhoto) => {
    if (!confirm(`Supprimer "${photo.title || photo.file_name}" ?`)) return;
    try {
      await supabase.storage.from('product-photos').remove([photo.storage_path]);
      await (supabase as any).from('products').update({ image: null }).eq('image', photo.storage_path);
      await (supabase as any).from('product_photo_products').delete().eq('photo_id', photo.id);
      const { error } = await (supabase as any).from('product_photos').delete().eq('id', photo.id);
      if (error) throw error;
      showToast({ type: 'success', message: 'Photo supprimée' });
      if (lightbox?.id === photo.id) setLightbox(null);
      setSelected(prev => { const s = new Set(prev); s.delete(photo.id); return s; });
      await Promise.allSettled([fetchPhotos(), syncData(true)]);
    } catch {
      showToast({ type: 'error', message: 'Erreur lors de la suppression' });
    }
  };

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id); else s.add(id);
      return s;
    });
  };

  const [isDownloading, setIsDownloading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const downloadSelected = async () => {
    const toDownload = photos.filter(p => selected.has(p.id));
    if (toDownload.length === 0) return;
    setIsDownloading(true);
    try {
      const files: Record<string, Uint8Array> = {};
      await Promise.all(toDownload.map(async p => {
        const res = await fetch(getPublicUrl(p.storage_path));
        const buf = await res.arrayBuffer();
        const name = p.file_name.replace(/[/\\:*?"<>|]/g, '_');
        // Deduplicate filenames
        const key = files[name] ? `${p.id.slice(0,6)}_${name}` : name;
        files[key] = new Uint8Array(buf);
      }));
      const zipped = zipSync(files, { level: 0 }); // level 0 = store only (images already compressed)
      const blob = new Blob([zipped.buffer as ArrayBuffer], { type: 'application/zip' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `photos_${new Date().toISOString().slice(0,10)}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
    } catch {
      showToast({ type: 'error', message: 'Erreur lors de la création du ZIP' });
    } finally {
      setIsDownloading(false);
    }
  };

  const deleteSelected = async () => {
    if (!confirm(`Supprimer ${selected.size} photo(s) ? Cette action est irréversible.`)) return;
    setIsDeleting(true);
    const toDelete = photos.filter(p => selected.has(p.id));
    let ok = 0, fail = 0;
    for (const photo of toDelete) {
      try {
        await supabase.storage.from('product-photos').remove([photo.storage_path]);
        await (supabase as any).from('products').update({ image: null }).eq('image', photo.storage_path);
        await (supabase as any).from('product_photo_products').delete().eq('photo_id', photo.id);
        const { error } = await (supabase as any).from('product_photos').delete().eq('id', photo.id);
        if (error) throw error;
        ok++;
      } catch { fail++; }
    }
    setSelected(new Set());
    if (lightbox && selected.has(lightbox.id)) setLightbox(null);
    showToast({
      type: fail > 0 ? 'warning' : 'success',
      message: `${ok} photo(s) supprimée(s)${fail > 0 ? `, ${fail} erreur(s)` : ''}`,
    });
    setIsDeleting(false);
    await Promise.allSettled([fetchPhotos(), syncData(true)]);
  };

  // Lightbox nav
  const openLightbox = (photo: ProductPhoto) => {
    const idx = filtered.findIndex(p => p.id === photo.id);
    setLightbox(photo);
    setLightboxIdx(idx);
  };

  const lightboxPrev = () => {
    const idx = (lightboxIdx - 1 + filtered.length) % filtered.length;
    setLightbox(filtered[idx]);
    setLightboxIdx(idx);
  };

  const lightboxNext = () => {
    const idx = (lightboxIdx + 1) % filtered.length;
    setLightbox(filtered[idx]);
    setLightboxIdx(idx);
  };

  const closeLinkModal = () => { setLinkModal(null); setLinkSearch(''); setPendingLinks(new Set()); };

  useEscapeKey(() => {
    if (batchAnalysis && !isUploading) { closeBatchAnalysis(); return; }
    if (lightbox) { setLightbox(null); return; }
    if (linkModal) closeLinkModal();
  }, !!(batchAnalysis || lightbox || linkModal));

  // Product link search — show up to 30 results, keep already-linked ones visible (marked)
  useEffect(() => {
    if (!linkModal || linkSearch.length < 2) { setLinkResults([]); return; }
    const q = linkSearch.toLowerCase();
    const results = state.products
      .filter(p => p.barcode.toLowerCase().includes(q) || p.name.toLowerCase().includes(q))
      .slice(0, 30);
    setLinkResults(results);
  }, [linkSearch, linkModal, state.products]);

  const togglePending = (barcode: string) => {
    const linked = new Set((linkModal?.product_photo_products || []).map(pp => pp.barcode));
    if (linked.has(barcode)) return; // already linked, can't toggle
    setPendingLinks(prev => {
      const s = new Set(prev);
      if (s.has(barcode)) s.delete(barcode); else s.add(barcode);
      return s;
    });
  };

  const confirmLinks = async () => {
    if (!linkModal || pendingLinks.size === 0) return;
    setIsLinking(true);
    try {
      const toInsert = linkResults
        .filter(p => pendingLinks.has(p.barcode))
        .map(p => ({ photo_id: linkModal.id, barcode: p.barcode, product_name: p.name }));
      const { error } = await (supabase as any).from('product_photo_products').insert(toInsert);
      if (error) throw error;
      const newLinks = toInsert.map(r => ({ barcode: r.barcode, product_name: r.product_name }));
      setLinkModal(prev => prev ? {
        ...prev,
        product_photo_products: [...(prev.product_photo_products || []), ...newLinks],
      } : null);
      setPendingLinks(new Set());
      showToast({ type: 'success', message: `${toInsert.length} produit(s) liés` });
      fetchPhotos();
    } catch {
      showToast({ type: 'error', message: 'Erreur lors de la liaison' });
    } finally {
      setIsLinking(false);
    }
  };

  const unlinkProduct = async (barcode: string) => {
    if (!linkModal) return;
    try {
      await (supabase as any).from('product_photo_products').delete().eq('photo_id', linkModal.id).eq('barcode', barcode);
      setLinkModal(prev => prev ? {
        ...prev,
        product_photo_products: (prev.product_photo_products || []).filter(pp => pp.barcode !== barcode),
      } : null);
      showToast({ type: 'success', message: 'Lien supprimé' });
      fetchPhotos();
    } catch {
      showToast({ type: 'error', message: 'Erreur' });
    }
  };

  return (
    <div className="max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-primary/10">
            <Images className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-foreground leading-none">Galerie Photos</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {filtered.length !== photos.length
                ? `${filtered.length} / ${photos.length} photos`
                : `${photos.length} photo${photos.length !== 1 ? 's' : ''}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {selected.size > 0 && (
            <>
              <button
                onClick={downloadSelected}
                disabled={isDownloading}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-60"
              >
                {isDownloading ? <Loader className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                {isDownloading ? 'ZIP...' : `ZIP (${selected.size})`}
              </button>
              <button
                onClick={deleteSelected}
                disabled={isDeleting}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-destructive hover:bg-destructive/90 text-destructive-foreground rounded-lg text-sm font-medium transition-colors disabled:opacity-60"
              >
                {isDeleting ? <Loader className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                {isDeleting ? 'Suppression...' : `Supprimer (${selected.size})`}
              </button>
            </>
          )}
          {/* Page size picker */}
          <div className="flex items-center border border-border rounded-lg overflow-hidden text-xs font-medium">
            {([50, 100, 200, 500] as const).map(n => (
              <button
                key={n}
                onClick={() => setPageSize(n)}
                className={`px-2.5 py-1.5 transition-colors ${pageSize === n ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'}`}
              >
                {n}
              </button>
            ))}
          </div>
          {/* Grid mode toggle */}
          <div className="flex items-center border border-border rounded-lg overflow-hidden text-xs font-medium">
            {([6, 9, 12] as const).map(n => (
              <button
                key={n}
                onClick={() => setGridCols(n)}
                className={`px-2.5 py-1.5 transition-colors ${gridCols === n ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'}`}
              >
                {n}
              </button>
            ))}
          </div>

          <button
            onClick={() => bulkFileInputRef.current?.click()}
            disabled={isUploading}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg text-sm font-medium transition-colors disabled:opacity-60"
            style={{ boxShadow: 'var(--shadow-glow)' }}
          >
            {isUploading ? <Loader className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {isUploading ? `Import... ${uploadProgress}%` : 'Importer par code-barres'}
          </button>
          <input
            ref={bulkFileInputRef}
            type="file"
            accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
            multiple
            className="hidden"
            onChange={e => handleBulkFiles(e.target.files)}
          />
        </div>
      </div>

      <div className="mb-4 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
        Import produit : nommez chaque fichier avec le code-barres exact, par exemple <span className="font-mono text-foreground">123456789.jpg</span>.
        Maximum {PRODUCT_IMAGE_BATCH_LIMIT} images par lot et 10 Mo par fichier.
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Rechercher par code-barre ou titre..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full pl-9 pr-4 py-2 border border-input rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Grid */}
      {loading ? (
        <div className="flex items-center justify-center h-48">
          <Loader className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 text-center">
          <div className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center mb-3">
            <Images className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium text-foreground">{search ? 'Aucun résultat' : 'Aucune photo'}</p>
          <p className="text-xs text-muted-foreground mt-1">{search ? 'Modifiez votre recherche' : 'Importez des photos pour commencer'}</p>
        </div>
      ) : (
        <div className={`grid gap-1.5 ${
          gridCols === 6  ? 'grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6' :
          gridCols === 9  ? 'grid-cols-4 sm:grid-cols-6 md:grid-cols-7 lg:grid-cols-9' :
                            'grid-cols-5 sm:grid-cols-8 md:grid-cols-10 lg:grid-cols-12'
        }`}>
          {paginated.map(photo => {
            const isSelected = selected.has(photo.id);
            const linkedCount = (photo.product_photo_products || []).length;
            return (
              <div key={photo.id} className="relative group aspect-square rounded-lg overflow-hidden border border-border/40 bg-secondary/30">
                <img
                  src={getPublicUrl(photo.storage_path)}
                  alt={photo.title || photo.file_name}
                  className="w-full h-full object-contain cursor-pointer transition-opacity group-hover:opacity-85"
                  onClick={() => openLightbox(photo)}
                  loading="lazy"
                />
                {/* Select checkbox */}
                <button
                  onClick={e => { e.stopPropagation(); toggleSelect(photo.id); }}
                  className={`absolute top-1 left-1 transition-opacity ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                >
                  {isSelected
                    ? <CheckSquare className="h-4 w-4 text-primary drop-shadow" />
                    : <Square className="h-4 w-4 text-white drop-shadow" />
                  }
                </button>
                {/* Linked badge */}
                {linkedCount > 0 && (
                  <div className="absolute bottom-1 left-1 bg-primary/90 text-primary-foreground text-[9px] font-bold rounded-full px-1.5 py-0.5 leading-none">
                    {linkedCount}
                  </div>
                )}
                {/* Zoom icon on hover */}
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                  <ZoomIn className="h-6 w-6 text-white drop-shadow-lg" />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 pt-4 border-t border-border">
          <p className="text-xs text-muted-foreground">
            {(safePage - 1) * pageSize + 1}–{Math.min(safePage * pageSize, filtered.length)} sur {filtered.length}
          </p>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(1)}
              disabled={safePage === 1}
              className="px-2 py-1.5 text-xs rounded-lg border border-border disabled:opacity-40 hover:bg-accent transition-colors"
            >«</button>
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={safePage === 1}
              className="px-3 py-1.5 text-xs rounded-lg border border-border disabled:opacity-40 hover:bg-accent transition-colors"
            >‹ Préc.</button>
            <span className="px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground rounded-lg">
              {safePage} / {totalPages}
            </span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={safePage === totalPages}
              className="px-3 py-1.5 text-xs rounded-lg border border-border disabled:opacity-40 hover:bg-accent transition-colors"
            >Suiv. ›</button>
            <button
              onClick={() => setPage(totalPages)}
              disabled={safePage === totalPages}
              className="px-2 py-1.5 text-xs rounded-lg border border-border disabled:opacity-40 hover:bg-accent transition-colors"
            >»</button>
          </div>
        </div>
      )}

      {/* Bulk import review */}
      {batchAnalysis && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-center pt-8 px-4">
          <div className="w-full max-w-xl bg-card border border-border rounded-xl shadow-xl max-h-[88vh] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-secondary/50">
              <div className="flex items-center gap-2">
                <ImagePlus className="h-4 w-4 text-primary" />
                <div>
                  <p className="text-sm font-semibold">Vérifier l'import d'images</p>
                  <p className="text-[11px] text-muted-foreground">Correspondance exacte entre nom de fichier et code-barres Stocky</p>
                </div>
              </div>
              <button onClick={closeBatchAnalysis} disabled={isUploading} className="p-1 rounded text-muted-foreground hover:text-foreground disabled:opacity-40">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-4 space-y-4 overflow-y-auto">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="rounded-lg bg-emerald-500/10 p-2.5"><p className="text-[11px] text-muted-foreground">Nouvelles</p><p className="text-xl font-bold text-emerald-600">{batchAnalysis.newImages.length}</p></div>
                <div className="rounded-lg bg-amber-500/10 p-2.5"><p className="text-[11px] text-muted-foreground">À remplacer</p><p className="text-xl font-bold text-amber-600">{batchAnalysis.replacements.length}</p></div>
                <div className="rounded-lg bg-destructive/10 p-2.5"><p className="text-[11px] text-muted-foreground">Non trouvées</p><p className="text-xl font-bold text-destructive">{batchAnalysis.unmatched.length}</p></div>
                <div className="rounded-lg bg-secondary p-2.5"><p className="text-[11px] text-muted-foreground">Ignorées</p><p className="text-xl font-bold text-foreground">{batchAnalysis.invalid.length + batchAnalysis.duplicates.length + batchAnalysis.overflow.length}</p></div>
              </div>

              {batchAnalysis.replacements.length > 0 && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                  <div className="flex gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{batchAnalysis.replacements.length} produit(s) ont déjà une image</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Le remplacement met immédiatement à jour Stocky, le catalogue et les prochains exports.</p>
                      <div className="mt-3 grid sm:grid-cols-2 gap-2">
                        <label className={`flex gap-2 rounded-lg border p-2.5 cursor-pointer ${existingImageMode === 'skip' ? 'border-primary bg-primary/5' : 'border-border'}`}>
                          <input type="radio" name="existing-mode" checked={existingImageMode === 'skip'} onChange={() => setExistingImageMode('skip')} />
                          <span><span className="block text-xs font-medium">Conserver les images</span><span className="block text-[11px] text-muted-foreground">Ignorer les produits déjà illustrés</span></span>
                        </label>
                        <label className={`flex gap-2 rounded-lg border p-2.5 cursor-pointer ${existingImageMode === 'replace' ? 'border-amber-500 bg-amber-500/5' : 'border-border'}`}>
                          <input type="radio" name="existing-mode" checked={existingImageMode === 'replace'} onChange={() => setExistingImageMode('replace')} />
                          <span><span className="block text-xs font-medium">Remplacer</span><span className="block text-[11px] text-muted-foreground">Utiliser les nouveaux fichiers</span></span>
                        </label>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {(batchAnalysis.unmatched.length > 0 || batchAnalysis.invalid.length > 0 || batchAnalysis.duplicates.length > 0 || batchAnalysis.overflow.length > 0) && (
                <div className="rounded-lg border border-border p-3 text-xs">
                  <p className="font-medium text-foreground mb-2">Fichiers qui ne seront pas importés</p>
                  <div className="max-h-32 overflow-y-auto space-y-1 text-muted-foreground">
                    {batchAnalysis.unmatched.map(file => <p key={`unmatched-${file.name}`}><span className="font-mono text-foreground">{file.name}</span> — produit introuvable dans Stocky</p>)}
                    {batchAnalysis.invalid.map(({ file, reason }) => <p key={`invalid-${file.name}`}><span className="font-mono text-foreground">{file.name}</span> — {reason}</p>)}
                    {batchAnalysis.duplicates.map(file => <p key={`duplicate-${file.name}`}><span className="font-mono text-foreground">{file.name}</span> — code-barres dupliqué dans ce lot</p>)}
                    {batchAnalysis.overflow.map(file => <p key={`overflow-${file.name}`}><span className="font-mono text-foreground">{file.name}</span> — au-delà de la limite de {PRODUCT_IMAGE_BATCH_LIMIT}</p>)}
                  </div>
                </div>
              )}
            </div>

            <div className="px-4 py-3 border-t border-border bg-background/50">
              {isUploading && (
                <div className="mb-2 h-1.5 rounded-full bg-secondary overflow-hidden">
                  <div className="h-full bg-primary transition-all" style={{ width: `${uploadProgress}%` }} />
                </div>
              )}
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                  {batchAnalysis.newImages.length + (existingImageMode === 'replace' ? batchAnalysis.replacements.length : 0)} image(s) seront importées
                </p>
                <div className="flex gap-2">
                  <button onClick={closeBatchAnalysis} disabled={isUploading} className="px-3 py-2 text-sm rounded-lg border border-border hover:bg-accent disabled:opacity-40">Annuler</button>
                  <button onClick={confirmBulkImport} disabled={isUploading || (batchAnalysis.newImages.length + (existingImageMode === 'replace' ? batchAnalysis.replacements.length : 0) === 0)} className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40">
                    {isUploading ? <Loader className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    {isUploading ? `${uploadProgress}%` : 'Lancer l’import'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Lightbox */}
      {lightbox && (
        <div className="fixed inset-0 z-50 bg-black/95 flex flex-col">
          {/* Top bar */}
          <div className="flex items-center justify-between px-4 py-3 shrink-0">
            <p className="text-white text-sm font-medium truncate max-w-xs">{lightbox.title || lightbox.file_name}</p>
            <div className="flex items-center gap-2">
              <a
                href={getPublicUrl(lightbox.storage_path)}
                download={lightbox.file_name}
                className="p-2 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors"
                title="Télécharger"
              >
                <Download className="h-4 w-4" />
              </a>
              <button
                onClick={() => { setLinkModal(lightbox); setLightbox(null); }}
                className="p-2 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors"
                title="Lier à un produit"
              >
                <Link2 className="h-4 w-4" />
              </button>
              <button
                onClick={() => { handleDelete(lightbox); }}
                className="p-2 rounded-lg text-white/70 hover:text-red-400 hover:bg-white/10 transition-colors"
                title="Supprimer"
              >
                <Trash2 className="h-4 w-4" />
              </button>
              <button
                onClick={() => setLightbox(null)}
                className="p-2 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors"
                title="Fermer (Échap)"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Image */}
          <div className="flex-1 flex items-center justify-center relative min-h-0 px-12">
            {filtered.length > 1 && (
              <button onClick={lightboxPrev} className="absolute left-2 p-2 rounded-full text-white/70 hover:text-white hover:bg-white/10 transition-colors">
                <ChevronLeft className="h-6 w-6" />
              </button>
            )}
            <img
              src={getPublicUrl(lightbox.storage_path)}
              alt={lightbox.title}
              className="max-h-full max-w-full object-contain rounded"
            />
            {filtered.length > 1 && (
              <button onClick={lightboxNext} className="absolute right-2 p-2 rounded-full text-white/70 hover:text-white hover:bg-white/10 transition-colors">
                <ChevronRight className="h-6 w-6" />
              </button>
            )}
          </div>

          {/* Bottom info */}
          <div className="shrink-0 px-4 py-3 text-center">
            {(lightbox.product_photo_products || []).length > 0 && (
              <div className="flex items-center justify-center gap-2 flex-wrap mb-1">
                {(lightbox.product_photo_products || []).map(pp => (
                  <span key={pp.barcode} className="text-xs text-white/60 bg-white/10 px-2 py-0.5 rounded">
                    #{pp.barcode} — {pp.product_name}
                  </span>
                ))}
              </div>
            )}
            <p className="text-white/30 text-[10px]">{lightboxIdx + 1} / {filtered.length}</p>
          </div>
        </div>
      )}

      {/* Link modal */}
      {linkModal && (() => {
        const alreadyLinked = new Set((linkModal.product_photo_products || []).map(pp => pp.barcode));
        return (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-center pt-10 px-4">
            <div className="w-full max-w-md bg-card border border-border rounded-xl shadow-xl flex flex-col max-h-[85vh]">
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-secondary/50 shrink-0">
                <div className="flex items-center gap-2">
                  <Link2 className="h-4 w-4 text-primary" />
                  <p className="text-sm font-semibold">Lier à des produits</p>
                </div>
                <button onClick={closeLinkModal} className="p-1 rounded text-muted-foreground hover:text-foreground">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
                {/* Thumbnail */}
                <img src={getPublicUrl(linkModal.storage_path)} alt={linkModal.title}
                  className="w-14 h-14 object-contain rounded-lg border border-border bg-secondary/30" />

                {/* Existing links */}
                {(linkModal.product_photo_products || []).length > 0 && (
                  <div className="space-y-1">
                    <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Produits liés</p>
                    {(linkModal.product_photo_products || []).map(pp => (
                      <div key={pp.barcode} className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-secondary/50 border border-border/60">
                        <div className="min-w-0">
                          <p className="text-xs font-medium truncate">{pp.product_name}</p>
                          <p className="text-[10px] text-muted-foreground font-mono">#{pp.barcode}</p>
                        </div>
                        <button onClick={() => unlinkProduct(pp.barcode)} className="p-1 rounded text-muted-foreground hover:text-destructive transition-colors shrink-0">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Search */}
                <div>
                  <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                    Ajouter des liens
                    {pendingLinks.size > 0 && <span className="ml-1.5 text-primary normal-case">{pendingLinks.size} sélectionné(s)</span>}
                  </p>
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <input
                      type="text"
                      placeholder="Nom ou code-barre..."
                      value={linkSearch}
                      onChange={e => setLinkSearch(e.target.value)}
                      className="w-full pl-8 pr-3 py-1.5 border border-input rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                      autoFocus
                    />
                  </div>
                  {linkResults.length > 0 && (
                    <div className="mt-1.5 space-y-0.5 max-h-64 overflow-y-auto">
                      {linkResults.map(product => {
                        const isLinked = alreadyLinked.has(product.barcode);
                        const isPending = pendingLinks.has(product.barcode);
                        return (
                          <button
                            key={product.barcode}
                            onClick={() => togglePending(product.barcode)}
                            disabled={isLinked}
                            className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left transition-colors ${
                              isLinked ? 'opacity-50 cursor-default bg-secondary/30' :
                              isPending ? 'bg-primary/10 border border-primary/30' :
                              'hover:bg-accent'
                            }`}
                          >
                            <div className={`w-4 h-4 rounded border shrink-0 flex items-center justify-center transition-colors ${
                              isLinked ? 'border-border bg-secondary' :
                              isPending ? 'border-primary bg-primary' : 'border-border'
                            }`}>
                              {(isLinked || isPending) && <span className="text-[9px] text-white font-bold leading-none">✓</span>}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-medium truncate">{product.name}</p>
                              <p className="text-[10px] text-muted-foreground font-mono">#{product.barcode}</p>
                            </div>
                            {isLinked && <span className="text-[9px] text-muted-foreground shrink-0">déjà lié</span>}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {linkSearch.length >= 2 && linkResults.length === 0 && (
                    <p className="text-xs text-muted-foreground mt-2 text-center">Aucun produit trouvé</p>
                  )}
                </div>
              </div>

              {/* Footer */}
              {pendingLinks.size > 0 && (
                <div className="shrink-0 px-4 py-3 border-t border-border bg-background/50">
                  <button
                    onClick={confirmLinks}
                    disabled={isLinking}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg text-sm font-medium transition-colors disabled:opacity-60"
                  >
                    {isLinking ? <Loader className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
                    Lier {pendingLinks.size} produit{pendingLinks.size > 1 ? 's' : ''}
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
