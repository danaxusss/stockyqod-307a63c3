import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle, ArrowLeft, Check, ChevronLeft, ChevronRight, ClipboardPaste, ExternalLink, ImagePlus,
  Images, Loader, Search, SkipForward, Upload, X,
} from 'lucide-react';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../hooks/useAuth';
import { useUserAuth } from '../hooks/useUserAuth';
import { useAppContext } from '../context/AppContext';
import type { Product } from '../types';
import { resolveProductImageUrl, uploadPrimaryProductImage } from '../utils/productImages';
import {
  barcodeQuery, buildImageQuery, googleImagesUrl, imageQueue, pastedImageUrl, sizeLabel, type ImageSearchResult,
} from '../utils/imageSearch';
import { ImageSearchNotConfiguredError, ImageSearchService } from '../utils/imageSearchService';

type Candidate =
  | { kind: 'result'; result: ImageSearchResult }
  | { kind: 'file'; file: File; previewUrl: string; label: string };

const QUEUE_PAGE = 200;

/**
 * Find a photo for each product without leaving Stocky: search the web,
 * click a result and save. The image is stored and linked to the product
 * exactly like a file imported under its barcode — no download, no renaming.
 * Without a search provider, pasting (Ctrl+V) or dropping an image works too.
 */
export default function ImageFinderPage() {
  const { canEditProducts } = useAuth();
  // Checked before mounting the finder, which starts (paid) searches right away.
  if (!canEditProducts) {
    return (
      <div className="mx-auto flex min-h-[50vh] max-w-md flex-col items-center justify-center text-center">
        <Images className="mb-3 h-8 w-8 text-muted-foreground/50" />
        <h1 className="text-base font-semibold text-foreground">Accès réservé</h1>
        <p className="mt-1 text-sm text-muted-foreground">Ajouter des images aux produits demande l’autorisation « Peut modifier les produits ». Demandez-la à un administrateur.</p>
        <Link to="/photos" className="mt-4 rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent">Retour à la galerie</Link>
      </div>
    );
  }
  return <ImageFinder />;
}

