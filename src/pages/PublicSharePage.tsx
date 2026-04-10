import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { FileText, Download, Eye, Calendar, AlertCircle, Loader, ExternalLink } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { TechnicalSheet, SheetShareLink } from '../types';

export function PublicSharePage() {
  const { token } = useParams<{ token: string }>();
  const [shareLink, setShareLink] = useState<SheetShareLink | null>(null);
  const [sheets, setSheets] = useState<TechnicalSheet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      if (!token) { setError('Lien invalide'); setLoading(false); return; }
      try {
        // Fetch share link
        const { data: linkData, error: linkError } = await supabase
          .from('sheet_share_links')
          .select('*')
          .eq('token', token)
          .single();

        if (linkError || !linkData) { setError('Lien de partage introuvable'); setLoading(false); return; }

        const link = linkData as unknown as SheetShareLink;

        // Check expiry
        if (link.expires_at && new Date(link.expires_at) < new Date()) {
          setError('Ce lien de partage a expiré');
          setLoading(false);
          return;
        }

        setShareLink(link);

        // Increment view count
        await supabase.from('sheet_share_links').update({ view_count: (link.view_count || 0) + 1 }).eq('id', link.id);

        // Fetch sheets
        if (link.sheet_ids.length > 0) {
          const { data: sheetsData } = await supabase
            .from('technical_sheets')
            .select('*')
            .in('id', link.sheet_ids);
          setSheets((sheetsData || []) as unknown as TechnicalSheet[]);
        }
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

  const handleDownload = async (sheet: TechnicalSheet) => {
    // Increment download count
    await supabase.from('technical_sheets').update({ download_count: (sheet.download_count || 0) + 1 }).eq('id', sheet.id);
    window.open(sheet.file_url, '_blank');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader className="h-8 w-8 animate-spin text-primary" />
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
        {/* Header */}
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

        {/* Sheets Grid */}
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
                <span className="px-2 py-0.5 bg-secondary text-secondary-foreground text-xs rounded-lg">{formatFileSize(sheet.file_size)}</span>
              </div>
              <div className="flex gap-2">
                <button onClick={() => handleDownload(sheet)}
                  className="flex items-center gap-1.5 px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg text-sm transition-colors">
                  <Download className="h-3.5 w-3.5" /> Télécharger
                </button>
                <a href={sheet.file_url} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-4 py-2 bg-secondary hover:bg-secondary/80 text-secondary-foreground rounded-lg text-sm transition-colors">
                  <ExternalLink className="h-3.5 w-3.5" /> Voir
                </a>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="text-center mt-12 text-xs text-muted-foreground">
          Partagé via Stocky by QodWeb
        </div>
      </div>
    </div>
  );
}

export default PublicSharePage;
