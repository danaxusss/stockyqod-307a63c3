import React, { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Truck, Search, Download, Trash2, CheckSquare, Square, FileText, Building2, Loader } from 'lucide-react';
import { Quote, Company } from '../../types';
import { SupabaseDocumentsService } from '../../utils/supabaseDocuments';
import { SupabaseCompaniesService } from '../../utils/supabaseCompanies';
import { PdfExportService } from '../../utils/pdfExport';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../hooks/useAuth';

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
  const [targetCompanyId, setTargetCompanyId] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [creatingRowId, setCreatingRowId] = useState<string | null>(null);

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

  // Single-row shortcut: create proforma from one BL (pick company then confirm)
  const handleSingleProforma = async (bl: Quote) => {
    if (!targetCompanyId) return;
    setCreatingRowId(bl.id);
    try {
      const proforma = await SupabaseDocumentsService.createProformaFromBL(bl.id, targetCompanyId);
      showToast({ type: 'success', title: 'Proforma créé', message: `${proforma.quoteNumber} créé avec succès` });
      navigate(`/compta/proformas/${proforma.id}`);
    } catch (e) {
      showToast({ type: 'error', title: 'Erreur', message: String(e) });
    } finally {
      setCreatingRowId(null);
    }
  };

  // Multi-select: create proforma from selected BLs
  const handleMultiProforma = async () => {
    if (!targetCompanyId || selectedIds.length === 0) return;
    setIsCreating(true);
    try {
      const proforma = await SupabaseDocumentsService.createProformaFromBLs(selectedIds, targetCompanyId);
      showToast({ type: 'success', title: 'Proforma créé', message: `${proforma.quoteNumber} — ${selectedIds.length} BL(s) fusionnés` });
      setShowProformaModal(false);
      setSelectedIds([]);
      navigate(`/compta/proformas/${proforma.id}`);
    } catch (e) {
      showToast({ type: 'error', title: 'Erreur', message: String(e) });
    } finally {
      setIsCreating(false);
    }
  };

  const filtered = bls.filter(b => {
    const q = search.toLowerCase();
    return !q || b.quoteNumber.toLowerCase().includes(q)
      || b.customer?.fullName?.toLowerCase().includes(q)
      || b.customer?.phoneNumber?.toLowerCase().includes(q);
  });

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

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="N° BL, client..."
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
                  {['N° BL', 'Client', 'Articles', 'Statut', 'Date', 'Actions'].map(h => (
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
                        <div className="text-xs font-medium text-foreground">{bl.customer?.fullName || '—'}</div>
                        {bl.customer?.phoneNumber && <div className="text-[10px] text-muted-foreground">{bl.customer.phoneNumber}</div>}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="text-xs text-muted-foreground">{bl.items.length} article{bl.items.length !== 1 ? 's' : ''}</span>
                      </td>
                      <td className="px-3 py-2.5">{statusBadge(bl.status)}</td>
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
                            <SingleProformaButton
                              bl={bl}
                              companies={companies}
                              isCreating={creatingRowId === bl.id}
                              onConfirm={async (companyId) => {
                                setCreatingRowId(bl.id);
                                try {
                                  const p = await SupabaseDocumentsService.createProformaFromBL(bl.id, companyId);
                                  showToast({ type: 'success', title: 'Proforma créé', message: p.quoteNumber });
                                  navigate(`/compta/proformas/${p.id}`);
                                } catch (e) {
                                  showToast({ type: 'error', title: 'Erreur', message: String(e) });
                                } finally {
                                  setCreatingRowId(null);
                                }
                              }}
                            />
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

      {/* Multi-select Proforma modal */}
      {showProformaModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-xl shadow-2xl max-w-md w-full p-5">
            <h2 className="text-base font-semibold text-foreground mb-1">Créer un Proforma</h2>
            <p className="text-xs text-muted-foreground mb-4">
              {selectedEligible.length} BL{selectedEligible.length > 1 ? 's' : ''} sélectionné{selectedEligible.length > 1 ? 's' : ''} — les articles seront fusionnés.
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
              <button onClick={() => setShowProformaModal(false)} className="flex-1 px-3 py-1.5 text-sm border border-input rounded-lg hover:bg-accent">
                Annuler
              </button>
              <button
                onClick={handleMultiProforma}
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

// Inline per-row "→ Proforma" button with company picker popover
function SingleProformaButton({ bl, companies, isCreating, onConfirm }: {
  bl: Quote;
  companies: Company[];
  isCreating: boolean;
  onConfirm: (companyId: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [companyId, setCompanyId] = useState('');

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        disabled={isCreating}
        className="p-1 text-emerald-600 hover:bg-emerald-600/10 rounded disabled:opacity-40"
        title="Créer Proforma"
      >
        {isCreating ? <Loader className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
      </button>

      {open && (
        <div className="absolute right-0 top-7 z-20 bg-card border border-border rounded-lg shadow-xl p-3 w-52">
          <p className="text-[10px] text-muted-foreground mb-2">Société cible pour {bl.quoteNumber}</p>
          <select
            value={companyId}
            onChange={e => setCompanyId(e.target.value)}
            className="w-full px-2 py-1 text-xs border border-input rounded bg-secondary text-foreground mb-2"
          >
            <option value="">— Société —</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <div className="flex gap-1.5">
            <button onClick={() => setOpen(false)} className="flex-1 px-2 py-1 text-xs border border-input rounded hover:bg-accent">
              ✕
            </button>
            <button
              disabled={!companyId}
              onClick={async () => { setOpen(false); await onConfirm(companyId); }}
              className="flex-1 px-2 py-1 text-xs bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white rounded"
            >
              Créer
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
