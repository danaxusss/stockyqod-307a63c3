import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle, ArrowLeft, ExternalLink, Eye, FileText, Library, Link2, Loader, Search, Upload, X,
} from 'lucide-react';
import type { Product, TechnicalSheet } from '../types';
import { useToast } from '../context/ToastContext';
import { useEscapeKey } from '../hooks/useShortcuts';
import {
  buildSheetQuery, googleDocumentSearchUrl, kindLabel, libraryMatches, sheetTitle,
  type SheetDocumentKind, type SheetQueryFlavor, type SheetSearchResult,
} from '../utils/sheetSearch';
import { SheetSearchNotConfiguredError, SheetSearchService } from '../utils/sheetSearchService';
import { createSheetFromFile, findSheetBySourceUrl, linkSheetToProduct, loadAllSheets } from '../utils/technicalSheets';
import { renderPdfPages } from '../utils/pdfPreview';

type Candidate =
  | { type: 'web'; key: string; title: string; source: string; kind: SheetDocumentKind | null; result: SheetSearchResult }
  | { type: 'library'; key: string; title: string; source: string; kind: SheetDocumentKind | null; sheet: TechnicalSheet };

type Preview = {
  key: string;
  status: 'loading' | 'ready' | 'unavailable' | 'error';
  pages: string[];
  numPages: number;
  message?: string;
};

const PREVIEW_PAGES = 3;
const WIDE_QUERY = '(min-width: 1024px)';
const MAX_PREVIEW_PAGES = 20;

const libraryKind = (sheet: TechnicalSheet): SheetDocumentKind | null =>
  /pdf/i.test(sheet.file_type) || /\.pdf($|\?)/i.test(sheet.file_url) ? 'pdf'
    : /wordprocessingml|\.docx($|\?)/i.test(`${sheet.file_type} ${sheet.file_url}`) ? 'docx'
      : /msword|\.doc($|\?)/i.test(`${sheet.file_type} ${sheet.file_url}`) ? 'doc' : null;

/**
 * Find a technical sheet for a product: sheets already in the library first,
 * then documents found on the web (PDF, optionally Word). Each one can be
 * previewed (pages drawn in the app) and linked; a web document is stored in
 * the library once and reused for any other product it is linked to.
 */