function ImageFinder() {
  const { showToast } = useToast();
  const { companyId: adminCompanyId, currentUser } = useAuth();
  const { authenticatedUser } = useUserAuth();
  const companyId = adminCompanyId || authenticatedUser?.company_id || null;
  const { state, syncData } = useAppContext();
  const [params] = useSearchParams();
  const requestedBarcode = params.get('barcode');

  const [missingOnly, setMissingOnly] = useState(() => {
    const requested = requestedBarcode && state.products.find(product => product.barcode === requestedBarcode);
    return !(requested && requested.image);
  });
  const [brandFilter, setBrandFilter] = useState('');
  const [listSearch, setListSearch] = useState('');
  const [savedImages, setSavedImages] = useState<Record<string, string>>({});
  const [currentBarcode, setCurrentBarcode] = useState<string | null>(requestedBarcode);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ImageSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [notConfigured, setNotConfigured] = useState('');
  const [autoSearch, setAutoSearch] = useState(true);
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [fetchingUrl, setFetchingUrl] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dragging, setDragging] = useState(false);
  // Phones: the product list folds away so the search and results come first.
  const [queueOpen, setQueueOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const searchRequest = useRef(0);
  const savedAny = useRef(false);

  const brands = useMemo(
    () => Array.from(new Set(state.products.map(product => product.brand).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [state.products],
  );
  const queue = useMemo(
    () => imageQueue(state.products, { missingOnly, brand: brandFilter, search: listSearch, images: savedImages }),
    [brandFilter, listSearch, missingOnly, savedImages, state.products],
  );
  const missingCount = useMemo(
    () => state.products.filter(product => !(savedImages[product.barcode] || product.image)).length,
    [savedImages, state.products],
  );
  const current: Product | null = useMemo(
    () => state.products.find(product => product.barcode === currentBarcode) || queue[0] || null,
    [currentBarcode, queue, state.products],
  );
  const currentIndex = current ? queue.findIndex(product => product.barcode === current.barcode) : -1;
  const currentImage = current ? savedImages[current.barcode] || current.image || null : null;

  // Let the rest of Stocky see the new images once the user leaves the finder.
  const syncOnLeave = useRef(syncData);
  useEffect(() => { syncOnLeave.current = syncData; }, [syncData]);
  useEffect(() => () => { if (savedAny.current) syncOnLeave.current(true); }, []);

  const clearCandidate = useCallback(() => {
    setCandidate(previous => {
      if (previous?.kind === 'file') URL.revokeObjectURL(previous.previewUrl);
      return null;
    });
  }, []);

  const runSearch = useCallback(async (text: string) => {
    const value = text.trim();
    if (value.length < 2) return;
    const requestId = ++searchRequest.current;
    setSearching(true);
    setSearchError('');
    try {
      const found = await ImageSearchService.search(value);
      if (requestId !== searchRequest.current) return;
      setResults(found);
      if (!found.length) setSearchError('Aucune image trouvée. Essayez une recherche plus courte ou la référence.');
    } catch (error) {
      if (requestId !== searchRequest.current) return;
      setResults([]);
      if (error instanceof ImageSearchNotConfiguredError) setNotConfigured(error.message);
      else setSearchError(error instanceof Error ? error.message : 'Recherche impossible');
    } finally {
      if (requestId === searchRequest.current) setSearching(false);
    }
  }, []);

  // New product on screen: fresh query, and search right away when possible.
  useEffect(() => {
    if (!current) return;
    const text = buildImageQuery(current);
    setQuery(text);
    setResults([]);
    setSearchError('');
    clearCandidate();
    if (autoSearch && !notConfigured) runSearch(text);
    else searchRequest.current++;
    // Only a change of product should trigger this, not toggling options.
  }, [current?.barcode]); // eslint-disable-line react-hooks/exhaustive-deps

  const goTo = (product: Product | null | undefined) => {
    if (product) setCurrentBarcode(product.barcode);
  };
  const goNext = () => goTo(queue[currentIndex + 1]);
  const goPrevious = () => goTo(queue[currentIndex - 1]);

  const pickFile = useCallback((file: File, label: string) => {
    if (!file.type.startsWith('image/')) {
      showToast({ type: 'error', message: 'Ce fichier n’est pas une image.' });
      return;
    }
    clearCandidate();
    setCandidate({ kind: 'file', file, previewUrl: URL.createObjectURL(file), label });
  }, [clearCandidate, showToast]);

  const pickImageUrl = useCallback(async (url: string) => {
    if (!current) return;
    setFetchingUrl(true);
    try {
      const file = await ImageSearchService.fetchImage(url, current.barcode);
      pickFile(file, new URL(url).hostname.replace(/^www\./, ''));
    } catch (error) {
      showToast({ type: 'error', title: 'Image inaccessible', message: error instanceof Error ? error.message : 'Téléchargement impossible' });
    } finally {
      setFetchingUrl(false);
    }
  }, [current, showToast, pickFile]);

  // Ctrl+V anywhere on the page: an image copied from Google Images (or any
  // site), or the copied address of an image.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      const file = Array.from(event.clipboardData?.files || []).find(item => item.type.startsWith('image/'));
      if (file) {
        event.preventDefault();
        pickFile(file, 'Image collée');
        return;
      }
      const url = pastedImageUrl(event.clipboardData?.getData('text') || '');
      if (url) {
        event.preventDefault();
        pickImageUrl(url);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [pickFile, pickImageUrl]);

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const file = Array.from(event.dataTransfer.files).find(item => item.type.startsWith('image/'));
    if (file) { pickFile(file, file.name); return; }
    const url = pastedImageUrl(event.dataTransfer.getData('text/uri-list') || event.dataTransfer.getData('text/plain'));
    if (url) pickImageUrl(url);
  };

  const fileFromResult = async (result: ImageSearchResult, product: Product): Promise<File> => {
    try {
      return await ImageSearchService.fetchImage(result.url, product.barcode, result.page);
    } catch (error) {
      // Some sites block downloads of the full image; the search engine's
      // copy is smaller but always reachable.
      if (!result.thumbnail || result.thumbnail === result.url) throw error;
      const file = await ImageSearchService.fetchImage(result.thumbnail, product.barcode);
      showToast({ type: 'warning', message: 'Le site d’origine a refusé l’image : la version réduite a été utilisée.' });
      return file;
    }
  };

  const save = async () => {
    if (!current || !candidate || saving) return;
    if (!companyId) { showToast({ type: 'error', message: 'Aucune société associée' }); return; }
    if (currentImage && !window.confirm('Ce produit a déjà une image. La remplacer ?')) return;
    setSaving(true);
    try {
      const file = candidate.kind === 'file' ? candidate.file : await fileFromResult(candidate.result, current);
      const storagePath = await uploadPrimaryProductImage({
        product: { barcode: current.barcode, name: current.name, image: currentImage },
        file,
        companyId,
        createdBy: currentUser?.username || authenticatedUser?.username,
        replaceExisting: !!currentImage,
      });
      savedAny.current = true;
      const next = queue[currentIndex + 1];
      setSavedImages(images => ({ ...images, [current.barcode]: storagePath }));
      showToast({ type: 'success', message: `Image enregistrée pour ${current.name}` });
      if (next) setCurrentBarcode(next.barcode);
      else clearCandidate();
    } catch (error) {
      showToast({ type: 'error', title: 'Enregistrement impossible', message: error instanceof Error ? error.message : 'Erreur inconnue' });
    } finally {
      setSaving(false);
    }
  };

  const preview = candidate?.kind === 'file' ? candidate.previewUrl : candidate?.result.url;
  const altQuery = current ? barcodeQuery(current.barcode) : null;

  return (
    <div className="mx-auto max-w-[1500px]">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Link to="/photos" className="rounded-lg border border-border p-2 text-muted-foreground hover:bg-accent" aria-label="Retour à la galerie"><ArrowLeft className="h-4 w-4" /></Link>
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10"><ImagePlus className="h-5 w-5 text-primary" /></div>
          <div>
            <h1 className="text-lg font-bold leading-none text-foreground">Trouver des images</h1>
            <p className="mt-0.5 text-xs text-muted-foreground">{missingCount} produit(s) sans image · cliquez une image puis enregistrez, Stocky la lie au produit</p>
          </div>
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={autoSearch} onChange={event => setAutoSearch(event.target.checked)} className="h-4 w-4" />
          Rechercher automatiquement à chaque produit
        </label>
      </div>

      {notConfigured && (
        <div className="mb-4 flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div>
            <p className="font-medium text-foreground">Recherche intégrée non configurée</p>
            <p className="mt-0.5 text-muted-foreground">Ouvrez Google Images avec le bouton ci-dessous, faites un clic droit sur une image → « Copier l’image », puis revenez ici et faites Ctrl+V. L’image est liée au produit sans renommage. Pour chercher directement dans Stocky, ajoutez le secret SERPER_API_KEY (ou BRAVE_SEARCH_API_KEY) à la fonction product-image-search.</p>
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="flex max-h-[calc(100vh-11rem)] flex-col overflow-hidden rounded-xl border border-border bg-card lg:sticky lg:top-4">
          <button onClick={() => setQueueOpen(open => !open)} aria-expanded={queueOpen}
            className="flex items-center justify-between gap-2 px-3 py-2.5 text-left text-sm lg:hidden">
            <span className="font-medium text-foreground">Liste des produits <span className="text-muted-foreground">· {queue.length}</span></span>
            <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${queueOpen ? 'rotate-90' : ''}`} />
          </button>
          <div className={`${queueOpen ? 'flex' : 'hidden'} min-h-0 flex-1 flex-col border-t border-border lg:flex lg:border-t-0`}>
          <div className="space-y-2 border-b border-border p-3">
            <div className="relative"><Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" /><input value={listSearch} onChange={event => setListSearch(event.target.value)} placeholder="Filtrer : nom ou code-barres…" className="w-full rounded-lg border border-input bg-background py-1.5 pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" /></div>
            <select value={brandFilter} onChange={event => setBrandFilter(event.target.value)} className="w-full rounded-lg border border-input bg-background px-2 py-1.5 text-sm">
              <option value="">Toutes les marques</option>
              {brands.map(brand => <option key={brand} value={brand}>{brand}</option>)}
            </select>
            <label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={missingOnly} onChange={event => setMissingOnly(event.target.checked)} className="h-3.5 w-3.5" />Seulement les produits sans image</label>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {queue.slice(0, QUEUE_PAGE).map(product => {
              const image = savedImages[product.barcode] || product.image;
              const active = product.barcode === current?.barcode;
              return (
                <button key={product.barcode} onClick={() => { goTo(product); setQueueOpen(false); }} className={`flex w-full items-center gap-2.5 border-b border-border/60 px-3 py-2 text-left transition-colors ${active ? 'bg-primary/10' : 'hover:bg-accent'}`}>
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-background">{image ? <img src={resolveProductImageUrl(image) || ''} alt="" className="h-full w-full object-contain" loading="lazy" /> : <Images className="h-4 w-4 text-muted-foreground/50" />}</div>
                  <div className="min-w-0 flex-1"><p className="truncate text-xs font-medium">{product.name}</p><p className="truncate font-mono text-[10px] text-muted-foreground">{product.brand ? `${product.brand} · ` : ''}{product.barcode}</p></div>
                  {savedImages[product.barcode] && <Check className="h-4 w-4 shrink-0 text-emerald-600" />}
                </button>
              );
            })}
            {queue.length > QUEUE_PAGE && <p className="p-3 text-center text-[11px] text-muted-foreground">{queue.length - QUEUE_PAGE} autre(s) — affinez le filtre.</p>}
            {!queue.length && <p className="p-6 text-center text-xs text-muted-foreground">{missingOnly ? 'Tous les produits de cette sélection ont une image. 🎉' : 'Aucun produit trouvé.'}</p>}
          </div>
          </div>
        </aside>

        {current ? (
          <section className="min-w-0 space-y-4">
            <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center">
              <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-background">{currentImage ? <img src={resolveProductImageUrl(currentImage) || ''} alt="" className="h-full w-full object-contain" /> : <Images className="h-6 w-6 text-muted-foreground/40" />}</div>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{current.brand || 'Sans marque'}</p>
                <h2 className="text-base font-semibold leading-snug text-foreground">{current.name}</h2>
                <p className="font-mono text-xs text-muted-foreground">{current.barcode}{currentImage ? ' · a déjà une image' : ''}</p>
              </div>
              <div className="flex items-center gap-1.5">
                <button onClick={goPrevious} disabled={currentIndex <= 0} className="rounded-lg border border-border p-2 hover:bg-accent disabled:opacity-40" aria-label="Produit précédent"><ChevronLeft className="h-4 w-4" /></button>
                <span className="min-w-16 text-center text-xs text-muted-foreground">{currentIndex >= 0 ? `${currentIndex + 1} / ${queue.length}` : '—'}</span>
                <button onClick={goNext} disabled={currentIndex >= queue.length - 1} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent disabled:opacity-40"><SkipForward className="h-4 w-4" />Passer</button>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card p-4">
              <form onSubmit={event => { event.preventDefault(); runSearch(query); }} className="flex flex-col gap-2 sm:flex-row">
                <div className="relative flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Marque, nom du produit, référence…" className="w-full rounded-lg border border-input bg-background py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" /></div>
                <button type="submit" disabled={searching || query.trim().length < 2 || !!notConfigured} className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">{searching ? <Loader className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}Rechercher</button>
                <a href={googleImagesUrl(query || buildImageQuery(current))} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent"><ExternalLink className="h-4 w-4" />Google Images</a>
              </form>
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                <span>Essayer :</span>
                <button onClick={() => { const text = buildImageQuery(current); setQuery(text); runSearch(text); }} disabled={!!notConfigured} className="rounded-full border border-border px-2 py-0.5 hover:bg-accent disabled:opacity-50">marque + nom</button>
                {altQuery && <button onClick={() => { setQuery(altQuery); runSearch(altQuery); }} disabled={!!notConfigured} className="rounded-full border border-border px-2 py-0.5 font-mono hover:bg-accent disabled:opacity-50">{altQuery}</button>}
                <span className="ms-auto inline-flex items-center gap-1"><ClipboardPaste className="h-3.5 w-3.5" />Ctrl+V pour coller une image ou son adresse</span>
              </div>

              {searchError && <p className="mt-3 text-sm text-muted-foreground">{searchError}</p>}
              {searching && !results.length && <div className="flex h-40 items-center justify-center"><Loader className="h-6 w-6 animate-spin text-muted-foreground" /></div>}
              {results.length > 0 && (
                <div className={`mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 xl:grid-cols-6 ${searching ? 'opacity-50' : ''}`}>
                  {results.map(result => {
                    const selected = candidate?.kind === 'result' && candidate.result.url === result.url;
                    return (
                      <button key={result.url} onClick={() => { clearCandidate(); setCandidate({ kind: 'result', result }); }} title={result.title}
                        className={`group relative aspect-square overflow-hidden rounded-lg border-2 bg-white ${selected ? 'border-primary ring-2 ring-primary/30' : 'border-transparent hover:border-primary/40'}`}>
                        <img src={result.thumbnail} alt={result.title} loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-contain" />
                        <span className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-1 py-0.5 text-[9px] text-white">{[sizeLabel(result), result.source].filter(Boolean).join(' · ')}</span>
                        {selected && <span className="absolute right-1 top-1 rounded-full bg-primary p-0.5 text-primary-foreground"><Check className="h-3 w-3" /></span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div
              onDragOver={event => { event.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={`flex flex-col gap-4 rounded-xl border-2 border-dashed p-4 sm:flex-row sm:items-center ${dragging ? 'border-primary bg-primary/5' : 'border-border bg-card'}`}
            >
              <div className="flex aspect-square w-full shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-white sm:w-56">
                {fetchingUrl ? <Loader className="h-6 w-6 animate-spin text-muted-foreground" />
                  : preview ? <img src={preview} alt="Image choisie" referrerPolicy="no-referrer" className="h-full w-full object-contain" onError={event => { if (candidate?.kind === 'result' && event.currentTarget.src !== candidate.result.thumbnail) event.currentTarget.src = candidate.result.thumbnail; }} />
                  : <div className="px-4 text-center text-xs text-muted-foreground"><Upload className="mx-auto mb-2 h-6 w-6 opacity-50" />Choisissez un résultat, collez (Ctrl+V) ou déposez une image ici</div>}
              </div>
              <div className="min-w-0 flex-1 space-y-3">
                {candidate ? (
                  <div className="text-sm">
                    <p className="font-medium text-foreground">{candidate.kind === 'result' ? candidate.result.title || 'Image sélectionnée' : candidate.label}</p>
                    {candidate.kind === 'result' && <p className="text-xs text-muted-foreground">{[sizeLabel(candidate.result), candidate.result.source].filter(Boolean).join(' · ')}{candidate.result.page && <> · <a href={candidate.result.page} target="_blank" rel="noreferrer" className="underline">page source</a></>}</p>}
                    <p className="mt-1 text-xs text-muted-foreground">Sera recadrée en 1200 px max, convertie en JPG et liée à <span className="font-mono">{current.barcode}</span>.</p>
                  </div>
                ) : <p className="text-sm text-muted-foreground">Aucune image choisie.</p>}
                <div className="flex flex-wrap gap-2">
                  <button onClick={save} disabled={!candidate || saving || fetchingUrl} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                    {saving ? <Loader className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                    {currentImage ? 'Remplacer l’image et continuer' : 'Enregistrer et continuer'}
                  </button>
                  {candidate && <button onClick={clearCandidate} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent"><X className="h-4 w-4" />Annuler</button>}
                  <button onClick={() => fileInput.current?.click()} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent"><Upload className="h-4 w-4" />Fichier…</button>
                  <input ref={fileInput} type="file" accept="image/*" className="hidden" onChange={event => { const file = event.target.files?.[0]; if (file) pickFile(file, file.name); event.target.value = ''; }} />
                </div>
              </div>
            </div>
          </section>
        ) : (
          <section className="flex min-h-[40vh] flex-col items-center justify-center rounded-xl border border-dashed border-border text-center text-muted-foreground">
            <Images className="mb-3 h-8 w-8 opacity-40" />
            <p className="text-sm">{state.products.length ? 'Aucun produit à traiter avec ces filtres.' : 'Chargement des produits…'}</p>
          </section>
        )}
      </div>
    </div>
  );
}
