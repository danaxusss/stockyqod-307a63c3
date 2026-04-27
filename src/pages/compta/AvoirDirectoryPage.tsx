import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FileX, Search, Download, Trash2, Plus, X, Loader } from 'lucide-react';
import { Quote, Company } from '../../types';
import { SupabaseDocumentsService } from '../../utils/supabaseDocuments';
import { CompanySettingsService } from '../../utils/companySettings';
import { SupabaseCompaniesService } from '../../utils/supabaseCompanies';
import { PdfExportService } from '../../utils/pdfExport';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../hooks/useAuth';
import { useEscapeKey } from '../../hooks/useShortcuts';

function fmt(n: number) {
  return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2 }).format(n);
}

export default function AvoirDirectoryPage() {
  const { isSuperAdmin, isCompta, companyId: authCompanyId } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [avoirs, setAvoirs] = useState<Quote[]>([]);
  const [allCompanyList, setAllCompanyList] = useState<Company[]>([]);
  const [companies, setCompanies] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [companyFilter, setCompanyFilter] = useState('');
  const [sortField, setSortField] = useState<'date' | 'number' | 'amount' | 'client'>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(1);

  // New avoir modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState({ companyId: '', customerName: '', customerPhone: '', totalAmount: '', reason: '' });
  const [isCreating, setIsCreating] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [data, allCompanies] = await Promise.all([
        SupabaseDocumentsService.getAllByType('avoir'),
        SupabaseCompaniesService.getAllCompanies(),
      ]);
      setAvoirs(data);
      setAllCompanyList(allCompanies);
      const map: Record<string, string> = {};
      allCompanies.forEach(c => { map[c.id] = c.name; });
      setCompanies(map);
    } catch (e) {
      showToast({ type: 'error', title: 'Erreur', message: String(e) });
    } finally {
      setIsLoading(false);
    }
  }, [showToast]);

  const openCreateModal = () => {
    setCreateForm({ companyId: authCompanyId || '', customerName: '', customerPhone: '', totalAmount: '', reason: '' });
    setShowCreateModal(true);
  };

  const handleCreate = async () => {
    if (!createForm.companyId) { showToast({ type: 'error', message: 'Sélectionnez une société' }); return; }
    if (!createForm.customerName.trim()) { showToast({ type: 'error', message: 'Nom du client requis' }); return; }
    const amount = parseFloat(createForm.totalAmount);
    if (isNaN(amount) || amount <= 0) { showToast({ type: 'error', message: 'Montant invalide' }); return; }
    setIsCreating(true);
    try {
      const avoir = await SupabaseDocumentsService.createAvoirStandalone({
        companyId: createForm.companyId,
        customerName: createForm.customerName.trim(),
        customerPhone: createForm.customerPhone.trim() || undefined,
        totalAmount: amount,
        reason: createForm.reason.trim() || undefined,
      });
      setShowCreateModal(false);
      await load();
      navigate(`/compta/avoirs/${avoir.id}`);
    } catch (e: any) {
      showToast({ type: 'error', message: e?.message || 'Erreur création avoir' });
    } finally {
      setIsCreating(false);
    }
  };

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = avoirs.filter(a => {
      if (companyFilter && (a.issuing_company_id || a.company_id) !== companyFilter) return false;
      if (!q) return true;
      const clientCode = ((a.customer as any)?.clientCode || (a.customer as any)?.client_code || '').toLowerCase();
      return (
        a.quoteNumber.toLowerCase().includes(q) ||
        (a.customer?.fullName || '').toLowerCase().includes(q) ||
        clientCode.includes(q)
      );
    });
    list = [...list].sort((a, b) => {
      let cmp = 0;
      if (sortField === 'date') cmp = new Date(a.quote_date || a.createdAt).getTime() - new Date(b.quote_date || b.createdAt).getTime();
      else if (sortField === 'number') cmp = a.quoteNumber.localeCompare(b.quoteNumber);
      else if (sortField === 'amount') cmp = a.totalAmount - b.totalAmount;
      else if (sortField === 'client') cmp = (a.customer?.fullName || '').localeCompare(b.customer?.fullName || '');
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [avoirs, search, companyFilter, sortField, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize);

  const handleExportPdf = async (av: Quote) => {
    try {
      const compId = av.issuing_company_id || av.company_id;
      const settings = compId ? await CompanySettingsService.getSettings(compId).catch(() => null) : null;
      const companySettings = settings || (compId ? await (async () => {
        const c = await SupabaseCompaniesService.getCompanyById(compId);
        return c ? { company_name: c.name, address: c.address, phone: c.phone, email: c.email, ice: c.ice } as any : null;
      })() : null);
      await PdfExportService.exportQuoteToPdf(av, companySettings, undefined, undefined, undefined, 'avoir');
    } catch (e) {
      showToast({ type: 'error', title: 'Erreur PDF', message: String(e) });
    }
  };

  const handleDelete = async (av: Quote) => {
    if (!window.confirm(`Supprimer l'avoir ${av.quoteNumber} ?`)) return;
    try {
      await SupabaseDocumentsService.deleteDocument(av.id);
      showToast({ type: 'success', message: 'Avoir supprimé' });
      await load();
    } catch (e: any) {
      showToast({ type: 'error', message: e?.message || 'Erreur suppression' });
    }
  };

  useEscapeKey(() => setShowCreateModal(false), showCreateModal);

  const toggleSort = (field: typeof sortField) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
  };
  const SortIcon = ({ field }: { field: typeof sortField }) => {
    if (sortField !== field) return <span className="ml-0.5 opacity-30">↕</span>;
    return sortDir === 'asc' ? <span className="ml-0.5">↑</span> : <span className="ml-0.5">↓</span>;
  };

  if (!isSuperAdmin && !isCompta) {
    return <div className="text-center py-12 text-muted-foreground">Accès réservé au rôle Comptabilité.</div>;
  }

  return (
    <div className="max-w-7xl mx-auto space-y-4">
      <div className="glass rounded-xl shadow-lg p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 bg-violet-600 rounded-lg">
              <FileX className="h-4 w-4 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground">Avoirs</h1>
              <p className="text-xs text-muted-foreground">{filtered.length} avoir{filtered.length !== 1 ? 's' : ''}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input type="text" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
                placeholder="Rechercher..."
                className="pl-8 pr-3 py-1.5 text-sm border border-input rounded-lg bg-background text-foreground focus:ring-2 focus:ring-ring w-48" />
            </div>
            {isSuperAdmin && (
              <select value={companyFilter} onChange={e => { setCompanyFilter(e.target.value); setPage(1); }}
                className="px-2 py-1.5 text-sm border border-input rounded-lg bg-background text-foreground focus:ring-2 focus:ring-ring">
                <option value="">Toutes sociétés</option>
                {allCompanyList.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
            <button onClick={openCreateModal}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-violet-600 hover:bg-violet-700 text-white rounded-lg transition-colors">
              <Plus className="h-3.5 w-3.5" /><span>Nouvel avoir</span>
            </button>
          </div>
        </div>
      </div>

      <div className="glass rounded-xl shadow-lg overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary mx-auto" /></div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            <FileX className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">Aucun avoir</p>
          </div>
        ) : (
          <>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-secondary/50">
                <tr>
                  <th onClick={() => toggleSort('number')} className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase cursor-pointer hover:text-foreground select-none">N° Avoir<SortIcon field="number" /></th>
                  <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase">Code</th>
                  <th onClick={() => toggleSort('client')} className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase cursor-pointer hover:text-foreground select-none">Client<SortIcon field="client" /></th>
                  <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase">Société</th>
                  <th onClick={() => toggleSort('amount')} className="px-3 py-2 text-right text-[11px] font-medium text-muted-foreground uppercase cursor-pointer hover:text-foreground select-none">Montant<SortIcon field="amount" /></th>
                  <th onClick={() => toggleSort('date')} className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase cursor-pointer hover:text-foreground select-none">Date<SortIcon field="date" /></th>
                  <th className="px-3 py-2 text-right text-[11px] font-medium text-muted-foreground uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {paginated.map(av => (
                  <tr key={av.id} className="hover:bg-accent/30 transition-colors">
                    <td className="px-3 py-2.5">
                      <Link to={`/compta/avoirs/${av.id}`} className="text-xs font-mono font-semibold text-violet-600 dark:text-violet-400 hover:underline">{av.quoteNumber}</Link>
                    </td>
                    <td className="px-3 py-2.5">
                      {(() => { const c = (av.customer as any)?.clientCode || (av.customer as any)?.client_code || ''; return c ? <span className="text-[10px] font-mono bg-blue-500/10 text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded">{c}</span> : <span className="text-[10px] text-muted-foreground">—</span>; })()}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="text-xs font-medium text-foreground">{av.customer?.fullName || '—'}</div>
                      {av.customer?.phoneNumber && <div className="text-[10px] text-muted-foreground">{av.customer.phoneNumber}</div>}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="text-xs text-muted-foreground">{(av.issuing_company_id && companies[av.issuing_company_id]) || '—'}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <span className="text-sm font-mono font-bold text-foreground">{fmt(av.totalAmount)} Dh</span>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">
                      {new Date(av.createdAt).toLocaleDateString('fr-FR')}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => handleExportPdf(av)} className="p-1.5 text-blue-600 dark:text-blue-400 hover:bg-blue-500/10 rounded" title="Télécharger PDF">
                          <Download className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => handleDelete(av)} className="p-1.5 text-destructive hover:bg-destructive/10 rounded" title="Supprimer">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
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
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="glass rounded-xl shadow-2xl w-full max-w-md p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-foreground flex items-center gap-2">
                <FileX className="h-4 w-4 text-violet-500" />Nouvel avoir
              </h2>
              <button onClick={() => setShowCreateModal(false)} className="p-1 rounded hover:bg-secondary text-muted-foreground"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-3">
              {isSuperAdmin && (
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">Société *</label>
                  <select value={createForm.companyId} onChange={e => setCreateForm(f => ({ ...f, companyId: e.target.value }))}
                    className="w-full px-3 py-1.5 text-sm border border-input rounded-lg bg-background text-foreground focus:ring-1 focus:ring-primary">
                    <option value="">-- Sélectionner --</option>
                    {allCompanyList.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">Client *</label>
                  <input value={createForm.customerName} onChange={e => setCreateForm(f => ({ ...f, customerName: e.target.value }))}
                    className="w-full px-3 py-1.5 text-sm border border-input rounded-lg bg-background text-foreground focus:ring-1 focus:ring-primary"
                    placeholder="Nom du client" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">Téléphone</label>
                  <input value={createForm.customerPhone} onChange={e => setCreateForm(f => ({ ...f, customerPhone: e.target.value }))}
                    className="w-full px-3 py-1.5 text-sm border border-input rounded-lg bg-background text-foreground focus:ring-1 focus:ring-primary"
                    placeholder="0600000000" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">Montant TTC (Dh) *</label>
                <input type="number" min="0" step="0.01" value={createForm.totalAmount} onChange={e => setCreateForm(f => ({ ...f, totalAmount: e.target.value }))}
                  className="w-full px-3 py-1.5 text-sm border border-input rounded-lg bg-background text-foreground focus:ring-1 focus:ring-primary"
                  placeholder="0.00" />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">Motif</label>
                <input value={createForm.reason} onChange={e => setCreateForm(f => ({ ...f, reason: e.target.value }))}
                  className="w-full px-3 py-1.5 text-sm border border-input rounded-lg bg-background text-foreground focus:ring-1 focus:ring-primary"
                  placeholder="Ex: Retour produit, remise accordée..." />
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={() => setShowCreateModal(false)}
                className="flex-1 px-3 py-2 text-sm border border-input rounded-lg hover:bg-accent text-foreground">Annuler</button>
              <button onClick={handleCreate} disabled={isCreating}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-sm bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white rounded-lg">
                {isCreating ? <Loader className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                <span>{isCreating ? 'Création...' : 'Créer l\'avoir'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
