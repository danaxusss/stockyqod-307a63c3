import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search, Download, Trash2, ChevronUp, ChevronDown, X, Printer, MessageCircle, Mail, Copy, Lock, CheckCircle, Clock, AlertCircle, Plus, FileText, SlidersHorizontal } from 'lucide-react';
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
import { documentDay, formatDay, invoicePayment, matchesPaymentFilter } from '../../utils/documentLines';
import { formatMoney } from '../../utils/format';
import { useIsMobile } from '../../hooks/use-mobile';
import { PageHeader } from '../../components/PageHeader';
import { RowMenu } from '../../components/lists/RowMenu';
import { StatusPill } from '../../components/lists/StatusPill';
import { DocumentCard } from '../../components/lists/DocumentCard';

function fmt(n: number) {
  return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2 }).format(n);
}

const computePayment = (inv: Quote) => invoicePayment(inv);

/** Payment status of an invoice, as shown in the list. */
function InvoiceStatus({ inv }: { inv: Quote }) {
  if (!inv.customer?.fullName?.trim()) return <StatusPill tone="neutral">Brouillon vide</StatusPill>;
  const { status } = computePayment(inv);
  if (status === 'paid') return <StatusPill tone="success" icon={<CheckCircle className="h-3 w-3" />}>Payé</StatusPill>;
  if (status === 'partial') return <StatusPill tone="warning" icon={<Clock className="h-3 w-3" />}>Partiel</StatusPill>;
  return <StatusPill tone="danger" icon={<AlertCircle className="h-3 w-3" />}>Non payé</StatusPill>;
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

  // Phones get cards instead of the wide table.
  const isMobile = useIsMobile();
  const [showFilters, setShowFilters] = useState(false);


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
      // Invoices always print HT, TVA and TTC.
      await PdfExportService.exportQuoteToPdf(inv, settings, undefined, undefined, undefined, 'invoice', undefined, false);
    } catch (e) {
      showToast({ type: 'error', title: 'Erreur PDF', message: String(e) });
    }
  };

  const handlePreview = async (inv: Quote) => {
    try {
      const settings = await buildSettings(inv);
      const { blob, filename } = await PdfExportService.generatePdfBlob(inv, settings, undefined, undefined, undefined, 'invoice', undefined, false);
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
      // The invoice date (as edited), compared as local calendar days.
      const day = documentDay(inv);
      if (dateFrom && day < dateFrom) return false;
      if (dateTo && day > dateTo) return false;
      if (filterPayment !== 'Tous' && !matchesPaymentFilter(inv, filterPayment)) return false;
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
      else if (sortField === 'date') cmp = documentDay(a).localeCompare(documentDay(b)) || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
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
        'Date': formatDay(documentDay(inv)),
      };
    });
    exportToCSV(rows, `factures-${new Date().toISOString().slice(0, 10)}`);
  };

  const activeFilterCount = [dateFrom, dateTo, filterPayment !== 'Tous', filterCompany, filterPayStatus !== 'all'].filter(Boolean).length;
  const hasFilters = search || dateFrom || dateTo || filterPayment !== 'Tous' || filterCompany || filterPayStatus !== 'all';
  const clearFilters = () => { setSearch(''); setDateFrom(''); setDateTo(''); setFilterPayment('Tous'); setFilterCompany(''); setFilterPayStatus('all'); };

  if (!isSuperAdmin && !isCompta) {
    return <div className="text-center py-12 text-muted-foreground">Accès réservé au rôle Comptabilité.</div>;
  }

  const menuItems = (inv: Quote) => [
    { label: 'Télécharger le PDF', icon: <Download className="h-4 w-4 text-muted-foreground" />, onSelect: () => handleExportPdf(inv) },
    { label: 'Aperçu impression', icon: <Printer className="h-4 w-4 text-muted-foreground" />, onSelect: () => handlePreview(inv) },
    { label: 'WhatsApp', icon: <MessageCircle className="h-4 w-4 text-emerald-600" />, onSelect: () => openWaModal(inv) },
    { label: 'E-mail', icon: <Mail className="h-4 w-4 text-primary" />, onSelect: () => handleEmailShare(inv) },
    { label: 'Dupliquer', icon: <Copy className="h-4 w-4 text-muted-foreground" />, onSelect: () => handleDuplicate(inv) },
    { label: 'Supprimer', icon: <Trash2 className="h-4 w-4" />, onSelect: () => initiateDelete(inv), danger: true, separated: true },
  ];

  const th = 'px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground';
  const sortTh = (field: SortField, label: string, align = 'text-left') => (
    <th className={`${th} ${align} cursor-pointer hover:text-foreground`} onClick={() => toggleSort(field)}
      aria-sort={sortField === field ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}>
      {label} <SortIcon field={field} />
    </th>
  );
  const field = 'rounded-lg border border-input bg-background px-2.5 py-2 text-sm text-foreground';

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <PageHeader
        title="Factures"
        subtitle={`${filtered.length} / ${invoices.length} facture${invoices.length !== 1 ? 's' : ''}`}
        actions={<>
          <button onClick={handleExportCSV} className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-secondary">
            <Download className="h-4 w-4" />CSV
          </button>
          <button onClick={handleNewInvoice} disabled={isCreating}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            {isCreating ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" /> : <Plus className="h-4 w-4" />}
            Nouvelle facture
          </button>
        </>}
      >
        <div className="space-y-2 rounded-xl border border-border bg-card p-3 shadow-sm">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input type="text" value={search} onChange={e => setSearch(e.target.value)} aria-label="Rechercher une facture"
                placeholder="N° facture, client, téléphone…"
                className="w-full rounded-lg border border-input bg-background py-2 pl-9 pr-3 text-sm text-foreground focus:ring-2 focus:ring-ring" />
            </div>
            {isMobile && (
              <button onClick={() => setShowFilters(open => !open)} aria-expanded={showFilters}
                className={`relative flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm ${showFilters ? 'border-primary text-primary' : 'border-input text-foreground'}`}>
                <SlidersHorizontal className="h-4 w-4" />Filtres
                {activeFilterCount > 0 && <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">{activeFilterCount}</span>}
              </button>
            )}
            {hasFilters && (
              <button onClick={clearFilters} className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground" title="Effacer les filtres" aria-label="Effacer les filtres">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          {(!isMobile || showFilters) && <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className={field} title="Date de début" aria-label="Date de début" />
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className={field} title="Date de fin" aria-label="Date de fin" />
            <select value={filterPayment} onChange={e => setFilterPayment(e.target.value)} className={field} aria-label="Mode de paiement">
              {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m === 'Tous' ? 'Tous les modes de paiement' : m}</option>)}
            </select>
            <select value={filterPayStatus} onChange={e => setFilterPayStatus(e.target.value as any)} className={field} aria-label="Statut de paiement">
              <option value="all">Tous les statuts</option>
              <option value="paid">Payé</option>
              <option value="partial">Partiel</option>
              <option value="unpaid">Non payé</option>
            </select>
            <select value={filterCompany} onChange={e => setFilterCompany(e.target.value)} className={`${field} col-span-2 md:col-span-1`} aria-label="Société">
              <option value="">Toutes les sociétés</option>
              {companyList.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>}
        </div>
      </PageHeader>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        {isLoading ? (
          <div className="p-8 text-center">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Aucune facture trouvée</div>
        ) : (
          <>
          {isMobile ? (
            <ul className="divide-y divide-border">
              {paginated.map(inv => {
                const { reste } = computePayment(inv);
                return (
                  <DocumentCard key={inv.id} to={`/compta/invoices/${inv.id}`}
                    number={<>{inv.quoteNumber}{inv.is_locked && <Lock className="ml-1 inline h-3 w-3 text-amber-600" aria-label="Verrouillée" />}</>}
                    status={<InvoiceStatus inv={inv} />}
                    title={inv.customer?.fullName || '—'}
                    subtitle={[inv.customer?.phoneNumber, inv.issuing_company_id && companies[inv.issuing_company_id]].filter(Boolean).join(' · ')}
                    date={formatDay(documentDay(inv))}
                    amount={formatMoney(inv.totalAmount)}
                    note={reste > 0 ? <span className="font-medium text-amber-700 dark:text-amber-300">reste {formatMoney(reste)}</span> : undefined}
                    menu={<RowMenu label={`Actions pour ${inv.quoteNumber}`} items={menuItems(inv)} />}
                  />
                );
              })}
            </ul>
          ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-secondary/40">
                <tr>
                  {sortTh('quoteNumber', 'N° facture')}
                  {sortTh('customer', 'Client')}
                  <th className={`${th} text-left`}>Proforma</th>
                  <th className={`${th} text-left`}>Société</th>
                  {sortTh('total', 'Total TTC', 'text-right')}
                  <th className={`${th} text-right`}>Payé</th>
                  {sortTh('reste', 'Reste', 'text-right')}
                  <th className={`${th} text-left`}>Statut</th>
                  {sortTh('date', 'Date')}
                  <th className={th}><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {paginated.map(inv => {
                  const { avance, paid, reste } = computePayment(inv);
                  const clientCode = (inv.customer as any)?.clientCode || (inv.customer as any)?.client_code || '';
                  return (
                  <tr key={inv.id} className="cursor-pointer hover:bg-secondary/60"
                    onClick={event => { if (!(event.target as HTMLElement).closest('a,button,[role="menu"]')) navigate(`/compta/invoices/${inv.id}`); }}>
                    <td className="whitespace-nowrap px-3 py-2.5">
                      <Link to={`/compta/invoices/${inv.id}`} className="font-mono font-semibold text-primary hover:underline">{inv.quoteNumber}</Link>
                      {inv.is_locked && <Lock className="ml-1 inline h-3 w-3 text-amber-600 dark:text-amber-400" aria-label="Verrouillée" />}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="font-medium text-foreground">{inv.customer?.fullName || '—'}</div>
                      <div className="text-xs text-muted-foreground">
                        {[clientCode, inv.customer?.phoneNumber].filter(Boolean).join(' · ')}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5">
                      {inv.parent_document_id && proformaNumbers[inv.parent_document_id] ? (
                        <Link to={`/compta/proformas/${inv.parent_document_id}`} className="font-mono text-xs text-primary hover:underline">
                          {proformaNumbers[inv.parent_document_id]}
                        </Link>
                      ) : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">{(inv.issuing_company_id && companies[inv.issuing_company_id]) || '—'}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right">
                      <span className="font-semibold tabular-nums text-foreground">{formatMoney(inv.totalAmount)}</span>
                      {inv.payment_method && <div className="text-xs text-muted-foreground">{inv.payment_method}</div>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-emerald-700 dark:text-emerald-300">
                      {paid > 0 ? formatMoney(paid) : <span className="text-muted-foreground">—</span>}
                      {avance > 0 && <div className="text-xs text-muted-foreground">dont avance {formatMoney(avance)}</div>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums text-amber-700 dark:text-amber-300">
                      {reste > 0 ? formatMoney(reste) : <span className="font-normal text-muted-foreground">—</span>}
                    </td>
                    <td className="px-3 py-2.5"><InvoiceStatus inv={inv} /></td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">{formatDay(documentDay(inv))}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => handleExportPdf(inv)} className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground" title="Télécharger le PDF" aria-label={`PDF de ${inv.quoteNumber}`}>
                          <FileText className="h-4 w-4" />
                        </button>
                        <RowMenu label={`Actions pour ${inv.quoteNumber}`} items={menuItems(inv).slice(1)} />
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
              <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }} aria-label="Factures par page" className="rounded border border-input bg-background px-2 py-1 text-xs text-foreground">
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
              <button onClick={() => { setShowPinModal(false); setPendingDeleteInv(null); }} className="p-1 hover:bg-secondary rounded-lg">
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
              <button onClick={() => { setShowPinModal(false); setPendingDeleteInv(null); }} className="flex-1 px-3 py-1.5 text-sm border border-input rounded-lg hover:bg-secondary text-foreground">Annuler</button>
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
