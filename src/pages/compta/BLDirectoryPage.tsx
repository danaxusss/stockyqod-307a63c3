import React, { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Truck, Search, Download, Trash2, CheckSquare, Square, FileText, Building2, Plus } from 'lucide-react';
import { Quote, Company } from '../../types';
import { SupabaseDocumentsService } from '../../utils/supabaseDocuments';
import { SupabaseCompaniesService } from '../../utils/supabaseCompanies';
import { PdfExportService } from '../../utils/pdfExport';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../hooks/useAuth';
import { exportToCSV } from '../../utils/csvExport';

function statusBadge(status: string) {
  if (status === 'final') return <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300">Finalisé</span>;
  return <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300">Brouillon</span>;
}

export default function BLDirectoryPage() {
  const { isSuperAdmin, isCompta } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [bls, setBls] = useState<Quote[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showProformaModal, setShowProformaModal] = useState(false);
  const [singleProformaBL, setSingleProformaBL] = useState<Quote | null>(null);
  const [targetCompanyId, setTargetCompanyId] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [isCreatingNew, setIsCreatingNew] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [data, allCompanies] = await Promise.all([
        SupabaseDocumentsService.getAllBLs(),
        SupabaseCompaniesService.getAllCompanies(),
      ]);
      setBls(data);
      setCompanies(allCompanies);
    } catch (e) {
      showToast({ type: 'error', title: 'Erreur', message: String(e) });
    } finally {
      setIsLoading(false);
    }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  const handleNewBL = async () => {
    const compId = companies[0]?.id;
    if (!compId) { showToast({ type: 'error', message: 'Aucune société disponible' }); return; }
    setIsCreatingNew(true);
    try {
      const doc = await SupabaseDocumentsService.createEmptyDocument('bl', compId);
      navigate(`/compta/bls/${doc.id}?new=1`);
    } catch (e) {
      showToast({ type: 'error', message: String(e) });
    } finally {
      setIsCreatingNew(false);
    }
  };

  const toggleRow = (id: string) =>
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const toggleAll = () => {
    const eligible = filtered.filter(b => b.status !== 'final').map(b => b.id);
    const allSelected = eligible.every(id => selectedIds.includes(id));
    setSelectedIds(allSelected ? [] : eligible);
  };

  const handleDelete = async (id: string, num: string) => {
    if (!window.confirm(`Supprimer le BL ${num} ? Action irréversible.`)) return;
    try {
      await SupabaseDocumentsService.deleteDocument(id);
      showToast({ type: 'success', message: `${num} supprimé` });
      await load();
    } catch (e) {
      showToast({ type: 'error', title: 'Erreur', message: String(e) });
    }
  };

  const handleExportPdf = async (bl: Quote) => {
    try {
      const compId = bl.company_id;
      const company = compId ? await SupabaseCompaniesService.getCompanyById(compId) : null;
      const settings = company ? {
        company_name: company.name, address: company.address, phone: company.phone,
        phone2: company.phone2, email: company.email, ice: company.ice, rc: company.rc,
        if_number: company.if_number, cnss: company.cnss, patente: company.patente,
        logo_url: company.logo_url, logo_size: company.logo_size,
        tva_rate: company.tva_rate, quote_validity_days: company.quote_validity_days,
        payment_terms: company.payment_terms, quote_visible_fields: company.quote_visible_fields,
        quote_style: { accentColor: company.accent_color, fontFamily: company.font_family, showBorders: true, borderRadius: 1, headerSize: 'large', totalsStyle: 'highlighted' },
      } as any : null;
      await PdfExportService.exportQuoteToPdf(bl, settings, undefined, undefined, undefined, 'bl');
    } catch (e) {
      showToast({ type: 'error', title: 'Erreur PDF', message: String(e) });
    }
  };

  // Create proforma — handles both single-row and multi-select
  const handleConfirmProforma = async () => {
    if (!targetCompanyId) return;
    const ids = singleProformaBL ? [singleProformaBL.id] : selectedIds;
    if (ids.length === 0) return;
    setIsCreating(true);
    try {
      const proforma = await SupabaseDocumentsService.createProformaFromBLs(ids, targetCompanyId);
      showToast({ type: 'success', title: 'Proforma créé', message: proforma.quoteNumber });
      setShowProformaModal(false);
      setSingleProformaBL(null);
      setSelectedIds([]);
      setTargetCompanyId('');
      navigate(`/compta/proformas/${proforma.id}`);
    } catch (e) {
      showToast({ type: 'error', title: 'Erreur', message: String(e) });
    } finally {
      setIsCreating(false);
    }
  };

  const filtered = bls.filter(b => {
    const q = search.toLowerCase();
    const clientCode = ((b.customer as any)?.clientCode || (b.customer as any)?.client_code || '').toLowerCase();
    return !q || b.quoteNumber.toLowerCase().includes(q)
      || b.customer?.fullName?.toLowerCase().includes(q)
      || b.customer?.phoneNumber?.toLowerCase().includes(q)
      || clientCode.includes(q);
  });

  const handleExportCSV = () => {
    const companyMap: Record<string, string> = {};
    companies.forEach(c => { companyMap[c.id] = c.name; });
    const rows = filtered.map(b => ({
      'N° BL': b.quoteNumber,
      'Client': b.customer?.fullName || '',
      'Téléphone': b.customer?.phoneNumber || '',
      'Ville': b.customer?.city || '',
      'Société': (b.company_id && companyMap[b.company_id]) || '',
      'Total TTC': b.totalAmount,
      'Statut': b.status,
      'Date': new Date(b.createdAt).toLocaleDateString('fr-FR'),
    }));
    exportToCSV(rows, `bls-${new Date().toISOString().slice(0, 10)}`);
  };

  const eligibleCount = filtered.filter(b => b.status !== 'final').length;
  const selectedEligible = selectedIds.filter(id => filtered.find(b => b.id === id && b.status !== 'final'));

  if (!isSuperAdmin && !isCompta) {
    return <div className="text-center py-12 text-muted-foreground">Accès réservé au rôle Comptabilité.</div>;
  }

  return (
    <div className="space-y-4">
      <div className="glass rounded-xl shadow-lg p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 bg-teal-600 rounded-lg">
              <Truck className="h-4 w-4 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground">Bons de Livraison</h1>
              <p className="text-xs text-muted-foreground">{filtered.length} BL{filtered.length !== 1 ? 's' : ''}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleNewBL}
              disabled={isCreatingNew}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg font-medium"
            >
              {isCreatingNew ? <div className="h-3.5 w-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              <span>Nouveau BL</span>
            </button>
            <button onClick={handleExportCSV} className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-border rounded-lg hover:bg-accent text-foreground">
              <Download className="h-3.5 w-3.5" /><span>CSV</span>
            </button>
            {selectedEligible.length > 0 && (
              <button
                onClick={() => setShowProformaModal(true)}
                className="flex items-center space-x-1.5 px-3 py-1.5 text-sm bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg"
              >
                <FileText className="h-3.5 w-3.5" />
                <span>Créer Proforma ({selectedEligible.length})</span>
              </button>
            )}
          </div>
        </div>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="N° BL, client, code..."
            className="w-full pl-8 pr-3 py-1.5 text-sm border border-input rounded-lg bg-secondary text-foreground"
          />
        </div>
      </div>

      <div className="glass rounded-xl shadow-lg overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            Aucun BL trouvé. Créez-en un depuis <Link to="/quotes-history" className="text-primary hover:underline">l'historique des devis</Link>.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-secondary">
                <tr>
                  <th className="px-3 py-2 w-8">
                    <button onClick={toggleAll} className="text-muted-foreground hover:text-foreground">
                      {eligibleCount > 0 && selectedEligible.length === eligibleCount
                        ? <CheckSquare className="h-3.5 w-3.5" />
                        : <Square className="h-3.5 w-3.5" />}
                    </button>
                  </th>
                  {['N° BL', 'Code', 'Client', 'Articles', 'Statut', 'Date', 'Actions'].map(h => (
                    <th key={h} className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map(bl => {
                  const isSelected = selectedIds.includes(bl.id);
                  const isFinal = bl.status === 'final';
                  return (
                    <tr key={bl.id} className={`hover:bg-accent/50 ${isSelected ? 'bg-accent/30' : ''}`}>
                      <td className="px-3 py-2.5">
                        <button
                          disabled={isFinal}
                          onClick={() => toggleRow(bl.id)}
                          className="text-primary disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          {isSelected ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5 text-muted-foreground" />}
                        </button>
                      </td>
                      <td className="px-3 py-2.5">
                        <Link to={`/compta/bls/${bl.id}`} className="text-xs font-mono font-semibold text-primary hover:underline">
                          {bl.quoteNumber}
                        </Link>
                      </td>
                      <td className="px-3 py-2.5">
                        {(() => { const c = (bl.customer as any)?.clientCode || (bl.customer as any)?.client_code || ''; return c ? <span className="text-[10px] font-mono bg-blue-500/10 text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded">{c}</span> : <span className="text-[10px] text-muted-foreground">—</span>; })()}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="text-xs font-medium text-foreground">{bl.customer?.fullName || '—'}</div>
                        {bl.customer?.phoneNumber && <div className="text-[10px] text-muted-foreground">{bl.customer.phoneNumber}</div>}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="text-xs text-muted-foreground">{bl.items.length} article{bl.items.length !== 1 ? 's' : ''}</span>
                      </td>
                      <td className="px-3 py-2.5">
                        {!bl.customer?.fullName?.trim()
                          ? <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-secondary text-muted-foreground border border-border">Brouillon vide</span>
                          : statusBadge(bl.status)}
                      </td>
                      <td className="px-3 py-2.5 text-[10px] text-muted-foreground">
                        {new Date(bl.createdAt).toLocaleDateString('fr-FR')}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center space-x-1">
                          <Link to={`/compta/bls/${bl.id}`} className="p-1 text-primary hover:bg-primary/10 rounded" title="Ouvrir">
                            <Truck className="h-3.5 w-3.5" />
                          </Link>
                          <button onClick={() => handleExportPdf(bl)} className="p-1 text-blue-500 hover:bg-blue-500/10 rounded" title="Export PDF">
                            <Download className="h-3.5 w-3.5" />
                          </button>
                          {!isFinal && (
                            <button
                              onClick={() => { setSingleProformaBL(bl); setTargetCompanyId(''); }}
                              className="p-1 text-emerald-600 hover:bg-emerald-600/10 rounded"
                              title="Créer Proforma"
                            >
                              <FileText className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {isSuperAdmin && (
                            <button onClick={() => handleDelete(bl.id, bl.quoteNumber)} className="p-1 text-destructive hover:bg-destructive/10 rounded" title="Supprimer">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Proforma modal — single BL or multi-select */}
      {(showProformaModal || singleProformaBL) && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-xl shadow-2xl max-w-md w-full p-5">
            <h2 className="text-base font-semibold text-foreground mb-1">Créer un Proforma</h2>
            <p className="text-xs text-muted-foreground mb-4">
              {singleProformaBL
                ? <>Depuis le BL <span className="font-mono font-semibold">{singleProformaBL.quoteNumber}</span></>
                : <>{selectedEligible.length} BL{selectedEligible.length > 1 ? 's' : ''} sélectionné{selectedEligible.length > 1 ? 's' : ''} — les articles seront fusionnés.</>
              }
            </p>

            <div className="mb-4">
              <label className="block text-xs font-medium text-foreground mb-1">Société cible *</label>
              <div className="relative">
                <Building2 className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <select
                  value={targetCompanyId}
                  onChange={e => setTargetCompanyId(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 text-sm border border-input rounded-lg bg-secondary text-foreground"
                >
                  <option value="">— Sélectionner —</option>
                  {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>

            <div className="flex space-x-2">
              <button
                onClick={() => { setShowProformaModal(false); setSingleProformaBL(null); setTargetCompanyId(''); }}
                className="flex-1 px-3 py-1.5 text-sm border border-input rounded-lg hover:bg-accent"
              >
                Annuler
              </button>
              <button
                onClick={handleConfirmProforma}
                disabled={!targetCompanyId || isCreating}
                className="flex-1 flex items-center justify-center space-x-1.5 px-3 py-1.5 text-sm bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg"
              >
                {isCreating
                  ? <><div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-white" /><span>Création...</span></>
                  : <><FileText className="h-3.5 w-3.5" /><span>Confirmer</span></>
                }
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

