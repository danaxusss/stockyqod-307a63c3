import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { Receipt, Search, Download, Trash2, ChevronUp, ChevronDown, X, Eye, Printer, MessageCircle, Mail, Copy, Lock, CheckCircle, Clock, AlertCircle, Plus } from 'lucide-react';
import { Quote, PaymentEntry } from '../../types';
import { SupabaseDocumentsService } from '../../utils/supabaseDocuments';
import { SupabaseCompaniesService } from '../../utils/supabaseCompanies';
import { SupabaseClientsService } from '../../utils/supabaseClients';
import { CompanySettingsService } from '../../utils/companySettings';
import { PdfExportService } from '../../utils/pdfExport';
import { PrintPreviewModal } from '../../components/PrintPreviewModal';
import { buildWhatsAppShareUrl, openWhatsAppShare } from '../../utils/whatsappShare';
import { SupabaseUsersService } from '../../utils/supabaseUsers';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../hooks/useAuth';
import { getCompanyContext } from '../../utils/supabaseCompanyFilter';
import { exportToCSV } from '../../utils/csvExport';

function fmt(n: number) {
  return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2 }).format(n);
}

function computePayment(inv: Quote) {
  const avance = inv.avance_amount || 0;
  const paid = avance + (inv.payment_methods_json || []).reduce((s, e) => s + (e.amount || 0), 0);
  const reste = Math.max(0, inv.totalAmount - paid);
  const status: 'paid' | 'partial' | 'unpaid' =
    reste <= 0 && paid > 0 ? 'paid' :
    paid > 0 ? 'partial' : 'unpaid';
  return { avance, paid, reste, status };
}

type SortField = 'quoteNumber' | 'customer' | 'date' | 'total' | 'reste';
type SortDir = 'asc' | 'desc';

const PAYMENT_METHODS = ['Tous', 'Virement', 'Chèque', 'Espèces', 'Carte', 'Effet', 'Versement'];

