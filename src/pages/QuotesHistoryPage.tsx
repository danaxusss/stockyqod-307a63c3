// @ts-nocheck
import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Search, Edit, Trash2, FileDown, Plus, SortAsc, SortDesc, AlertCircle, Check, Loader, X, MessageCircle, Mail, Truck, Copy, Printer, SlidersHorizontal } from 'lucide-react';
import { Quote } from '../types';
import { quoteCompanyId, SupabaseQuotesService } from '../utils/supabaseQuotes';
import { SupabaseDocumentsService } from '../utils/supabaseDocuments';
import { ActivityLogger } from '../utils/activityLogger';
import { PdfExportService } from '../utils/pdfExport';
import { CompanySettingsService, CompanySettings, DEFAULT_SHARE_TEMPLATES } from '../utils/companySettings';
import { ExcelExportService } from '../utils/excelExport';
import { useAuth } from '../hooks/useAuth';
import { buildWhatsAppShareUrl, openWhatsAppShare } from '../utils/whatsappShare';
import { exportToCSV } from '../utils/csvExport';
import { PrintPreviewModal } from '../components/PrintPreviewModal';
import { PageHeader } from '../components/PageHeader';
import { RowMenu } from '../components/lists/RowMenu';
import { StatusPill } from '../components/lists/StatusPill';
import { DocumentCard } from '../components/lists/DocumentCard';
import { useIsMobile } from '../hooks/use-mobile';
import { formatMoney } from '../utils/format';

/** Quote status, the same words and colours as in the quote editor. */
function QuoteStatus({ status }: { status: Quote['status'] }) {
  if (status === 'final') return <StatusPill tone="success">Confirmé</StatusPill>;
  if (status === 'pending') return <StatusPill tone="info">Envoyé</StatusPill>;
  return <StatusPill tone="warning">En attente</StatusPill>;
}

const PAGE_SIZES = [20, 30, 50];
type SortField = 'quoteNumber' | 'customerName' | 'createdAt' | 'totalAmount' | 'status';
type SortOrder = 'asc' | 'desc';

