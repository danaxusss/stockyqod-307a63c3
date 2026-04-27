import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { FileX, Download, ArrowLeft, Printer } from 'lucide-react';
import { Quote } from '../../types';
import { SupabaseDocumentsService } from '../../utils/supabaseDocuments';
import { PdfExportService } from '../../utils/pdfExport';
import { CompanySettingsService } from '../../utils/companySettings';
import { SupabaseCompaniesService } from '../../utils/supabaseCompanies';
import { PrintPreviewModal } from '../../components/PrintPreviewModal';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../hooks/useAuth';
import { useKeyboardSave, useAutoSave } from '../../hooks/useShortcuts';

function fmt(n: number) {
  return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2 }).format(n);
}

export default function AvoirDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isSuperAdmin, isCompta } = useAuth();
  const { showToast } = useToast();

  const [avoir, setAvoir] = useState<Quote | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [avoirDate, setAvoirDate] = useState('');
  const [showPrintPreview, setShowPrintPreview] = useState(false);
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
  const [previewFilename, setPreviewFilename] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    setIsLoading(true);
    try {
      const doc = await SupabaseDocumentsService.getById(id);
      setAvoir(doc);
      setAvoirDate(doc?.quote_date || new Date(doc?.createdAt || Date.now()).toISOString().split('T')[0]);
    } catch (e) {
      showToast({ type: 'error', title: 'Erreur', message: String(e) });
    } finally {
      setIsLoading(false);
    }
  }, [id, showToast]);

  useEffect(() => { load(); }, [load]);

  const saveDate = useCallback(async () => {
    if (!avoir) return;
    try { await SupabaseDocumentsService.updateDocument(avoir.id, { quote_date: avoirDate || null }); } catch { /* silent */ }
  }, [avoir, avoirDate]);

  useKeyboardSave(saveDate, !!avoir && !isLoading);
  useAutoSave(saveDate, !!avoir && !isLoading);

  const getSettings = async (av: Quote) => {
    const compId = av.issuing_company_id || av.company_id;
    if (!compId) return null;
    try { return await CompanySettingsService.getSettings(compId); } catch { return null; }
  };

  const handleExportPdf = async () => {
    if (!avoir) return;
    try {
      const settings = await getSettings(avoir);
      await PdfExportService.exportQuoteToPdf(avoir, settings, undefined, undefined, undefined, 'avoir');
    } catch (e) {
      showToast({ type: 'error', title: 'Erreur PDF', message: String(e) });
    }
  };

  const handlePreview = async () => {
    if (!avoir) return;
    try {
      const settings = await getSettings(avoir);
      const { blob, filename } = await PdfExportService.generatePdfBlob(avoir, settings, undefined, undefined, undefined, 'avoir');
      setPreviewBlob(blob);
      setPreviewFilename(filename);
      setShowPrintPreview(true);
    } catch (e) {
      showToast({ type: 'error', title: 'Erreur aperçu', message: String(e) });
    }
  };

  if (!isSuperAdmin && !isCompta) return <div className="text-center py-12 text-muted-foreground">Accès réservé au rôle Comptabilité.</div>;
  if (isLoading) return <div className="flex items-center justify-center min-h-[40vh]"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;
  if (!avoir) return <div className="text-center py-12 text-muted-foreground">Avoir introuvable.</div>;

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => navigate('/compta/avoirs')} className="p-1.5 hover:bg-accent rounded-lg">
          <ArrowLeft className="h-4 w-4 text-muted-foreground" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold text-foreground font-mono text-violet-600 dark:text-violet-400">{avoir.quoteNumber}</h1>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs text-muted-foreground">{avoir.customer?.fullName} —</span>
            <input
              type="date"
              value={avoirDate}
              onChange={e => setAvoirDate(e.target.value)}
              onBlur={async () => {
                if (!avoir) return;
                try { await SupabaseDocumentsService.updateDocument(avoir.id, { quote_date: avoirDate || null }); }
                catch { /* ignore */ }
              }}
              className="text-xs px-1.5 py-0.5 border border-input rounded bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>
        <button onClick={handleExportPdf} className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg">
          <Download className="h-3.5 w-3.5" /><span>PDF</span>
        </button>
        <button onClick={handlePreview} className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-secondary hover:bg-accent border border-border text-foreground rounded-lg">
          <Printer className="h-3.5 w-3.5" /><span>Aperçu</span>
        </button>
      </div>

      {/* Totals */}
      <div className="glass rounded-lg p-4 grid grid-cols-2 gap-3 text-sm">
        <div className="text-center">
          <div className="text-base font-bold text-foreground">{fmt(avoir.totalAmount)} Dh</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">Montant TTC</div>
        </div>
        <div className="text-center">
          <div className="text-base font-bold text-foreground">{avoir.items.length}</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">Articles</div>
        </div>
      </div>

      {/* Source invoice link */}
      {avoir.parent_document_id && (
        <div className="glass rounded-lg p-3 flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Facture source :</span>
          <Link to={`/compta/invoices/${avoir.parent_document_id}`} className="text-xs font-mono font-semibold text-primary hover:underline">
            Voir la facture →
          </Link>
        </div>
      )}

      {/* Client info */}
      <div className="glass rounded-lg p-4 grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
        <div>
          <p className="text-[11px] text-muted-foreground mb-0.5">Client</p>
          <p className="font-medium text-foreground">{avoir.customer?.fullName || '—'}</p>
        </div>
        <div>
          <p className="text-[11px] text-muted-foreground mb-0.5">Téléphone</p>
          <p className="text-foreground">{avoir.customer?.phoneNumber || '—'}</p>
        </div>
        <div>
          <p className="text-[11px] text-muted-foreground mb-0.5">Ville</p>
          <p className="text-foreground">{avoir.customer?.city || '—'}</p>
        </div>
      </div>

      {/* Reason / notes */}
      {avoir.notes && (
        <div className="glass rounded-lg p-4">
          <p className="text-[11px] text-muted-foreground mb-1">Motif de l'avoir</p>
          <p className="text-sm text-foreground">{avoir.notes}</p>
        </div>
      )}

      {/* Items */}
      <div className="glass rounded-lg overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">Articles concernés</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-secondary/30">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-muted-foreground">Désignation</th>
                <th className="px-4 py-2 text-center font-medium text-muted-foreground">Qté</th>
                <th className="px-4 py-2 text-right font-medium text-muted-foreground">P.U HT</th>
                <th className="px-4 py-2 text-right font-medium text-muted-foreground">Total HT</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {avoir.items.map((item, i) => (
                <tr key={i} className="hover:bg-accent/20">
                  <td className="px-4 py-2.5 text-foreground font-medium">{item.name}</td>
                  <td className="px-4 py-2.5 text-center text-foreground">{item.quantity}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-foreground">{fmt(item.unitPrice)} Dh</td>
                  <td className="px-4 py-2.5 text-right font-mono font-semibold text-foreground">{fmt(item.quantity * item.unitPrice)} Dh</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showPrintPreview && previewBlob && (
        <PrintPreviewModal blob={previewBlob} filename={previewFilename} onClose={() => { setShowPrintPreview(false); setPreviewBlob(null); }} />
      )}
    </div>
  );
}