export function TechnicalSheetFinder({ product, linkedSheetIds, onLinked, onClose }: {
  product: Pick<Product, 'barcode' | 'name' | 'brand'>;
  linkedSheetIds: string[];
  onLinked: (sheet: TechnicalSheet) => void;
  onClose: () => void;
}) {
  const { showToast } = useToast();
  // Wide screens show the preview beside the results; narrower ones over them.
  const [wide, setWide] = useState(() => window.matchMedia(WIDE_QUERY).matches);
  const [query, setQuery] = useState(() => buildSheetQuery(product, 'fr'));
  const [fileType, setFileType] = useState<'pdf' | 'documents'>('pdf');
  const [results, setResults] = useState<SheetSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [notConfigured, setNotConfigured] = useState('');
  const [library, setLibrary] = useState<TechnicalSheet[]>([]);
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [linkingKey, setLinkingKey] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const downloads = useRef(new Map<string, Promise<{ file: File; kind: SheetDocumentKind }>>());
  const searchRequest = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const media = window.matchMedia(WIDE_QUERY);
    const update = () => setWide(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEscapeKey(() => { if (!wide && selected) setSelected(null); else onClose(); }, true);

  useEffect(() => { loadAllSheets().then(setLibrary).catch(() => setLibrary([])); }, []);

  const matches = useMemo(() => libraryMatches(library, product, linkedSheetIds), [library, linkedSheetIds, product]);

  const runSearch = useCallback(async (text: string, type: 'pdf' | 'documents') => {
    const value = text.trim();
    if (value.length < 2) return;
    const requestId = ++searchRequest.current;
    setSearching(true);
    setSearchError('');
    try {
      const found = await SheetSearchService.search(value, type);
      if (requestId !== searchRequest.current) return;
      setResults(found);
      if (!found.length) setSearchError('Aucun document trouvé. Essayez « Datasheet », la référence, ou « PDF ou Word ».');
    } catch (error) {
      if (requestId !== searchRequest.current) return;
      setResults([]);
      if (error instanceof SheetSearchNotConfiguredError) setNotConfigured(error.message);
      else setSearchError(error instanceof Error ? error.message : 'Recherche impossible');
    } finally {
      if (requestId === searchRequest.current) setSearching(false);
    }
  }, []);

  useEffect(() => { runSearch(query, fileType); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const download = useCallback((url: string) => {
    let pending = downloads.current.get(url);
    if (!pending) {
      pending = SheetSearchService.fetchDocument(url);
      // A failed download may work on a second try (timeouts): don't cache failures.
      pending.catch(() => downloads.current.delete(url));
      downloads.current.set(url, pending);
    }
    return pending;
  }, []);

  const loadPreview = useCallback(async (candidate: Candidate, pageLimit: number) => {
    setPreview(current => ({ key: candidate.key, status: 'loading', pages: current?.key === candidate.key ? current.pages : [], numPages: current?.key === candidate.key ? current.numPages : 0 }));
    try {
      let data: ArrayBuffer;
      let kind: SheetDocumentKind | null;
      if (candidate.type === 'web') {
        const document = await download(candidate.result.url);
        kind = document.kind;
        data = await document.file.arrayBuffer();
      } else {
        kind = libraryKind(candidate.sheet);
        if (kind !== 'pdf') throw Object.assign(new Error('unavailable'), { unavailable: true });
        const response = await fetch(candidate.sheet.file_url);
        if (!response.ok) throw new Error(`Fichier inaccessible (HTTP ${response.status})`);
        data = await response.arrayBuffer();
      }
      if (kind !== 'pdf') {
        setPreview({ key: candidate.key, status: 'unavailable', pages: [], numPages: 0, message: 'Aperçu non disponible pour les documents Word. Ouvrez l’original pour le vérifier.' });
        return;
      }
      const rendered = await renderPdfPages(data, pageLimit);
      setPreview({ key: candidate.key, status: 'ready', pages: rendered.pages, numPages: rendered.numPages });
    } catch (error) {
      if ((error as { unavailable?: boolean }).unavailable) {
        setPreview({ key: candidate.key, status: 'unavailable', pages: [], numPages: 0, message: 'Aperçu non disponible pour ce type de fichier. Ouvrez-le pour le vérifier.' });
        return;
      }
      setPreview({ key: candidate.key, status: 'error', pages: [], numPages: 0, message: error instanceof Error ? error.message : 'Aperçu impossible' });
    }
  }, [download]);

  const openPreview = (candidate: Candidate) => {
    setSelected(candidate);
    loadPreview(candidate, PREVIEW_PAGES);
  };

  const link = async (candidate: Candidate) => {
    if (linkingKey) return;
    setLinkingKey(candidate.key);
    try {
      let sheet: TechnicalSheet;
      if (candidate.type === 'library') {
        sheet = candidate.sheet;
      } else {
        const existing = await findSheetBySourceUrl(candidate.result.url);
        if (existing) {
          sheet = existing;
        } else {
          const { file } = await download(candidate.result.url);
          sheet = await createSheetFromFile(file, {
            title: sheetTitle(candidate.result, product.name),
            manufacturer: product.brand || '',
            sourceUrl: candidate.result.url,
          });
          setLibrary(current => [...current, sheet]);
        }
      }
      await linkSheetToProduct(sheet.id, product.barcode);
      onLinked(sheet);
      showToast({ type: 'success', message: `Fiche « ${sheet.title} » liée à ${product.name}` });
      onClose();
    } catch (error) {
      showToast({ type: 'error', title: 'Liaison impossible', message: error instanceof Error ? error.message : 'Erreur inconnue' });
    } finally {
      setLinkingKey(null);
    }
  };

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    setImporting(true);
    try {
      const sheet = await createSheetFromFile(file, { title: file.name.replace(/\.[^.]+$/, ''), manufacturer: product.brand || '' });
      await linkSheetToProduct(sheet.id, product.barcode);
      onLinked(sheet);
      showToast({ type: 'success', message: 'Fiche technique ajoutée et liée' });
      onClose();
    } catch (error) {
      showToast({ type: 'error', title: 'Import impossible', message: error instanceof Error ? error.message : 'Erreur inconnue' });
    } finally {
      setImporting(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const searchWith = (flavor: SheetQueryFlavor) => {
    const text = buildSheetQuery(product, flavor);
    setQuery(text);
    runSearch(text, fileType);
  };

  const libraryCandidates: Candidate[] = matches.map(sheet => ({
    type: 'library', key: `library:${sheet.id}`, title: sheet.title, source: sheet.manufacturer || 'Bibliothèque Stocky', kind: libraryKind(sheet), sheet,
  }));
  const webCandidates: Candidate[] = results.map(result => ({
    type: 'web', key: `web:${result.url}`, title: sheetTitle(result, result.title || result.url), source: result.source,
    kind: result.kind ?? (fileType === 'pdf' ? 'pdf' : null), result,
  }));

  const previewPane = selected && (
    <PreviewPane
      candidate={selected}
      preview={preview?.key === selected.key ? preview : null}
      linking={linkingKey === selected.key}
      onShowAll={() => loadPreview(selected, MAX_PREVIEW_PAGES)}
      onLink={() => link(selected)}
      onBack={wide ? undefined : () => setSelected(null)}
    />
  );

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-stretch justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-4"
      onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="sheet-finder-title"
        className="relative flex h-full w-full max-w-6xl flex-col overflow-hidden border border-border bg-card shadow-2xl sm:h-[90dvh] sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2 id="sheet-finder-title" className="flex items-center gap-2 text-base font-semibold text-foreground"><FileText className="h-4 w-4 text-primary" />Trouver une fiche technique</h2>
            <p className="truncate text-xs text-muted-foreground">{product.name} · {product.brand ? `${product.brand} · ` : ''}<span className="font-mono">{product.barcode}</span></p>
          </div>
          <button onClick={onClose} aria-label="Fermer" className="rounded-lg p-2 text-muted-foreground hover:bg-accent hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>

        <div className="space-y-2 border-b border-border p-3">
          <form onSubmit={(event: FormEvent) => { event.preventDefault(); runSearch(query, fileType); }} className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input value={query} onChange={event => setQuery(event.target.value)} aria-label="Recherche de fiche technique"
                className="w-full rounded-lg border border-input bg-background py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
            <button type="submit" disabled={searching || query.trim().length < 2 || !!notConfigured}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
              {searching ? <Loader className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}<span className="hidden sm:inline">Rechercher</span>
            </button>
          </form>
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="text-muted-foreground">Essayer :</span>
            {([['fr', 'Fiche technique'], ['en', 'Datasheet'], ['reference', 'Référence']] as [SheetQueryFlavor, string][]).map(([flavor, label]) => (
              <button key={flavor} onClick={() => searchWith(flavor)} disabled={!!notConfigured} className="rounded-full border border-border px-2 py-0.5 hover:bg-accent disabled:opacity-50">{label}</button>
            ))}
            <select value={fileType} aria-label="Type de document" onChange={event => { const type = event.target.value as 'pdf' | 'documents'; setFileType(type); runSearch(query, type); }}
              className="rounded-full border border-border bg-background px-2 py-0.5">
              <option value="pdf">PDF uniquement</option>
              <option value="documents">PDF ou Word</option>
            </select>
            <span className="ml-auto flex items-center gap-1.5">
              <a href={googleDocumentSearchUrl(query)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 hover:bg-accent"><ExternalLink className="h-3 w-3" />Google</a>
              <button onClick={() => fileInput.current?.click()} disabled={importing} className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 hover:bg-accent disabled:opacity-50">
                {importing ? <Loader className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}Importer un fichier
              </button>
              <input ref={fileInput} type="file" accept=".pdf,.doc,.docx,application/pdf" className="hidden" onChange={event => importFile(event.target.files?.[0])} />
            </span>
          </div>
        </div>

        <div className={`grid min-h-0 flex-1 ${wide ? 'grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]' : ''}`}>
          <div className="min-h-0 overflow-y-auto">
            {libraryCandidates.length > 0 && (
              <ResultSection title="Déjà dans Stocky" icon={<Library className="h-3.5 w-3.5" />}>
                {libraryCandidates.map(candidate => (
                  <ResultRow key={candidate.key} candidate={candidate} active={selected?.key === candidate.key} linking={linkingKey === candidate.key}
                    onPreview={() => openPreview(candidate)} onLink={() => link(candidate)} openUrl={candidate.type === 'library' ? candidate.sheet.file_url : ''} />
                ))}
              </ResultSection>
            )}
            <ResultSection title="Sur le web" icon={<Search className="h-3.5 w-3.5" />}>
              {notConfigured && (
                <div className="m-3 flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                  <div>
                    <p className="font-medium text-foreground">Recherche intégrée non configurée</p>
                    <p className="mt-0.5 text-muted-foreground">Cherchez la fiche avec le bouton « Google », téléchargez le PDF puis utilisez « Importer un fichier ». Pour chercher directement dans Stocky, la fonction technical-sheet-search doit être déployée avec le secret SERPER_API_KEY (ou BRAVE_SEARCH_API_KEY).</p>
                  </div>
                </div>
              )}
              {searching && !results.length && <div className="flex h-32 items-center justify-center"><Loader className="h-5 w-5 animate-spin text-muted-foreground" /></div>}
              {searchError && <p className="px-4 py-6 text-center text-sm text-muted-foreground">{searchError}</p>}
              <div className={searching ? 'opacity-50' : ''}>
                {webCandidates.map(candidate => (
                  <ResultRow key={candidate.key} candidate={candidate} active={selected?.key === candidate.key} linking={linkingKey === candidate.key}
                    onPreview={() => openPreview(candidate)} onLink={() => link(candidate)} openUrl={candidate.type === 'web' ? candidate.result.url : ''} />
                ))}
              </div>
            </ResultSection>
          </div>
          {wide && (
            <div className="flex min-h-0 flex-col border-l border-border">
              {previewPane || (
                <div className="flex flex-1 flex-col items-center justify-center p-6 text-center text-sm text-muted-foreground">
                  <Eye className="mb-2 h-6 w-6 opacity-40" />Cliquez sur « Aperçu » pour vérifier une fiche avant de la lier.
                </div>
              )}
            </div>
          )}
        </div>

        {!wide && selected && <div className="absolute inset-0 z-10 flex flex-col bg-card">{previewPane}</div>}
      </div>
    </div>,
    document.body,
  );
}

function ResultSection({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section>
      <h3 className="sticky top-0 z-[1] flex items-center gap-1.5 border-b border-border bg-secondary/80 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur">{icon}{title}</h3>
      {children}
    </section>
  );
}

function ResultRow({ candidate, active, linking, onPreview, onLink, openUrl }: {
  candidate: Candidate; active: boolean; linking: boolean; onPreview: () => void; onLink: () => void; openUrl: string;
}) {
  const snippet = candidate.type === 'web' ? candidate.result.snippet : '';
  return (
    <div className={`border-b border-border/60 px-4 py-3 ${active ? 'bg-primary/5' : ''}`}>
      <div className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0 rounded bg-red-500/10 px-1.5 py-0.5 text-[10px] font-bold text-red-600">{kindLabel(candidate.kind)}</span>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm font-medium leading-snug text-foreground">{candidate.title}</p>
          <p className="truncate text-[11px] text-muted-foreground">{candidate.source}</p>
          {snippet && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{snippet}</p>}
        </div>
      </div>
      <div className="mt-2 flex items-center justify-end gap-1.5">
        {openUrl && <a href={openUrl} target="_blank" rel="noreferrer" aria-label={`Ouvrir ${candidate.title}`} className="rounded-md p-1.5 text-muted-foreground hover:bg-accent"><ExternalLink className="h-4 w-4" /></a>}
        <button onClick={onPreview} className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-accent"><Eye className="h-3.5 w-3.5" />Aperçu</button>
        <button onClick={onLink} disabled={linking} className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50">
          {linking ? <Loader className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}Lier
        </button>
      </div>
    </div>
  );
}

function PreviewPane({ candidate, preview, linking, onShowAll, onLink, onBack }: {
  candidate: Candidate; preview: Preview | null; linking: boolean; onShowAll: () => void; onLink: () => void; onBack?: () => void;
}) {
  const openUrl = candidate.type === 'web' ? candidate.result.url : candidate.sheet.file_url;
  return (
    <>
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        {onBack && <button onClick={onBack} aria-label="Retour aux résultats" className="rounded-lg p-1.5 hover:bg-accent"><ArrowLeft className="h-4 w-4" /></button>}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{candidate.title}</p>
          <p className="truncate text-[11px] text-muted-foreground">{candidate.source}{preview?.numPages ? ` · ${preview.numPages} page(s)` : ''}</p>
        </div>
        <a href={openUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-accent"><ExternalLink className="h-3.5 w-3.5" />Original</a>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto bg-secondary/30 p-3">
        {(!preview || preview.status === 'loading') && !preview?.pages.length && (
          <div className="flex h-full min-h-40 flex-col items-center justify-center gap-2 text-xs text-muted-foreground"><Loader className="h-5 w-5 animate-spin" />Téléchargement de la fiche…</div>
        )}
        {preview && (preview.status === 'unavailable' || preview.status === 'error') && (
          <div className="flex h-full min-h-40 flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
            <AlertTriangle className="h-5 w-5 text-amber-600" />{preview.message}
          </div>
        )}
        {preview && preview.pages.length > 0 && (
          <div className="mx-auto max-w-2xl space-y-3">
            {preview.pages.map((page, index) => <img key={index} src={page} alt={`Page ${index + 1}`} className="w-full rounded border border-border bg-white shadow-sm" />)}
            {preview.numPages > preview.pages.length && (
              <button onClick={onShowAll} disabled={preview.status === 'loading'} className="w-full rounded-lg border border-border bg-card py-2 text-xs hover:bg-accent disabled:opacity-50">
                {preview.status === 'loading' ? 'Chargement…' : `Afficher ${preview.numPages > MAX_PREVIEW_PAGES ? `les ${MAX_PREVIEW_PAGES} premières` : `les ${preview.numPages}`} pages`}
              </button>
            )}
          </div>
        )}
      </div>
      <div className="border-t border-border p-3">
        <button onClick={onLink} disabled={linking} className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50">
          {linking ? <Loader className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}Lier cette fiche au produit
        </button>
      </div>
    </>
  );
}
