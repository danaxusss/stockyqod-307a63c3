import React, { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FileText, Search, Download, Trash2, ChevronUp, ChevronDown, Plus } from 'lucide-react';
import { Quote } from '../../types';
import { SupabaseDocumentsService } from '../../utils/supabaseDocuments';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../hooks/useAuth';
import { getCompanyContext } from '../../utils/supabaseCompanyFilter';
import { PdfExportService } from '../../utils/pdfExport';
import { SupabaseCompaniesService } from '../../utils/supabaseCompanies';
import { exportToCSV } from '../../utils/csvExport';

type SortKey = 'date' | 'total' | 'remaining';

function statusBadge(status: string) {
  if (status === 'solde') return <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-300">Soldé</span>;
  if (status === 'final') return <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300">Finalisé</span>;
  return <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300">En cours</span>;
}

function fmt(n: number) {
  return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2 }).format(n);
}

export default function ProformaDirectoryPage() {
  const { isSuperAdmin, isCompta } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [proformas, setProformas] = useState<Quote[]>([]);
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([]);
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'encours' | 'solde'>('all');
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortAsc, setSortAsc] = useState(false);
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [data, allCo] = await Promise.all([
        SupabaseDocumentsService.getAllByType('proforma'),
        SupabaseCompaniesService.getAllCompanies(),
      ]);
      setProformas(data);
      setCompanies(allCo.map(c => ({ id: c.id, name: c.name })));
    } catch (e) {
      showToast({ type: 'error', title: 'Erreur', message: String(e) });
    } finally {
      setIsLoading(false);
    }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  const handleNewProforma = async () => {
    const { companyId: ctxId } = getCompanyContext();
    const compId = ctxId || companies[0]?.id;
    if (!compId) { showToast({ type: 'error', message: 'Aucune société disponible' }); return; }
    setIsCreatingNew(true);
    try {
      const doc = await SupabaseDocumentsService.createEmptyDocument('proforma', compId);
      navigate(`/compta/proformas/${doc.id}?new=1`);
    } catch (e) {
      showToast({ type: 'error', message: String(e) });
    } finally {
      setIsCreatingNew(false);
    }
  };

  const handleDelete = async (id: string, num: string) => {
    if (!window.confirm(`Supprimer le proforma ${num} ? Action irréversible.`)) return;
    try {
      await SupabaseDocumentsService.deleteDocument(id);
      showToast({ type: 'success', message: `${num} supprimé` });
      await load();
    } catch (e) {
      showToast({ type: 'error', title: 'Erreur', message: String(e) });
    }
  };

  const handleExportPdf = async (proforma: Quote) => {
    try {
      const company = proforma.issuing_company_id || proforma.company_id
        ? await SupabaseCompaniesService.getCompanyById((proforma.issuing_company_id || proforma.company_id)!)
        : null;
      const settings = company ? {
        company_name: company.name, address: company.address, phone: company.phone,
        phone2: company.phone2, email: company.email, website: company.website,
        ice: company.ice, rc: company.rc, if_number: company.if_number,
        cnss: company.cnss, patente: company.patente, logo_url: company.logo_url,
        logo_size: company.logo_size, accent_color: company.accent_color,
        font_family: company.font_family, tva_rate: company.tva_rate,
        quote_validity_days: company.quote_validity_days,
        payment_terms: company.payment_terms,
        share_templates: company.share_templates,
        quote_visible_fields: company.quote_visible_fields,
        quote_style: { accentColor: company.accent_color, fontFamily: company.font_family, showBorders: true, borderRadius: 1, headerSize: 'large', totalsStyle: 'highlighted' },
      } as any : null;
      await PdfExportService.exportQuoteToPdf(proforma, settings, undefined, undefined, undefined, 'proforma');
    } catch (e) {
      showToast({ type: 'error', title: 'Erreur PDF', message: String(e) });
    }
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(v => !v);
    else { setSortKey(key); setSortAsc(false); }
  };

  const filtered = proformas
    .filter(p => {
      const q = search.toLowerCase();
      const clientCode = ((p.customer as any)?.clientCode || (p.customer as any)?.client_code || '').toLowerCase();
      const matchSearch = !q || p.quoteNumber.toLowerCase().includes(q)
        || p.customer?.fullName?.toLowerCase().includes(q)
        || p.customer?.phoneNumber?.toLowerCase().includes(q)
        || clientCode.includes(q);
      const remaining = p.totalAmount - (p.paid_amount || 0);
      const matchStatus =
        filterStatus === 'all' ||
        (filterStatus === 'solde' && p.status === 'solde') ||
        (filterStatus === 'encours' && p.status !== 'solde');
      return matchSearch && matchStatus;
    })
    .sort((a, b) => {
      let diff = 0;
      if (sortKey === 'date') diff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      else if (sortKey === 'total') diff = a.totalAmount - b.totalAmount;
      else if (sortKey === 'remaining') diff = (a.totalAmount - (a.paid_amount || 0)) - (b.totalAmount - (b.paid_amount || 0));
      return sortAsc ? diff : -diff;
    });

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize);

  if (!isSuperAdmin && !isCompta) {
    return <div className="text-center py-12 text-muted-foreground">Accès réservé au rôle Comptabilité.</div>;
  }

  const SortIcon = ({ k }: { k: SortKey }) => sortKey === k
    ? (sortAsc ? <ChevronUp className="h-3 w-3 inline" /> : <ChevronDown className="h-3 w-3 inline" />)
    : null;

  return (
    <div className="space-y-4">
      <div className="glass rounded-xl shadow-lg p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 bg-emerald-600 rounded-lg">
              <FileText className="h-4 w-4 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground">Proformas</h1>
              <p className="text-xs text-muted-foreground">{filtered.length} document{filtered.length !== 1 ? 's' : ''}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleNewProforma}
              disabled={isCreatingNew}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" /><span>{isCreatingNew ? '...' : 'Nouveau proforma'}</span>
            </button>
            <button
              onClick={() => {
                const rows = filtered.map(p => ({
                  'N° Proforma': p.quoteNumber,
                  'Client': p.customer?.fullName || '',
                  'Téléphone': p.customer?.phoneNumber || '',
                  'Total TTC': p.totalAmount,
                  'Payé': p.paid_amount || 0,
                  'Reste': p.totalAmount - (p.paid_amount || 0),
                  'Statut': p.status,
                  'Date': new Date(p.createdAt).toLocaleDateString('fr-FR'),
                }));
                exportToCSV(rows, `proformas-${new Date().toISOString().slice(0, 10)}`);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-border rounded-lg hover:bg-accent text-foreground"
            >
              <Download className="h-3.5 w-3.5" /><span>CSV</span>
            </button>
          </div>
        </div>

        <div className="flex gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[150px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="N° proforma, client, code..."
              className="w-full pl-8 pr-3 py-1.5 text-sm border border-input rounded-lg bg-secondary text-foreground"
            />
          </div>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as any)}
            className="px-2.5 py-1.5 text-sm border border-input rounded-lg bg-secondary text-foreground">
            <option value="all">Tous statuts</option>
            <option value="encours">En cours</option>
            <option value="solde">Soldés</option>
          </select>
        </div>
      </div>

      <div className="glass rounded-xl shadow-lg overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Aucun proforma trouvé</div>
        ) : (
          <>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-secondary">
                <tr>
                  <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase">N° Proforma</th>
                  <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase">Code</th>
                  <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase">Client</th>
                  <th className="px-3 py-2 text-right text-[11px] font-medium text-muted-foreground uppercase cursor-pointer" onClick={() => handleSort('total')}>
                    Total TTC <SortIcon k="total" />
                  </th>
                  <th className="px-3 py-2 text-right text-[11px] font-medium text-muted-foreground uppercase">Payé</th>
                  <th className="px-3 py-2 text-right text-[11px] font-medium text-muted-foreground uppercase cursor-pointer" onClick={() => handleSort('remaining')}>
                    Reste <SortIcon k="remaining" />
                  </th>
                  <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase">Statut</th>
                  <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase cursor-pointer" onClick={() => handleSort('date')}>
                    Date <SortIcon k="date" />
                  </th>
                  <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {paginated.map(p => {
                  const remaining = p.totalAmount - (p.paid_amount || 0);
                  return (
                    <tr key={p.id} className="hover:bg-accent/50">
                      <td className="px-3 py-2.5">
                        <Link to={`/compta/proformas/${p.id}`} className="text-xs font-mono font-semibold text-primary hover:underline">
                          {p.quoteNumber}
                        </Link>
                      </td>
                      <td className="px-3 py-2.5">
                        {(() => { const c = (p.customer as any)?.clientCode || (p.customer as any)?.client_code || ''; return c ? <span className="text-[10px] font-mono bg-blue-500/10 text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded">{c}</span> : <span className="text-[10px] text-muted-foreground">—</span>; })()}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="text-xs font-medium text-foreground">{p.customer?.fullName || '—'}</div>
                        {p.customer?.phoneNumber && <div className="text-[10px] text-muted-foreground">{p.customer.phoneNumber}</div>}
                      </td>
                      <td className="px-3 py-2.5 text-right text-xs font-mono text-foreground">{fmt(p.totalAmount)} Dh</td>
                      <td className="px-3 py-2.5 text-right text-xs font-mono text-emerald-600">{fmt(p.paid_amount || 0)} Dh</td>
                      <td className="px-3 py-2.5 text-right text-xs font-mono font-bold text-destructive">{fmt(remaining)} Dh</td>
                      <td className="px-3 py-2.5">
                        {!p.customer?.fullName?.trim()
                          ? <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-secondary text-muted-foreground border border-border">Brouillon vide</span>
                          : statusBadge(p.status)}
                      </td>
                      <td className="px-3 py-2.5 text-[10px] text-muted-foreground">
                        {new Date(p.createdAt).toLocaleDateString('fr-FR')}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center space-x-1">
                          <Link to={`/compta/proformas/${p.id}`} className="p-1 text-primary hover:bg-primary/10 rounded" title="Ouvrir">
                            <FileText className="h-3.5 w-3.5" />
                          </Link>
                          <button onClick={() => handleExportPdf(p)} className="p-1 text-blue-500 hover:bg-blue-500/10 rounded" title="Export PDF">
                            <Download className="h-3.5 w-3.5" />
                          </button>
                          {isSuperAdmin && (
                            <button onClick={() => handleDelete(p.id, p.quoteNumber)} className="p-1 text-destructive hover:bg-destructive/10 rounded" title="Supprimer">
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
          <div className="px-4 py-2.5 border-t border-border flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Afficher</span>
              <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }} className="px-2 py-1 text-xs border border-input rounded bg-background text-foreground">
                {[20, 30, 50].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
              <span className="text-xs text-muted-foreground">/ {filtered.length}</span>
            </div>
            {totalPages > 1 && (
              <div className="flex items-center gap-1.5">
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-2 py-1 text-xs border border-border rounded hover:bg-accent disabled:opacity-50">Préc.</button>
                <span className="px-2 text-xs text-muted-foreground">{page}/{totalPages}</span>
                <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="px-2 py-1 text-xs border border-border rounded hover:bg-accent disabled:opacity-50">Suiv.</button>
              </div>
            )}
          </div>
          </>
        )}
      </div>
    </div>
  );
}
