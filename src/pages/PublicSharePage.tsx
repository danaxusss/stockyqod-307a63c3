import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { FileText, Download, Eye, Calendar, AlertCircle, Loader, X } from 'lucide-react';
import { sheetsApi } from '@/lib/apiClient';
import { TechnicalSheet, SheetShareLink } from '../types';

export function PublicSharePage() {
  const { token } = useParams<{ token: string }>();
  const [shareLink, setShareLink] = useState<SheetShareLink | null>(null);
  const [sheets, setSheets] = useState<TechnicalSheet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pdfViewerUrl, setPdfViewerUrl] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      if (!token) { setError('Lien invalide'); setLoading(false); return; }
      try {
        const { link, sheets: sheetsData } = await sheetsApi.getShareByToken(token);
        setShareLink(link as unknown as SheetShareLink);
        setSheets((sheetsData || []) as unknown as TechnicalSheet[]);
      } catch (err: any) {
        const msg = err?.message || '';
        if (msg.includes('410') || msg.toLowerCase().includes('expired')) {
          setError('Ce lien de partage a expiré');
        } else if (msg.includes('404') || msg.toLowerCase().includes('not found')) {
          setError('Lien de partage introuvable');
        } else {
          console.error('Error loading share:', err);
          setError('Erreur lors du chargement');
        }
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

  const handleDownload = async (sheet: TechnicalSheet) => {
    sheetsApi.incrementDownload(sheet.id).catch(() => {});
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
            {sheets.length} document{sheets.length !== 1 ? 's' : ''}
            {shareLink?.expires_at && (
              <span className="ml-2 inline-flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                Expire le {new Date(shareLink.expires_at).toLocaleDateString('fr-FR')}
              </span>
            )}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {sheets.map(sheet => (
            <div key={sheet.id} className="bg-card border border-border rounded-xl p-5 hover:shadow-lg transition-all">
              <h3 className="font-semibold text-foreground mb-2">{sheet.title}</h3>
              <div className="flex flex-wrap gap-1.5 mb-3">
                {sheet.manufacturer && (
                  <span className="px-2 py-0.5 bg-primary/10 text-primary text-xs rounded-lg">{sheet.manufacturer}</span>
                )}
                {sheet.category && (
                  <span className="px-2 py-0.5 bg-violet-500/10 text-violet-500 text-xs rounded-lg">{sheet.category}</span>
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

        <div className="text-center mt-12 text-xs text-muted-foreground">
          Partagé via Stocky by QodWeb
        </div>
      </div>

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