export default function InvoiceDirectoryPage() {
  const { isSuperAdmin, isCompta } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [invoices, setInvoices] = useState<Quote[]>([]);
  const [companies, setCompanies] = useState<Record<string, string>>({});
  const [companyList, setCompanyList] = useState<{ id: string; name: string }[]>([]);
  const [proformaNumbers, setProformaNumbers] = useState<Record<string, string>>({});
  const [isCreating, setIsCreating] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [filterPayment, setFilterPayment] = useState('Tous');
  const [filterCompany, setFilterCompany] = useState('');
  const [filterPayStatus, setFilterPayStatus] = useState<'all' | 'paid' | 'partial' | 'unpaid'>('all');

  // Sort
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // Actions menu
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});


  // Pagination
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(1);

  // Print preview
  const [showPrintPreview, setShowPrintPreview] = useState(false);
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
  const [previewFilename, setPreviewFilename] = useState('');

  // Delete PIN modal
  const [showPinModal, setShowPinModal] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pendingDeleteInv, setPendingDeleteInv] = useState<Quote | null>(null);

  // WhatsApp modal
  const [showWaModal, setShowWaModal] = useState(false);
  const [waTargetInv, setWaTargetInv] = useState<Quote | null>(null);
  const [waPhone, setWaPhone] = useState('');
  const [agentPhone, setAgentPhone] = useState<string | null>(null);
  const [agentPhoneLoading, setAgentPhoneLoading] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [data, allCompanies, proformas] = await Promise.all([
        SupabaseDocumentsService.getAllByType('invoice'),
        SupabaseCompaniesService.getAllCompanies(),
        SupabaseDocumentsService.getAllByType('proforma'),
      ]);
      setInvoices(data);
      const map: Record<string, string> = {};
      allCompanies.forEach(c => { map[c.id] = c.name; });
      setCompanies(map);
      setCompanyList(allCompanies.map(c => ({ id: c.id, name: c.name })));
      const pMap: Record<string, string> = {};
      proformas.forEach(p => { pMap[p.id] = p.quoteNumber; });
      setProformaNumbers(pMap);
    } catch (e) {
      showToast({ type: 'error', title: 'Erreur', message: String(e) });
    } finally {
      setIsLoading(false);
    }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!openMenuId) return;
    const close = () => setOpenMenuId(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [openMenuId]);

  const handleNewInvoice = async () => {
    const { companyId: ctxId } = getCompanyContext();
    const compId = ctxId || companyList[0]?.id;
    if (!compId) { showToast({ type: 'error', message: 'Aucune société disponible' }); return; }
    setIsCreating(true);
    try {
      const doc = await SupabaseDocumentsService.createEmptyDocument('invoice', compId);
      navigate(`/compta/invoices/${doc.id}?new=1`);
    } catch (e) {
      showToast({ type: 'error', message: String(e) });
    } finally {
      setIsCreating(false);
    }
  };


  const buildSettings = async (inv: Quote) => {
    const compId = inv.issuing_company_id || inv.company_id;
    const company = compId ? await SupabaseCompaniesService.getCompanyById(compId) : null;
    if (!company) return null;
    return {
      company_name: company.name, address: company.address, phone: company.phone,
      phone2: company.phone2, email: company.email, ice: company.ice, rc: company.rc,
      if_number: company.if_number, cnss: company.cnss, patente: company.patente,
      logo_url: company.logo_url, logo_size: company.logo_size,
      tva_rate: company.tva_rate, quote_validity_days: company.quote_validity_days,
      payment_terms: company.payment_terms, quote_visible_fields: company.quote_visible_fields,
      quote_style: { accentColor: company.accent_color, fontFamily: company.font_family, showBorders: true, borderRadius: 1, headerSize: 'large', totalsStyle: 'highlighted' },
    } as any;
  };

  const handleExportPdf = async (inv: Quote) => {
    try {
      const settings = await buildSettings(inv);
      await PdfExportService.exportQuoteToPdf(inv, settings, undefined, undefined, undefined, 'invoice');
    } catch (e) {
      showToast({ type: 'error', title: 'Erreur PDF', message: String(e) });
    }
  };

  const handlePreview = async (inv: Quote) => {
    try {
      const settings = await buildSettings(inv);
      const { blob, filename } = await PdfExportService.generatePdfBlob(inv, settings, undefined, undefined, undefined, 'invoice');
      setPreviewBlob(blob);
      setPreviewFilename(filename);
      setShowPrintPreview(true);
    } catch (e) {
      showToast({ type: 'error', title: 'Erreur aperçu', message: String(e) });
    }
  };

  const openWaModal = async (inv: Quote) => {
    setWaTargetInv(inv);
    setWaPhone(inv.customer?.phoneNumber || '');
    setAgentPhone(null);
    setShowWaModal(true);
    const salesName = inv.customer?.salesPerson;
    if (salesName) {
      setAgentPhoneLoading(true);
      try {
        const users = await SupabaseUsersService.getAllUsers();
        const match = users.find(u =>
          u.custom_seller_name?.toLowerCase().includes(salesName.toLowerCase()) ||
          u.username?.toLowerCase() === salesName.toLowerCase()
        );
        setAgentPhone(match?.phone || null);
      } finally {
        setAgentPhoneLoading(false);
      }
    }
  };

  const sendWhatsApp = () => {
    if (!waTargetInv || !waPhone.trim()) return;
    const msg = `Bonjour ${waTargetInv.customer?.fullName || ''},\nVeuillez trouver ci-joint votre facture ${waTargetInv.quoteNumber} d'un montant de ${fmt(waTargetInv.totalAmount)} Dh.`;
    if (!openWhatsAppShare(buildWhatsAppShareUrl(waPhone.trim(), msg))) {
      navigator.clipboard.writeText(msg).then(() =>
        showToast({ type: 'success', title: 'Copié', message: 'Message copié — ouvrez WhatsApp et collez-le.' })
      );
    }
    setShowWaModal(false);
  };

  const handleEmailShare = (inv: Quote) => {
    const subject = encodeURIComponent(`Facture ${inv.quoteNumber}`);
    const body = encodeURIComponent(`Bonjour ${inv.customer?.fullName || ''},\n\nVeuillez trouver ci-joint votre facture ${inv.quoteNumber} d'un montant de ${fmt(inv.totalAmount)} Dh.\n\nCordialement`);
    window.location.href = `mailto:${inv.customer?.phoneNumber ? '' : ''}?subject=${subject}&body=${body}`;
  };

  const handleDuplicate = async (inv: Quote) => {
    if (!window.confirm('Dupliquer cette facture ?')) return;
    try {
      const dup = await SupabaseDocumentsService.duplicateDocument(inv.id);
      navigate(`/compta/invoices/${dup.id}`);
    } catch (e: any) {
      showToast({ type: 'error', message: e?.message || 'Erreur duplication' });
    }
  };

  const initiateDelete = (inv: Quote) => {
    setPendingDeleteInv(inv);
    setPinInput('');
    setShowPinModal(true);
  };

  const confirmDelete = async () => {
    if (!pendingDeleteInv) return;
    try {
      const compId = pendingDeleteInv.issuing_company_id || pendingDeleteInv.company_id;
      const expectedPin = await CompanySettingsService.resolveSpecialPin(compId);
      if (!expectedPin) {
        showToast({ type: 'error', message: 'Aucun PIN spécial configuré dans les paramètres société' });
        return;
      }
      if (pinInput !== expectedPin) {
        showToast({ type: 'error', message: 'PIN incorrect' });
        return;
      }
      await SupabaseDocumentsService.deleteDocument(pendingDeleteInv.id);
      showToast({ type: 'success', message: `${pendingDeleteInv.quoteNumber} supprimée` });
      setShowPinModal(false);
      setPendingDeleteInv(null);
      setPinInput('');
      await load();
    } catch (e) {
      showToast({ type: 'error', message: String(e) });
    }
  };

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('desc'); }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ChevronDown className="h-3 w-3 opacity-30 inline ml-0.5" />;
    return sortDir === 'asc'
      ? <ChevronUp className="h-3 w-3 inline ml-0.5 text-primary" />
      : <ChevronDown className="h-3 w-3 inline ml-0.5 text-primary" />;
  };

  const filtered = useMemo(() => {
    let list = invoices.filter(inv => {
      const q = search.toLowerCase();
      const clientCode = ((inv.customer as any)?.clientCode || (inv.customer as any)?.client_code || '').toLowerCase();
      if (q && !inv.quoteNumber.toLowerCase().includes(q)
        && !inv.customer?.fullName?.toLowerCase().includes(q)
        && !clientCode.includes(q)
        && !inv.customer?.phoneNumber?.toLowerCase().includes(q)) return false;
      if (dateFrom && new Date(inv.createdAt) < new Date(dateFrom)) return false;
      if (dateTo && new Date(inv.createdAt) > new Date(dateTo + 'T23:59:59')) return false;
      if (filterPayment !== 'Tous' && inv.payment_method?.toLowerCase() !== filterPayment.toLowerCase()) return false;
      if (filterCompany && inv.issuing_company_id !== filterCompany) return false;
      if (filterPayStatus !== 'all') {
        const { status } = computePayment(inv);
        if (status !== filterPayStatus) return false;
      }
      return true;
    });
    list.sort((a, b) => {
      let cmp = 0;
      if (sortField === 'quoteNumber') cmp = a.quoteNumber.localeCompare(b.quoteNumber);
      else if (sortField === 'customer') cmp = (a.customer?.fullName || '').localeCompare(b.customer?.fullName || '');
      else if (sortField === 'date') cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      else if (sortField === 'total') cmp = a.totalAmount - b.totalAmount;
      else if (sortField === 'reste') cmp = computePayment(a).reste - computePayment(b).reste;
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [invoices, search, dateFrom, dateTo, filterPayment, filterCompany, filterPayStatus, sortField, sortDir]);

  useEffect(() => { setPage(1); }, [filtered]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize);

  const handleExportCSV = async () => {
    const { SupabaseClientsService } = await import('../../utils/supabaseClients');
    const phones = [...new Set(filtered.map(inv => inv.customer?.phoneNumber).filter(Boolean))] as string[];
    const clientCodeMap: Record<string, string> = {};
    if (phones.length > 0) {
      try {
        const allClients = await SupabaseClientsService.getAllClients();
        allClients.forEach(c => { if (c.client_code) clientCodeMap[c.phone_number] = c.client_code; });
      } catch { /* non-fatal */ }
    }
    const rows = filtered.map(inv => {
      const { avance, paid, reste, status } = computePayment(inv);
      const statusLabel = status === 'paid' ? 'Payé' : status === 'partial' ? 'Partiel' : 'Non payé';
      return {
        'Code Client': ((inv.customer as any)?.clientCode || clientCodeMap[inv.customer?.phoneNumber || ''] || ''),
        'N° Facture': inv.quoteNumber,
        'Client': inv.customer?.fullName || '',
        'Téléphone': inv.customer?.phoneNumber || '',
        'Ville': inv.customer?.city || '',
        'Société Émettrice': (inv.issuing_company_id && companies[inv.issuing_company_id]) || '',
        'Total TTC': inv.totalAmount,
        'Avance': avance || '',
        'Total Payé': paid,
        'Reste': reste,
        'Statut Paiement': statusLabel,
        'Mode Paiement': inv.payment_method || '',
        'Référence Paiement': inv.payment_reference || '',
        'Date': new Date(inv.createdAt).toLocaleDateString('fr-FR'),
      };
    });
    exportToCSV(rows, `factures-${new Date().toISOString().slice(0, 10)}`);
  };

  const hasFilters = search || dateFrom || dateTo || filterPayment !== 'Tous' || filterCompany || filterPayStatus !== 'all';
  const clearFilters = () => { setSearch(''); setDateFrom(''); setDateTo(''); setFilterPayment('Tous'); setFilterCompany(''); setFilterPayStatus('all'); };

  if (!isSuperAdmin && !isCompta) {
    return <div className="text-center py-12 text-muted-foreground">Accès réservé au rôle Comptabilité.</div>;
  }

  return (
    <div className="space-y-4">
      <div className="glass rounded-xl shadow-lg p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 bg-blue-600 rounded-lg">
              <Receipt className="h-4 w-4 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground">Factures</h1>
              <p className="text-xs text-muted-foreground">{filtered.length} / {invoices.length} facture{invoices.length !== 1 ? 's' : ''}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleNewInvoice}
              disabled={isCreating}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg font-medium"
            >
              {isCreating ? <div className="h-3.5 w-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              <span>Nouvelle facture</span>
            </button>
          <button onClick={handleExportCSV} className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-border rounded-lg hover:bg-accent text-foreground">
            <Download className="h-3.5 w-3.5" /><span>CSV</span>
          </button>
          </div>
        </div>

        {/* Filters */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                type="text" value={search} onChange={e => setSearch(e.target.value)}
                placeholder="N° facture, client, téléphone..."
                className="w-full pl-8 pr-3 py-1.5 text-sm border border-input rounded-lg bg-secondary text-foreground"
              />
            </div>
            {hasFilters && (
              <button onClick={clearFilters} className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg" title="Effacer les filtres">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="px-2 py-1.5 text-xs border border-input rounded-lg bg-secondary text-foreground" title="Date de début" />
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="px-2 py-1.5 text-xs border border-input rounded-lg bg-secondary text-foreground" title="Date de fin" />
            <select value={filterPayment} onChange={e => setFilterPayment(e.target.value)}
              className="px-2 py-1.5 text-xs border border-input rounded-lg bg-secondary text-foreground">
              {PAYMENT_METHODS.map(m => <option key={m}>{m}</option>)}
            </select>
            <select value={filterPayStatus} onChange={e => setFilterPayStatus(e.target.value as any)}
              className="px-2 py-1.5 text-xs border border-input rounded-lg bg-secondary text-foreground">
              <option value="all">Tous les statuts</option>
              <option value="paid">Payé</option>
              <option value="partial">Partiel</option>
              <option value="unpaid">Non payé</option>
            </select>
            <select value={filterCompany} onChange={e => setFilterCompany(e.target.value)}
              className="px-2 py-1.5 text-xs border border-input rounded-lg bg-secondary text-foreground">
              <option value="">Toutes les sociétés</option>
              {companyList.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      <div className="glass rounded-xl shadow-lg overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Aucune facture trouvée</div>
        ) : (
          <>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-secondary">
                <tr>
                  <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase cursor-pointer hover:text-foreground" onClick={() => toggleSort('quoteNumber')}>
                    N° Facture <SortIcon field="quoteNumber" />
                  </th>
                  <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase cursor-pointer hover:text-foreground" onClick={() => toggleSort('customer')}>
                    Client <SortIcon field="customer" />
                  </th>
                  <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase">Code</th>
                  <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase">Proforma</th>
                  <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase">Société</th>
                  <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase cursor-pointer hover:text-foreground" onClick={() => toggleSort('total')}>
                    Total TTC <SortIcon field="total" />
                  </th>
                  <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase">Avance</th>
                  <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase">Payé</th>
                  <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase cursor-pointer hover:text-foreground" onClick={() => toggleSort('reste')}>
                    Reste <SortIcon field="reste" />
                  </th>
                  <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase">Statut</th>
                  <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase cursor-pointer hover:text-foreground" onClick={() => toggleSort('date')}>
                    Date <SortIcon field="date" />
                  </th>
                  <th className="px-3 py-2 text-left text-[11px] font-medium text-muted-foreground uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {paginated.map(inv => {
                  const { avance, paid, reste, status } = computePayment(inv);
                  const clientCode = (inv.customer as any)?.clientCode || (inv.customer as any)?.client_code || '';
                  return (
                  <tr key={inv.id} className="hover:bg-accent/50">
                    <td className="px-3 py-2.5">
                      <Link to={`/compta/invoices/${inv.id}`} className="text-xs font-mono font-semibold text-primary hover:underline">{inv.quoteNumber}</Link>
                      {inv.is_locked && <span className="ml-1 text-[9px] text-amber-600 dark:text-amber-400">🔒</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="text-xs font-medium text-foreground">{inv.customer?.fullName || '—'}</div>
                      {inv.customer?.phoneNumber && <div className="text-[10px] text-muted-foreground">{inv.customer.phoneNumber}</div>}
                    </td>
                    <td className="px-3 py-2.5">
                      {clientCode
                        ? <span className="text-[10px] font-mono bg-blue-500/10 text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded">{clientCode}</span>
                        : <span className="text-[10px] text-muted-foreground">—</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      {inv.parent_document_id && proformaNumbers[inv.parent_document_id] ? (
                        <Link to={`/compta/proformas/${inv.parent_document_id}`} className="text-xs font-mono text-primary hover:underline">
                          {proformaNumbers[inv.parent_document_id]}
                        </Link>
                      ) : <span className="text-[10px] text-muted-foreground">—</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="text-xs text-muted-foreground">{(inv.issuing_company_id && companies[inv.issuing_company_id]) || '—'}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="text-sm font-mono font-bold text-foreground">{fmt(inv.totalAmount)} Dh</span>
                      {inv.payment_method && <div className="text-[10px] text-muted-foreground">{inv.payment_method}</div>}
                    </td>
                    <td className="px-3 py-2.5 text-xs font-mono text-muted-foreground">
                      {avance > 0 ? fmt(avance) : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-xs font-mono text-emerald-600 dark:text-emerald-400">
                      {paid > 0 ? fmt(paid) : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-xs font-mono font-semibold text-amber-600 dark:text-amber-400">
                      {reste > 0 ? fmt(reste) : '—'}
                    </td>
                    <td className="px-3 py-2.5">
                      {!inv.customer?.fullName?.trim() ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-secondary text-muted-foreground border border-border">
                          Brouillon vide
                        </span>
                      ) : status === 'paid' ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                          <CheckCircle className="h-3 w-3" />Payé
                        </span>
                      ) : status === 'partial' ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400">
                          <Clock className="h-3 w-3" />Partiel
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-600 dark:text-red-400">
                          <AlertCircle className="h-3 w-3" />Non payé
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">
                      {new Date(inv.createdAt).toLocaleDateString('fr-FR')}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <div className="flex items-center gap-1">
                        <Link to={`/compta/invoices/${inv.id}`} className="p-1.5 text-primary hover:bg-primary/10 rounded transition-colors" title="Ouvrir">
                          <Eye className="h-3.5 w-3.5" />
                        </Link>
                        <button onClick={() => handleExportPdf(inv)} className="p-1.5 text-blue-500 hover:bg-blue-500/10 rounded transition-colors" title="Télécharger PDF">
                          <Download className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            const btn = e.currentTarget.getBoundingClientRect();
                            const body = document.body.getBoundingClientRect();
                            const menuW = 188;
                            const menuH = 210;
                            const top = window.innerHeight - btn.bottom < menuH + 8
                              ? btn.top - body.top - menuH - 4
                              : btn.bottom - body.top + 4;
                            setMenuStyle({ position: 'absolute', left: Math.max(-body.left + 4, btn.right - menuW - body.left), top, zIndex: 9999, minWidth: menuW });
                            setOpenMenuId(openMenuId === inv.id ? null : inv.id);
                          }}
                          className="p-1.5 text-muted-foreground hover:bg-accent rounded transition-colors"
                          title="Plus d'actions"
                        >
                          <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 16 16"><circle cx="4" cy="8" r="1.2"/><circle cx="8" cy="8" r="1.2"/><circle cx="12" cy="8" r="1.2"/></svg>
                        </button>
                        {openMenuId === inv.id && createPortal(
                          <div onClick={e => e.stopPropagation()} style={menuStyle} className="flex flex-col bg-card border border-border rounded-lg shadow-xl py-1">
                            <button onClick={async () => { setOpenMenuId(null); await handlePreview(inv); }} className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent text-foreground">
                              <Printer className="h-3.5 w-3.5 text-muted-foreground" />Aperçu impression
                            </button>
                            <button onClick={() => { setOpenMenuId(null); openWaModal(inv); }} className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent text-foreground">
                              <MessageCircle className="h-3.5 w-3.5 text-emerald-500" />WhatsApp
                            </button>
                            <button onClick={() => { setOpenMenuId(null); handleEmailShare(inv); }} className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent text-foreground">
                              <Mail className="h-3.5 w-3.5 text-primary" />Email
                            </button>
                            <button onClick={async () => { setOpenMenuId(null); await handleDuplicate(inv); }} className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent text-foreground">
                              <Copy className="h-3.5 w-3.5 text-muted-foreground" />Dupliquer
                            </button>
                            <div className="border-t border-border my-0.5" />
                            <button onClick={() => { setOpenMenuId(null); initiateDelete(inv); }} className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-destructive/10 text-destructive">
                              <Trash2 className="h-3.5 w-3.5" />Supprimer
                            </button>
                          </div>,
                          document.body
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

      {/* Print preview */}
      {showPrintPreview && previewBlob && (
        <PrintPreviewModal blob={previewBlob} filename={previewFilename} onClose={() => { setShowPrintPreview(false); setPreviewBlob(null); }} />
      )}

      {/* Delete PIN modal */}
      {showPinModal && pendingDeleteInv && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="glass rounded-xl shadow-2xl w-full max-w-sm p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-foreground flex items-center gap-2">
                <Lock className="h-4 w-4 text-destructive" />Supprimer la facture
              </h2>
              <button onClick={() => { setShowPinModal(false); setPendingDeleteInv(null); }} className="p-1 hover:bg-accent rounded-lg">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Saisir le PIN spécial pour supprimer <span className="font-mono font-semibold text-foreground">{pendingDeleteInv.quoteNumber}</span>.
            </p>
            <input
              type="password"
              value={pinInput}
              onChange={e => setPinInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') confirmDelete(); }}
              className="w-full px-3 py-2 text-sm border border-input rounded-lg bg-background text-foreground focus:ring-2 focus:ring-ring tracking-widest text-center"
              placeholder="••••••"
              autoFocus
            />
            <div className="flex space-x-2">
              <button onClick={() => { setShowPinModal(false); setPendingDeleteInv(null); }} className="flex-1 px-3 py-1.5 text-sm border border-input rounded-lg hover:bg-accent text-foreground">Annuler</button>
              <button onClick={confirmDelete} disabled={!pinInput} className="flex-1 px-3 py-1.5 text-sm bg-destructive hover:bg-destructive/90 disabled:opacity-50 text-white rounded-lg">
                Supprimer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* WhatsApp modal */}
      {showWaModal && waTargetInv && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-card border border-border rounded-xl shadow-xl w-full max-w-sm p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <MessageCircle className="h-4 w-4 text-emerald-500" />
                Partager par WhatsApp
              </h2>
              <button onClick={() => setShowWaModal(false)} className="p-1 rounded hover:bg-secondary text-muted-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-2">
              <label className="text-[11px] text-muted-foreground">Numéro destinataire</label>
              <input
                type="tel"
                value={waPhone}
                onChange={e => setWaPhone(e.target.value)}
                placeholder="Ex: 0661234567"
                className="w-full px-3 py-2 text-sm border border-input rounded-lg bg-background text-foreground focus:ring-2 focus:ring-ring"
                autoFocus
              />
              <div className="flex flex-col gap-1.5 pt-1">
                {waTargetInv.customer?.phoneNumber && (
                  <button
                    onClick={() => setWaPhone(waTargetInv.customer!.phoneNumber)}
                    className="flex items-center justify-between text-[11px] py-1.5 px-2.5 rounded-lg bg-primary/10 border border-primary/20 text-foreground hover:bg-primary/20"
                  >
                    <span>Client : <span className="font-medium">{waTargetInv.customer.fullName}</span></span>
                    <span className="font-mono text-primary">{waTargetInv.customer.phoneNumber}</span>
                  </button>
                )}
                {waTargetInv.customer?.salesPerson && (
                  <div className="flex items-center justify-between text-[11px] py-1.5 px-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                    <span>Commercial : <span className="font-medium">{waTargetInv.customer.salesPerson}</span></span>
                    {agentPhoneLoading
                      ? <span className="italic text-muted-foreground">chargement…</span>
                      : agentPhone
                        ? <button onClick={() => setWaPhone(agentPhone)} className="font-mono text-emerald-500 hover:underline">{agentPhone}</button>
                        : <span className="italic text-muted-foreground">non configuré</span>}
                  </div>
                )}
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={() => setShowWaModal(false)} className="flex-1 px-3 py-2 text-sm border border-border rounded-lg text-muted-foreground hover:bg-secondary">Annuler</button>
              <button onClick={sendWhatsApp} disabled={!waPhone.trim()} className="flex-1 px-3 py-2 text-sm bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg flex items-center justify-center gap-2">
                <MessageCircle className="h-4 w-4" />Envoyer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