export function QuotesHistoryPage() {
  const navigate = useNavigate();
  const { isAdmin, isSuperAdmin, isCompta, currentUser, authenticatedUser } = useAuth();
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [filteredQuotes, setFilteredQuotes] = useState<Quote[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'draft' | 'final'>('all');
  const [dateRange, setDateRange] = useState({ start: '', end: '' });
  const [currentPage, setCurrentPage] = useState(1);
  const [sortField, setSortField] = useState<SortField>('createdAt');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
  const [isExporting, setIsExporting] = useState<string | null>(null);
  const [showPrintPreview, setShowPrintPreview] = useState(false);
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
  const [previewFilename, setPreviewFilename] = useState('');
  const [isCreatingBL, setIsCreatingBL] = useState<string | null>(null);
  // Phones get cards instead of the wide table.
  const isMobile = useIsMobile();
  const [showFilters, setShowFilters] = useState(false);
  const [pageSize, setPageSize] = useState(20);
  const [companySettings, setCompanySettings] = useState<CompanySettings | null>(null);

  const loadQuotes = useCallback(async () => {
    setIsLoading(true); setMessage(null);
    try {
      const allQuotes = await SupabaseQuotesService.getAllQuotes();
      setQuotes(allQuotes); setFilteredQuotes(allQuotes);
    } catch (error) {
      setMessage({ type: 'error', text: 'Erreur lors du chargement des devis' });
    } finally { setIsLoading(false); }
  }, [isAdmin, currentUser, authenticatedUser]);

  useEffect(() => { loadQuotes(); }, [loadQuotes]);

  // Fallback letterhead: the user's own company (never the legacy global row,
  // which carries another company's logo).
  useEffect(() => { CompanySettingsService.getSettings(quoteCompanyId(null)).then(setCompanySettings).catch(console.error); }, []);
  useEffect(() => { if (message) { const t = setTimeout(() => setMessage(null), 5000); return () => clearTimeout(t); } }, [message]);

  useEffect(() => {
    let filtered = [...quotes];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(quote => {
        const code = ((quote.customer as any)?.clientCode || (quote.customer as any)?.client_code || '').toLowerCase();
        return quote.quoteNumber.toLowerCase().includes(q) || quote.customer.fullName.toLowerCase().includes(q) || quote.customer.phoneNumber.includes(q) || quote.customer.city.toLowerCase().includes(q) || code.includes(q);
      });
    }
    if (statusFilter !== 'all') filtered = filtered.filter(quote => quote.status === statusFilter);
    if (dateRange.start) { const s = new Date(dateRange.start); filtered = filtered.filter(quote => quote.createdAt >= s); }
    if (dateRange.end) { const e = new Date(dateRange.end); e.setHours(23,59,59,999); filtered = filtered.filter(quote => quote.createdAt <= e); }
    filtered.sort((a, b) => {
      let aV: any, bV: any;
      switch (sortField) {
        case 'quoteNumber': aV = a.quoteNumber; bV = b.quoteNumber; break;
        case 'customerName': aV = a.customer.fullName.toLowerCase(); bV = b.customer.fullName.toLowerCase(); break;
        case 'createdAt': aV = a.createdAt.getTime(); bV = b.createdAt.getTime(); break;
        case 'totalAmount': aV = a.totalAmount; bV = b.totalAmount; break;
        case 'status': aV = a.status; bV = b.status; break;
        default: return 0;
      }
      if (aV < bV) return sortOrder === 'asc' ? -1 : 1;
      if (aV > bV) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });
    setFilteredQuotes(filtered); setCurrentPage(1);
  }, [quotes, searchQuery, statusFilter, dateRange, sortField, sortOrder]);

  useEffect(() => { setCurrentPage(1); }, [pageSize]);

  const handleSort = (field: SortField) => { if (sortField === field) setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc'); else { setSortField(field); setSortOrder('asc'); } };

  const handleDelete = async (quote: Quote) => {
    if (!window.confirm(`Supprimer le devis ${quote.quoteNumber} ?`)) return;
    try {
      await SupabaseQuotesService.deleteQuote(quote.id);
      await ActivityLogger.log('quote_deleted', `Quote ${quote.quoteNumber} deleted`, 'quote', quote.id);
      setMessage({ type: 'success', text: 'Devis supprimé' });
      await loadQuotes();
    } catch { setMessage({ type: 'error', text: 'Erreur lors de la suppression du devis' }); }
  };

  const handleExport = async (quote: Quote) => {
    setIsExporting(quote.id);
    try {
      const [freshQuote, freshSettings] = await Promise.all([
        SupabaseQuotesService.getQuote(quote.id),
        CompanySettingsService.getSettings(quoteCompanyId(quote)),
      ]);

      await PdfExportService.exportQuoteToPdf(freshQuote || quote, freshSettings || companySettings);
      setMessage({ type: 'success', text: 'Devis exporté en PDF' });
    }
    catch {
      setMessage({ type: 'error', text: 'Erreur lors de l\'export PDF' });
    }
    finally {
      setIsExporting(null);
    }
  };

  const handleCreateBL = async (quote: Quote) => {
    if (!window.confirm(`Créer un BL depuis le devis ${quote.quoteNumber} ? Le devis sera marqué "Final".`)) return;
    setIsCreatingBL(quote.id);
    try {
      const bl = await SupabaseDocumentsService.createBLFromQuote(quote.id);
      setMessage({ type: 'success', text: `BL ${bl.quoteNumber} créé avec succès` });
      await loadQuotes();
    } catch (e) {
      setMessage({ type: 'error', text: e instanceof Error ? e.message : 'Erreur création BL' });
    } finally {
      setIsCreatingBL(null);
    }
  };

  const getShareIdentityFromSettings = (s: CompanySettings | null) => {
    const companyName = s?.company_name?.trim() || companySettings?.company_name?.trim() || 'Restonet';
    const companyPhone = s?.phone?.trim() || s?.phone_gsm?.trim() || s?.phone2?.trim() || s?.phone_dir?.trim() || companySettings?.phone?.trim() || '';
    const companyEmail = s?.email?.trim() || companySettings?.email?.trim() || '';
    return { companyName, companyPhone, companyEmail };
  };

  const buildWhatsAppShareText = (quote: Quote, s: CompanySettings | null) => {
    const { companyName, companyPhone, companyEmail } = getShareIdentityFromSettings(s);
    const customerName = quote.customer.fullName?.trim();

    return [
      customerName ? `Bonjour ${customerName},` : 'Bonjour,',
      '',
      `Voici le récapitulatif de votre devis ${companyName}.`,
      '',
      `📋 Devis N° : ${quote.quoteNumber}`,
      `💰 Montant TTC : ${formatCurrency(quote.totalAmount)} Dh`,
      `📅 Date : ${formatDate(quote.createdAt)}`,
      '',
      `Si vous avez besoin d'informations complémentaires, nous restons à votre disposition.`,
      '',
      'Cordialement,',
      companyName,
      companyPhone ? `📞 ${companyPhone}` : '',
      companyEmail ? `✉️ ${companyEmail}` : '',
    ].filter(Boolean).join('\n');
  };

  const buildEmailShareContent = (quote: Quote, s: CompanySettings | null) => {
    const { companyName, companyPhone, companyEmail } = getShareIdentityFromSettings(s);
    const customerName = quote.customer.fullName?.trim();

    return {
      subject: `Devis ${companyName} - ${quote.quoteNumber}`,
      body: [
        customerName ? `Bonjour ${customerName},` : 'Bonjour,',
        '',
        `Veuillez trouver le récapitulatif de votre devis ${companyName}.`,
        '',
        `Devis N° : ${quote.quoteNumber}`,
        `Montant TTC : ${formatCurrency(quote.totalAmount)} Dh`,
        `Date : ${formatDate(quote.createdAt)}`,
        '',
        `N'hésitez pas à nous contacter si vous avez besoin d'informations complémentaires.`,
        '',
        'Cordialement,',
        companyName,
        companyPhone ? `Tél : ${companyPhone}` : '',
        companyEmail ? `Email : ${companyEmail}` : '',
      ].filter(Boolean).join('\n')
    };
  };

  const handleWhatsAppShare = async (quote: Quote) => {
    const s = await CompanySettingsService.getSettings(quoteCompanyId(quote)).catch(() => companySettings);
    const messageText = buildWhatsAppShareText(quote, s);
    const shareUrl = buildWhatsAppShareUrl(quote.customer.phoneNumber || '', messageText);

    if (!openWhatsAppShare(shareUrl)) {
      try {
        await navigator.clipboard.writeText(messageText);
        setMessage({ type: 'success', text: 'Message WhatsApp copié. Ouvrez WhatsApp puis collez-le.' });
      } catch {
        setMessage({ type: 'error', text: "Impossible d'ouvrir ou copier le message WhatsApp." });
      }
    }
  };

  const handleEmailShare = async (quote: Quote) => {
    const s = await CompanySettingsService.getSettings(quoteCompanyId(quote)).catch(() => companySettings);
    const { subject, body } = buildEmailShareContent(quote, s);
    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  const totalPages = Math.max(1, Math.ceil(filteredQuotes.length / pageSize));
  const startIndex = (currentPage - 1) * pageSize;
  const currentQuotes = filteredQuotes.slice(startIndex, startIndex + pageSize);
  const getSortIcon = (field: SortField) => { if (sortField !== field) return null; return sortOrder === 'asc' ? <SortAsc className="h-4 w-4" /> : <SortDesc className="h-4 w-4" />; };
  const formatDate = (date: Date) => date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const formatCurrency = (amount: number) => new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);

  const handlePrintPreview = async (quote: Quote) => {
    try {
      const [freshQuote, freshSettings] = await Promise.all([
        SupabaseQuotesService.getQuote(quote.id),
        CompanySettingsService.getSettings(quoteCompanyId(quote)),
      ]);
      const { blob, filename } = await PdfExportService.generatePdfBlob(freshQuote || quote, freshSettings || companySettings);
      setPreviewBlob(blob); setPreviewFilename(filename); setShowPrintPreview(true);
    } catch { setMessage({ type: 'error', text: 'Erreur aperçu PDF' }); }
  };

  const handleDuplicate = async (quote: Quote) => {
    if (!window.confirm('Dupliquer ce devis ?')) return;
    try {
      const dup = await SupabaseDocumentsService.duplicateDocument(quote.id);
      navigate(`/quote-cart/${dup.id}`);
    } catch (e: any) { setMessage({ type: 'error', text: e?.message || 'Erreur duplication' }); }
  };

  const menuItems = (quote: Quote) => [
    { label: 'Modifier', icon: <Edit className="h-4 w-4 text-primary" />, to: `/quote-cart/${quote.id}` },
    { label: 'Télécharger le PDF', icon: <FileDown className="h-4 w-4 text-muted-foreground" />, onSelect: () => handleExport(quote), disabled: isExporting === quote.id },
    { label: 'Aperçu impression', icon: <Printer className="h-4 w-4 text-muted-foreground" />, onSelect: () => handlePrintPreview(quote) },
    { label: 'WhatsApp', icon: <MessageCircle className="h-4 w-4 text-emerald-600" />, onSelect: () => handleWhatsAppShare(quote) },
    { label: 'E-mail', icon: <Mail className="h-4 w-4 text-primary" />, onSelect: () => handleEmailShare(quote) },
    ...((isCompta || isSuperAdmin) ? [{
      label: 'Créer un BL', icon: isCreatingBL === quote.id ? <Loader className="h-4 w-4 animate-spin" /> : <Truck className="h-4 w-4 text-sky-600" />,
      onSelect: () => handleCreateBL(quote),
      disabled: isCreatingBL === quote.id || quote.status === 'final' || (!!quote.document_type && quote.document_type !== 'quote'),
    }] : []),
    { label: 'Dupliquer', icon: <Copy className="h-4 w-4 text-muted-foreground" />, onSelect: () => handleDuplicate(quote) },
    { label: 'Supprimer', icon: <Trash2 className="h-4 w-4" />, onSelect: () => handleDelete(quote), danger: true, separated: true },
  ];

  const exportCsv = () => {
    const rows = filteredQuotes.map(q => ({
      'N° Devis': q.quoteNumber,
      'Client': q.customer?.fullName || '',
      'Téléphone': q.customer?.phoneNumber || '',
      'Ville': q.customer?.city || '',
      'Vendeur': q.customer?.salesPerson || '',
      'Total TTC': q.totalAmount,
      'Statut': q.status,
      'Date': new Date(q.createdAt).toLocaleDateString('fr-FR'),
    }));
    exportToCSV(rows, `devis-${new Date().toISOString().slice(0, 10)}`);
  };

  const clientCodeOf = (quote: Quote) => (quote.customer as any)?.clientCode || (quote.customer as any)?.client_code || '';
  const th = 'px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground';
  const sortTh = (field: SortField, label: string, align = 'text-left') => (
    <th key={field} className={`${th} ${align} cursor-pointer hover:text-foreground`} onClick={() => handleSort(field)}
      aria-sort={sortField === field ? (sortOrder === 'asc' ? 'ascending' : 'descending') : undefined}>
      <span className={`inline-flex items-center gap-1 ${align === 'text-right' ? 'justify-end' : ''}`}>{label}{getSortIcon(field)}</span>
    </th>
  );
  const field = 'w-full rounded-lg border border-input bg-background px-2.5 py-2 text-sm text-foreground focus:ring-2 focus:ring-ring';

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <PageHeader
        title="Devis"
        subtitle={isAdmin ? 'Tous les devis' : 'Vos devis'}
        actions={<>
          <button onClick={exportCsv} className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-secondary">
            <FileDown className="h-4 w-4" />CSV
          </button>
          <button onClick={() => navigate('/quote-cart')} className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
            <Plus className="h-4 w-4" />Nouveau devis
          </button>
        </>}
      >
        {message && (
          <div role="status" className={`mb-3 flex items-center gap-2 rounded-lg border p-2 text-sm ${message.type === 'success' ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'border-destructive/20 bg-destructive/10 text-destructive'}`}>
            {message.type === 'success' ? <Check className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
            <span>{message.text}</span>
          </div>
        )}
        <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
            <div className="col-span-2 flex gap-2 md:col-span-1">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} aria-label="Rechercher un devis"
                  className={`${field} pl-9`} placeholder="N°, client, téléphone, ville…" />
              </div>
              {isMobile && (
                <button onClick={() => setShowFilters(open => !open)} aria-expanded={showFilters}
                  className={`relative flex items-center gap-1.5 rounded-lg border px-3 text-sm ${showFilters ? 'border-primary text-primary' : 'border-input text-foreground'}`}>
                  <SlidersHorizontal className="h-4 w-4" />Filtres
                  {[statusFilter !== 'all', dateRange.start, dateRange.end].filter(Boolean).length > 0 && (
                    <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">{[statusFilter !== 'all', dateRange.start, dateRange.end].filter(Boolean).length}</span>
                  )}
                </button>
              )}
            </div>
            {(!isMobile || showFilters) && <>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} className={`${field} col-span-2 md:col-span-1`} aria-label="Statut">
              <option value="all">Tous les statuts</option><option value="draft">En attente</option><option value="pending">Envoyé</option><option value="final">Confirmé</option>
            </select>
            <input type="date" value={dateRange.start} onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value }))} className={field} aria-label="Du" title="Du" />
            <input type="date" value={dateRange.end} onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value }))} className={field} aria-label="Au" title="Au" />
            </>}
          </div>
          {(searchQuery || statusFilter !== 'all' || dateRange.start || dateRange.end) && (
            <button onClick={() => { setSearchQuery(''); setStatusFilter('all'); setDateRange({ start: '', end: '' }); }} className="mt-2 flex items-center gap-1 px-1 text-xs text-muted-foreground hover:text-foreground">
              <X className="h-3 w-3" /><span>Effacer filtres</span>
            </button>
          )}
        </div>
      </PageHeader>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        {isLoading ? (
          <div className="p-8 text-center">
            <div className="mx-auto h-6 w-6 animate-spin rounded-full border-b-2 border-primary"></div>
            <p className="mt-3 text-sm text-muted-foreground">Chargement…</p>
          </div>
        ) : filteredQuotes.length === 0 ? (
          <div className="p-8 text-center">
            <FileText className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
            <h3 className="mb-1 text-base font-medium text-foreground">{quotes.length === 0 ? 'Aucun devis' : 'Aucun résultat'}</h3>
            <p className="mb-3 text-sm text-muted-foreground">{quotes.length === 0 ? 'Créez votre premier devis' : 'Aucun devis ne correspond'}</p>
            <button onClick={() => navigate('/quote-cart')} className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90">Créer un devis</button>
          </div>
        ) : (
          <>
            {isMobile ? (
              <ul className="divide-y divide-border">
                {currentQuotes.map(quote => (
                  <DocumentCard key={quote.id} to={`/quote-cart/${quote.id}`}
                    number={quote.quoteNumber}
                    status={<QuoteStatus status={quote.status} />}
                    title={quote.customer.fullName || '—'}
                    subtitle={[quote.customer.phoneNumber, quote.customer.city, isAdmin && quote.customer.salesPerson].filter(Boolean).join(' · ')}
                    date={formatDate(quote.createdAt)}
                    amount={formatMoney(quote.totalAmount)}
                    menu={<RowMenu label={`Actions pour ${quote.quoteNumber}`} items={menuItems(quote)} />}
                  />
                ))}
              </ul>
            ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-secondary/40">
                  <tr>
                    {sortTh('quoteNumber', 'N°')}
                    {sortTh('customerName', 'Client')}
                    {sortTh('createdAt', 'Date')}
                    {sortTh('totalAmount', 'Montant TTC', 'text-right')}
                    {sortTh('status', 'Statut')}
                    {isAdmin && <th className={`${th} text-left`}>Vendeur</th>}
                    {isSuperAdmin && <th className={`${th} text-left`}>Créé par</th>}
                    <th className={th}><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {currentQuotes.map((quote) => (
                    <tr key={quote.id} className="cursor-pointer hover:bg-secondary/60"
                      onClick={event => { if (!(event.target as HTMLElement).closest('a,button,[role="menu"]')) navigate(`/quote-cart/${quote.id}`); }}>
                      <td className="whitespace-nowrap px-3 py-2.5 font-mono font-semibold text-primary">{quote.quoteNumber}</td>
                      <td className="px-3 py-2.5">
                        <div className="font-medium text-foreground">{quote.customer.fullName}</div>
                        <div className="text-xs text-muted-foreground">{[clientCodeOf(quote), quote.customer.phoneNumber, quote.customer.city].filter(Boolean).join(' · ')}</div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">{formatDate(quote.createdAt)}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums text-foreground">{formatMoney(quote.totalAmount)}</td>
                      <td className="px-3 py-2.5"><QuoteStatus status={quote.status} /></td>
                      {isAdmin && <td className="px-3 py-2.5 text-foreground">{quote.customer.salesPerson}</td>}
                      {isSuperAdmin && <td className="px-3 py-2.5 text-muted-foreground">{quote.createdBy || '—'}</td>}
                      <td className="px-3 py-2.5">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => handleExport(quote)} disabled={isExporting === quote.id} title="Télécharger le PDF" aria-label={`PDF de ${quote.quoteNumber}`}
                            className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-50">
                            {isExporting === quote.id ? <Loader className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
                          </button>
                          <RowMenu label={`Actions pour ${quote.quoteNumber}`} items={menuItems(quote).filter(item => item.label !== 'Télécharger le PDF')} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border px-4 py-2.5">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>Afficher</span>
                <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setCurrentPage(1); }} aria-label="Devis par page" className="rounded border border-input bg-background px-2 py-1 text-xs text-foreground">
                  {PAGE_SIZES.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
                <span>/ {filteredQuotes.length}</span>
              </div>
              {totalPages > 1 && (
                <div className="flex items-center gap-1.5">
                  <button onClick={() => setCurrentPage(p => Math.max(1, p-1))} disabled={currentPage === 1} className="rounded-lg border border-border px-2.5 py-1 text-xs hover:bg-secondary disabled:opacity-50">Préc.</button>
                  <span className="px-2 text-xs text-muted-foreground">{currentPage}/{totalPages}</span>
                  <button onClick={() => setCurrentPage(p => Math.min(totalPages, p+1))} disabled={currentPage === totalPages} className="rounded-lg border border-border px-2.5 py-1 text-xs hover:bg-secondary disabled:opacity-50">Suiv.</button>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {filteredQuotes.length > 0 && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            { label: 'Devis affichés', value: filteredQuotes.length },
            { label: 'Valeur totale', value: formatMoney(filteredQuotes.reduce((s, q) => s + q.totalAmount, 0)) },
            { label: 'En attente', value: filteredQuotes.filter(q => q.status === 'draft').length },
            { label: 'Confirmés', value: filteredQuotes.filter(q => q.status === 'final').length },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-xl border border-border bg-card p-3 shadow-sm">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="mt-0.5 text-base font-bold tabular-nums text-foreground">{value}</p>
            </div>
          ))}
        </div>
      )}

      {showPrintPreview && previewBlob && (
        <PrintPreviewModal blob={previewBlob} filename={previewFilename} onClose={() => { setShowPrintPreview(false); setPreviewBlob(null); }} />
      )}
    </div>
  );
}