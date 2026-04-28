import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, FileDown, Trash2, Copy, Truck, Search, Loader, ClipboardList } from 'lucide-react';
import { Quote } from '../../types';
import { SupabaseDocumentsService } from '../../utils/supabaseDocuments';
import { PdfExportService } from '../../utils/pdfExport';
import { CompanySettingsService } from '../../utils/companySettings';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';

export default function BonCommandeDirectoryPage() {
  const navigate = useNavigate();
  const { isFacturation, isSuperAdmin, companyId } = useAuth();
  const { showToast } = useToast();
  const [bcs, setBcs] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showBLPicker, setShowBLPicker] = useState(false);
  const [bls, setBls] = useState<Quote[]>([]);
  const [blLoading, setBlLoading] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await SupabaseDocumentsService.getAllBCs();
      setBcs(data);
    } catch {
      showToast({ type: 'error', message: 'Erreur lors du chargement des Bons de Commande' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (!isFacturation && !isSuperAdmin) {
    return <div className="p-8 text-center text-muted-foreground">Accès réservé au rôle Facturation.</div>;
  }

  const filtered = bcs.filter(bc => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      (bc.quoteNumber || '').toLowerCase().includes(q) ||
      (bc.customer?.fullName || '').toLowerCase().includes(q)
    );
  });

  const handleCreateNew = async () => {
    if (!companyId) { showToast({ type: 'error', message: 'Société non définie' }); return; }
    try {
      const bc = await SupabaseDocumentsService.createEmptyDocument('bon_commande', companyId);
      navigate(`/compta/bons-commande/${bc.id}`);
    } catch (e: any) {
      showToast({ type: 'error', message: e.message });
    }
  };

  const handleCreateFromBL = async (blId: string) => {
    try {
      const bc = await SupabaseDocumentsService.createBCFromBL(blId);
      setShowBLPicker(false);
      navigate(`/compta/bons-commande/${bc.id}`);
      showToast({ type: 'success', message: 'BC créé depuis le BL' });
    } catch (e: any) {
      showToast({ type: 'error', message: e.message });
    }
  };

  const handleOpenBLPicker = async () => {
    setShowBLPicker(true);
    setBlLoading(true);
    try {
      const data = await SupabaseDocumentsService.getAllBLs();
      setBls(data);
    } catch {
      showToast({ type: 'error', message: 'Erreur chargement BLs' });
    } finally {
      setBlLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Supprimer ce Bon de Commande ?')) return;
    try {
      await SupabaseDocumentsService.deleteDocument(id);
      setBcs(prev => prev.filter(bc => bc.id !== id));
      showToast({ type: 'success', message: 'BC supprimé' });
    } catch (e: any) {
      showToast({ type: 'error', message: e.message });
    }
  };

  const handleDuplicate = async (id: string) => {
    try {
      const newDoc = await SupabaseDocumentsService.duplicateDocument(id);
      navigate(`/compta/bons-commande/${newDoc.id}`);
      showToast({ type: 'success', message: 'BC dupliqué' });
    } catch (e: any) {
      showToast({ type: 'error', message: e.message });
    }
  };

  const handleExportPdf = async (bc: Quote) => {
    setExporting(bc.id);
    try {
      const settings = await CompanySettingsService.getSettings(bc.company_id || companyId || undefined).catch(() => null);
      await PdfExportService.exportQuoteToPdf(bc, settings, undefined, undefined, undefined, 'bon_commande');
    } catch (e: any) {
      showToast({ type: 'error', message: e.message });
    } finally {
      setExporting(null);
    }
  };

  const formatDate = (d: Date) => new Date(d).toLocaleDateString('fr-FR');

  const statusLabel = (s: string) => {
    const map: Record<string, string> = { draft: 'Brouillon', final: 'Final', pending: 'En attente', solde: 'Soldé' };
    return map[s] || s;
  };
  const statusClass = (s: string) => {
    if (s === 'final') return 'bg-emerald-500/10 text-emerald-600';
    if (s === 'pending') return 'bg-amber-500/10 text-amber-600';
    if (s === 'solde') return 'bg-blue-500/10 text-blue-600';
    return 'bg-muted text-muted-foreground';
  };

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <div className="glass rounded-xl shadow-lg p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-primary rounded-lg">
              <ClipboardList className="h-4 w-4 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground">Bons de Commande</h1>
              <p className="text-xs text-muted-foreground">{bcs.length} document(s)</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleOpenBLPicker} className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-border rounded-lg hover:bg-accent">
              <Truck className="h-3.5 w-3.5" />
              Depuis BL
            </button>
            <button onClick={handleCreateNew} className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90">
              <Plus className="h-3.5 w-3.5" />
              Nouveau BC
            </button>
          </div>
        </div>
      </div>

      <div className="glass rounded-xl shadow-lg overflow-hidden">
        {/* Search */}
        <div className="p-3 border-b border-border">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Rechercher par N°, client..."
              className="w-full pl-8 pr-3 py-1.5 text-sm border border-input rounded-lg bg-background text-foreground"
            />
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground text-sm">
            {search ? 'Aucun résultat' : 'Aucun Bon de Commande. Créez-en un.'}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 text-xs text-muted-foreground uppercase">
                <th className="px-3 py-2 text-left">N°</th>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">Client</th>
                <th className="px-3 py-2 text-center">Articles</th>
                <th className="px-3 py-2 text-center">Statut</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map(bc => (
                <tr key={bc.id} className="hover:bg-accent/50 cursor-pointer" onClick={() => navigate(`/compta/bons-commande/${bc.id}`)}>
                  <td className="px-3 py-2 font-mono text-xs">{bc.quoteNumber}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{formatDate(bc.createdAt)}</td>
                  <td className="px-3 py-2 text-xs">{bc.customer?.fullName || '—'}</td>
                  <td className="px-3 py-2 text-xs text-center">{bc.items?.length || 0}</td>
                  <td className="px-3 py-2 text-center">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusClass(bc.status)}`}>
                      {statusLabel(bc.status)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => handleExportPdf(bc)} disabled={exporting === bc.id} className="p-1 hover:bg-accent rounded" title="PDF">
                        {exporting === bc.id ? <Loader className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />}
                      </button>
                      <button onClick={() => handleDuplicate(bc.id)} className="p-1 hover:bg-accent rounded" title="Dupliquer">
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => handleDelete(bc.id)} className="p-1 hover:bg-destructive/10 text-destructive rounded" title="Supprimer">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* BL Picker Modal */}
      {showBLPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="glass rounded-xl shadow-2xl w-full max-w-lg p-5 max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold">Choisir un BL source</h2>
              <button onClick={() => setShowBLPicker(false)} className="p-1 hover:bg-accent rounded">
                ×
              </button>
            </div>
            {blLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="overflow-y-auto divide-y divide-border">
                {bls.map(bl => (
                  <button key={bl.id} onClick={() => handleCreateFromBL(bl.id)}
                    className="w-full flex items-center justify-between px-3 py-2 hover:bg-accent text-left text-sm">
                    <span className="font-mono text-xs">{bl.quoteNumber}</span>
                    <span className="text-muted-foreground text-xs">{bl.customer?.fullName || '—'}</span>
                    <span className="text-xs text-muted-foreground">{formatDate(bl.createdAt)}</span>
                  </button>
                ))}
                {bls.length === 0 && <p className="py-6 text-center text-xs text-muted-foreground">Aucun BL disponible</p>}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
