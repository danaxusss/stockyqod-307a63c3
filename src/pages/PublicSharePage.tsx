import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { FileText, Download, Eye, Calendar, AlertCircle, X, Image as ImageIcon, Loader2, Files } from 'lucide-react';
import { buildSheetBundle, bundleFileName, companyFromSettings, downloadBundle, sectionsForShare } from '../utils/sheetBundle';
import { countSheetDownloads, loadShare, type PublicCompany, type PublicSheet, type SharePayload } from '../utils/publicPages';
import { SharedProductImage } from '../types';

export function PublicSharePage() {
  const { token } = useParams<{ token: string }>();
  // Read through the public-share function: visitors have no login.
  const [shareLink, setShareLink] = useState<SharePayload['link'] | null>(null);
  const [company, setCompany] = useState<PublicCompany | null>(null);
  const [sheets, setSheets] = useState<PublicSheet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pdfViewerUrl, setPdfViewerUrl] = useState<string | null>(null);
  const [photoViewer, setPhotoViewer] = useState<SharedProductImage | null>(null);
  const [bundleProgress, setBundleProgress] = useState<{ done: number; total: number } | null>(null);
  const [bundleNote, setBundleNote] = useState<string | null>(null);
  // Products of the quote that have no technical sheet: their photo instead.
  const images: SharedProductImage[] = Array.isArray(shareLink?.product_images)
    ? shareLink!.product_images!.filter(i => i && /^https?:\/\//.test(i.url))
    : [];

  useEffect(() => {
    const load = async () => {
      if (!token) { setError('Lien invalide'); setLoading(false); return; }
      try {
        // Counts one view, like opening the link always did.
        const share = await loadShare(token);
        if (share.status === 'expired') { setError('Ce lien de partage a expiré'); return; }
        if (share.status !== 'ok' || !share.link) { setError('Lien de partage introuvable'); return; }
        setShareLink(share.link);
        setCompany(share.company ?? null);
        setSheets(share.sheets || []);
      } catch (err) {
        console.error('Error loading share:', err);
        setError('Erreur lors du chargement');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [token]);

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleDownload = async (sheet: PublicSheet) => {
    if (token) await countSheetDownloads(token, [sheet.id]);
    try {
      const response = await fetch(sheet.file_url);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${sheet.title}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      window.open(sheet.file_url, '_blank');
    }
  };

  const downloadPhoto = async (image: SharedProductImage) => {
    try {
      const blob = await (await fetch(image.url)).blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const ext = (blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
      a.href = url;
      a.download = `${image.name || image.barcode}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      window.open(image.url, '_blank');
    }
  };

  // Everything in one PDF: the sheets, then the photos. Each sheet that made
  // it into the file counts as one download, like a single download does.
  const downloadAll = async () => {
    setBundleNote(null);
    setBundleProgress({ done: 0, total: sheets.length + images.length });
    try {
      const result = await buildSheetBundle(
        {
          title: 'Fiches techniques',
          subtitle: shareLink?.title || 'Documents partagés',
          details: ['Fiches techniques et photos des produits'],
          // The link's company (older links: the default company), from the server.
          company: companyFromSettings(company),
          sections: sectionsForShare(sheets, images),
        },
        { onProgress: (done, total) => setBundleProgress({ done, total }) },
      );
      downloadBundle(result.bytes, bundleFileName('Documents', shareLink?.title || 'partages'));
      const skipped = new Set(result.skipped);
      const included = sheets.filter(sheet => !skipped.has(sheet.title)).map(sheet => sheet.id);
      if (token && included.length) await countSheetDownloads(token, included);
      if (result.skipped.length) setBundleNote(`${result.skipped.length} document(s) n’ont pas pu être inclus : ${result.skipped.join(', ')}. Vous pouvez les télécharger un par un ci-dessous.`);
    } catch {
      setBundleNote('Le fichier unique n’a pas pu être créé. Vous pouvez télécharger les documents un par un ci-dessous.');
    } finally {
      setBundleProgress(null);
    }
  };

  const handleViewPdf = async (fileUrl: string) => {
    try {
      const response = await fetch(fileUrl);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      setPdfViewerUrl(blobUrl);
    } catch {
      window.open(fileUrl, '_blank');
    }
  };

  const closePdfViewer = () => {
    if (pdfViewerUrl) URL.revokeObjectURL(pdfViewerUrl);
    setPdfViewerUrl(null);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="text-center max-w-md">
          <AlertCircle className="h-16 w-16 text-destructive mx-auto mb-4" />
          <h1 className="text-xl font-bold text-foreground mb-2">Lien non disponible</h1>
          <p className="text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-primary rounded-2xl mb-4">
            <FileText className="h-8 w-8 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">{shareLink?.title || 'Documents partagés'}</h1>
          <p className="text-sm text-muted-foreground mt-2">
            {[
              sheets.length > 0 || images.length === 0 ? `${sheets.length} document${sheets.length !== 1 ? 's' : ''}` : '',
              images.length > 0 ? `${images.length} photo${images.length !== 1 ? 's' : ''}` : '',
            ].filter(Boolean).join(' · ')}
            {shareLink?.expires_at && (
              <span className="ml-2 inline-flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                Expire le {new Date(shareLink.expires_at).toLocaleDateString('fr-FR')}
              </span>
            )}
          </p>
        </div>

        {sheets.length + images.length > 1 && (
          <div className="mb-6 flex flex-col items-center gap-2">
            <button onClick={downloadAll} disabled={!!bundleProgress}
              className="flex min-h-11 items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:opacity-70">
              {bundleProgress
                ? <><Loader2 className="h-4 w-4 animate-spin" />Préparation… {bundleProgress.done} / {bundleProgress.total}</>
                : <><Files className="h-4 w-4" />Tout télécharger en un seul PDF</>}
            </button>
            <p className="text-xs text-muted-foreground">Ou téléchargez les documents un par un ci-dessous.</p>
            {bundleNote && <p role="status" className="max-w-xl text-center text-xs text-amber-700 dark:text-amber-300">{bundleNote}</p>}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {sheets.map(sheet => (
            <div key={sheet.id} className="bg-card border border-border rounded-xl p-5 hover:shadow-lg transition-all">
              <h3 className="font-semibold text-foreground mb-2">{sheet.title}</h3>
              <div className="flex flex-wrap gap-1.5 mb-3">
                {sheet.manufacturer && (
                  <span className="px-2 py-0.5 bg-primary/10 text-primary text-xs rounded-lg">{sheet.manufacturer}</span>
                )}
                {sheet.category && (
                  <span className="px-2 py-0.5 bg-primary/10 text-primary text-xs rounded-lg">{sheet.category}</span>
                )}
                {sheet.sector && (
                  <span className="px-2 py-0.5 bg-amber-500/10 text-amber-600 text-xs rounded-lg">{sheet.sector}</span>
                )}
                <span className="px-2 py-0.5 bg-secondary text-secondary-foreground text-xs rounded-lg">{formatFileSize(sheet.file_size)}</span>
              </div>
              <div className="flex gap-2">
                <button onClick={() => handleDownload(sheet)}
                  className="flex items-center gap-1.5 px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg text-sm transition-colors">
                  <Download className="h-3.5 w-3.5" /> Télécharger
                </button>
                <button onClick={() => handleViewPdf(sheet.file_url)}
                  className="flex items-center gap-1.5 px-4 py-2 bg-secondary hover:bg-secondary/80 text-secondary-foreground rounded-lg text-sm transition-colors">
                  <Eye className="h-3.5 w-3.5" /> Voir
                </button>
              </div>
            </div>
          ))}
        </div>

        {images.length > 0 && (
          <section className="mt-10">
            <h2 className="mb-1 flex items-center gap-2 text-lg font-bold text-foreground"><ImageIcon className="h-5 w-5" /> Photos des produits</h2>
            <p className="mb-4 text-sm text-muted-foreground">Pour les produits sans fiche technique.</p>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
              {images.map(image => (
                <div key={image.barcode} className="overflow-hidden rounded-xl border border-border bg-card">
                  <button onClick={() => setPhotoViewer(image)} className="block aspect-square w-full bg-white" aria-label={`Voir ${image.name}`}>
                    <img src={image.url} alt={image.name} loading="lazy" className="h-full w-full object-contain p-2" />
                  </button>
                  <div className="p-3">
                    {image.brand && <p className="truncate text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{image.brand}</p>}
                    <p className="line-clamp-2 text-sm font-semibold text-foreground">{image.name}</p>
                    <div className="mt-2 flex gap-2">
                      <button onClick={() => setPhotoViewer(image)} className="flex items-center gap-1.5 rounded-lg bg-secondary px-3 py-1.5 text-xs text-secondary-foreground hover:bg-secondary/80"><Eye className="h-3.5 w-3.5" /> Voir</button>
                      <button onClick={() => downloadPhoto(image)} className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90"><Download className="h-3.5 w-3.5" /> Télécharger</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        <div className="text-center mt-12 text-xs text-muted-foreground">
          Partagé via Stocky by QodWeb
        </div>
      </div>

      {photoViewer && (
        <div role="dialog" aria-label={photoViewer.name} className="fixed inset-0 z-[60] flex flex-col bg-black/90" onClick={() => setPhotoViewer(null)}>
          <div className="flex items-center justify-between gap-3 p-3 text-white">
            <p className="truncate font-semibold">{photoViewer.name}</p>
            <button onClick={() => setPhotoViewer(null)} aria-label="Fermer" className="rounded-lg bg-white/10 p-2 hover:bg-white/20"><X className="h-5 w-5" /></button>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center p-4">
            <img src={photoViewer.url} alt={photoViewer.name} className="max-h-full max-w-full object-contain" onClick={e => e.stopPropagation()} />
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
    </div>
  );
}

export default PublicSharePage;