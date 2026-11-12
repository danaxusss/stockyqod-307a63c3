import React, { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Truck, Search, Download, Trash2, CheckSquare, Square, FileText, Building2, Plus, ClipboardList, Loader } from 'lucide-react';
import { Quote, Company } from '../../types';
import { SupabaseDocumentsService } from '../../utils/supabaseDocuments';
import { SupabaseCompaniesService } from '../../utils/supabaseCompanies';
import { PdfExportService } from '../../utils/pdfExport';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../hooks/useAuth';
import { exportToCSV } from '../../utils/csvExport';
import { getCompanyContext } from '../../utils/supabaseCompanyFilter';
import { documentDay, formatDay } from '../../utils/documentLines';
import { formatMoney } from '../../utils/format';
import { useIsMobile } from '../../hooks/use-mobile';
import { PageHeader } from '../../components/PageHeader';
import { RowMenu } from '../../components/lists/RowMenu';
import { StatusPill } from '../../components/lists/StatusPill';
import { DocumentCard } from '../../components/lists/DocumentCard';

/** Delivery note status, as shown in the list. */
function BLStatus({ bl }: { bl: Quote }) {
  if (!bl.customer?.fullName?.trim()) return <StatusPill tone="neutral">Brouillon vide</StatusPill>;
  if (bl.status === 'final') return <StatusPill tone="info">Finalisé</StatusPill>;
  return <StatusPill tone="warning">Brouillon</StatusPill>;
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
  const [creatingBcFor, setCreatingBcFor] = useState<string | null>(null);
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(1);
  // Phones get cards instead of the wide table.
  const isMobile = useIsMobile();

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

  const handleCreateBC = async (blId: string) => {
    setCreatingBcFor(blId);
    try {
      const bc = await SupabaseDocumentsService.createBCFromBL(blId);
      navigate(`/compta/bons-commande/${bc.id}`);
    } catch (e) {
      showToast({ type: 'error', title: 'Erreur', message: String(e) });
    } finally {
      setCreatingBcFor(null);
    }
  };

  const handleNewBL = async () => {
    // Same company as the other "Nouveau" buttons: the user's own.
    const compId = getCompanyContext().companyId || companies[0]?.id;
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
    // Only BLs the user can see in the list: a search may hide earlier ticks.
    const ids = singleProformaBL ? [singleProformaBL.id] : selectedEligible;
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
      'Date': formatDay(documentDay(b)),
    }));
    exportToCSV(rows, `bls-${new Date().toISOString().slice(0, 10)}`);
  };

  const eligibleCount = filtered.filter(b => b.status !== 'final').length;
  const selectedEligible = selectedIds.filter(id => filtered.find(b => b.id === id && b.status !== 'final'));
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize);

  if (!isSuperAdmin && !isCompta) {
    return <div className="text-center py-12 text-muted-foreground">Accès réservé au rôle Comptabilité.</div>;
  }

  const menuItems = (bl: Quote) => [
    { label: 'Télécharger le PDF', icon: <Download className="h-4 w-4 text-muted-foreground" />, onSelect: () => handleExportPdf(bl) },
    ...(bl.status !== 'final' ? [{ label: 'Créer un proforma', icon: <FileText className="h-4 w-4 text-emerald-600" />, onSelect: () => { setSingleProformaBL(bl); setTargetCompanyId(''); } }] : []),
    { label: 'Créer un bon de commande', icon: creatingBcFor === bl.id ? <Loader className="h-4 w-4 animate-spin" /> : <ClipboardList className="h-4 w-4 text-orange-500" />, onSelect: () => handleCreateBC(bl.id), disabled: creatingBcFor === bl.id },
    ...(isSuperAdmin ? [{ label: 'Supprimer', icon: <Trash2 className="h-4 w-4" />, onSelect: () => handleDelete(bl.id, bl.quoteNumber), danger: true, separated: true }] : []),
  ];
  const clientCodeOf = (bl: Quote) => (bl.customer as any)?.clientCode || (bl.customer as any)?.client_code || '';
  const selectBox = (bl: Quote, size = 'h-4 w-4') => {
    const isSelected = selectedIds.includes(bl.id);
    return (
      <button disabled={bl.status === 'final'} onClick={() => toggleRow(bl.id)} aria-pressed={isSelected}
        aria-label={`Sélectionner ${bl.quoteNumber}`} title={bl.status === 'final' ? 'BL finalisé' : undefined}
        className="text-primary disabled:cursor-not-allowed disabled:opacity-30">
        {isSelected ? <CheckSquare className={size} /> : <Square className={`${size} text-muted-foreground`} />}
      </button>
    );
  };
  const th = 'px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground';

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <PageHeader
        title="Bons de livraison"
        subtitle={`${filtered.length} BL${filtered.length !== 1 ? 's' : ''}`}
        actions={<>
          {selectedEligible.length > 0 && (
            <button onClick={() => setShowProformaModal(true)}
              className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700">
              <FileText className="h-4 w-4" />Créer un proforma ({selectedEligible.length})
            </button>
          )}
          <button onClick={handleExportCSV} className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-secondary">
            <Download className="h-4 w-4" />CSV
          </button>
          <button onClick={handleNewBL} disabled={isCreatingNew}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            {isCreatingNew ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" /> : <Plus className="h-4 w-4" />}
            Nouveau BL
          </button>
        </>}
      >
        <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} aria-label="Rechercher un BL"
              placeholder="N° BL, client, téléphone, code…"
              className="w-full rounded-lg border border-input bg-background py-2 pl-9 pr-3 text-sm text-foreground focus:ring-2 focus:ring-ring" />
          </div>
        </div>
      </PageHeader>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        {isLoading ? (
          <div className="p-8 text-center">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            Aucun BL trouvé. Créez-en un depuis <Link to="/quotes-history" className="text-primary hover:underline">l'historique des devis</Link>.
          </div>
        ) : (
          <>
          {isMobile ? (
            <ul className="divide-y divide-border">
              {paginated.map(bl => (
                <DocumentCard key={bl.id} to={`/compta/bls/${bl.id}`}
                  leading={selectBox(bl, 'h-5 w-5')}
                  number={bl.quoteNumber}
                  status={<BLStatus bl={bl} />}
                  title={bl.customer?.fullName || '—'}
                  subtitle={[clientCodeOf(bl), bl.customer?.phoneNumber, `${bl.items.length} article${bl.items.length !== 1 ? 's' : ''}`].filter(Boolean).join(' · ')}
                  date={formatDay(documentDay(bl))}
                  amount={formatMoney(bl.totalAmount)}
                  menu={<RowMenu label={`Actions pour ${bl.quoteNumber}`} items={menuItems(bl)} />}
                />
              ))}
            </ul>
          ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-secondary/40">
                <tr>
                  <th className="w-8 px-3 py-2">
                    <button onClick={toggleAll} aria-label="Sélectionner les BL non finalisés" className="text-muted-foreground hover:text-foreground">
                      {eligibleCount > 0 && selectedEligible.length === eligibleCount
                        ? <CheckSquare className="h-4 w-4" />
                        : <Square className="h-4 w-4" />}
                    </button>
                  </th>
                  <th className={`${th} text-left`}>N° BL</th>
                  <th className={`${th} text-left`}>Client</th>
                  <th className={`${th} text-right`}>Articles</th>
                  <th className={`${th} text-right`}>Montant TTC</th>
                  <th className={`${th} text-left`}>Statut</th>
                  <th className={`${th} text-left`}>Date</th>
                  <th className={th}><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {paginated.map(bl => {
                  const isSelected = selectedIds.includes(bl.id);
                  return (
                    <tr key={bl.id} className={`cursor-pointer hover:bg-secondary/60 ${isSelected ? 'bg-primary/5' : ''}`}
                      onClick={event => { if (!(event.target as HTMLElement).closest('a,button,[role="menu"]')) navigate(`/compta/bls/${bl.id}`); }}>
                      <td className="px-3 py-2.5">{selectBox(bl)}</td>
                      <td className="whitespace-nowrap px-3 py-2.5">
                        <Link to={`/compta/bls/${bl.id}`} className="font-mono font-semibold text-primary hover:underline">{bl.quoteNumber}</Link>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="font-medium text-foreground">{bl.customer?.fullName || '—'}</div>
                        <div className="text-xs text-muted-foreground">{[clientCodeOf(bl), bl.customer?.phoneNumber].filter(Boolean).join(' · ')}</div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-muted-foreground">{bl.items.length}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums text-foreground">{formatMoney(bl.totalAmount)}</td>
                      <td className="px-3 py-2.5"><BLStatus bl={bl} /></td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">{formatDay(documentDay(bl))}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => handleExportPdf(bl)} title="Télécharger le PDF" aria-label={`PDF de ${bl.quoteNumber}`}
                            className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground">
                            <Truck className="h-4 w-4" />
                          </button>
                          <RowMenu label={`Actions pour ${bl.quoteNumber}`} items={menuItems(bl).slice(1)} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border px-4 py-2.5">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Afficher</span>
              <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }} aria-label="BL par page" className="rounded border border-input bg-background px-2 py-1 text-xs text-foreground">
                {[20, 30, 50].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
              <span>/ {filtered.length}</span>
            </div>
            {totalPages > 1 && (
              <div className="flex items-center gap-1.5">
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="rounded-lg border border-border px-2.5 py-1 text-xs hover:bg-secondary disabled:opacity-50">Préc.</button>
                <span className="px-2 text-xs text-muted-foreground">{page}/{totalPages}</span>
                <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="rounded-lg border border-border px-2.5 py-1 text-xs hover:bg-secondary disabled:opacity-50">Suiv.</button>
              </div>
            )}
          </div>
          </>
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
                className="flex-1 px-3 py-1.5 text-sm border border-input rounded-lg hover:bg-secondary"
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

