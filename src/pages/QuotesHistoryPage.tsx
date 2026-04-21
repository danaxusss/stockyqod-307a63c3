// @ts-nocheck
import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Search, Filter, Eye, Edit, Trash2, FileDown, Plus, Calendar, User, DollarSign, Hash, SortAsc, SortDesc, AlertCircle, Check, Loader, X, MessageCircle, Mail, Truck, Copy, Printer } from 'lucide-react';
import { Quote } from '../types';
import { SupabaseQuotesService } from '../utils/supabaseQuotes';
import { SupabaseDocumentsService } from '../utils/supabaseDocuments';
import { ActivityLogger } from '../utils/activityLogger';
import { PdfExportService } from '../utils/pdfExport';
import { CompanySettingsService, CompanySettings, DEFAULT_SHARE_TEMPLATES } from '../utils/companySettings';
import { ExcelExportService } from '../utils/excelExport';
import { useAuth } from '../hooks/useAuth';
import { buildWhatsAppShareUrl, openWhatsAppShare } from '../utils/whatsappShare';
import { exportToCSV } from '../utils/csvExport';
import { PrintPreviewModal } from '../components/PrintPreviewModal';

const QUOTES_PER_PAGE = 10;
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
  useEffect(() => { CompanySettingsService.getSettings().then(setCompanySettings).catch(console.error); }, []);
  useEffect(() => { if (message) { const t = setTimeout(() => setMessage(null), 5000); return () => clearTimeout(t); } }, [message]);

  useEffect(() => {
    let filtered = [...quotes];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(quote => quote.quoteNumber.toLowerCase().includes(q) || quote.customer.fullName.toLowerCase().includes(q) || quote.customer.phoneNumber.includes(q) || quote.customer.city.toLowerCase().includes(q));
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
        CompanySettingsService.getSettings(quote.company_id),
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

  const getCompanyShareIdentity = () => {
    const companyName = companySettings?.company_name?.trim() || 'Restonet';
    const companyPhone = companySettings?.phone?.trim() || companySettings?.phone_gsm?.trim() || companySettings?.phone2?.trim() || companySettings?.phone_dir?.trim() || '';
    const companyEmail = companySettings?.email?.trim() || '';

    return { companyName, companyPhone, companyEmail };
  };

  const buildWhatsAppShareText = (quote: Quote) => {
    const { companyName, companyPhone, companyEmail } = getCompanyShareIdentity();
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

  const buildEmailShareContent = (quote: Quote) => {
    const { companyName, companyPhone, companyEmail } = getCompanyShareIdentity();
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
    const messageText = buildWhatsAppShareText(quote);
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

  const handleEmailShare = (quote: Quote) => {
    const { subject, body } = buildEmailShareContent(quote);
    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  const totalPages = Math.ceil(filteredQuotes.length / QUOTES_PER_PAGE);
  const startIndex = (currentPage - 1) * QUOTES_PER_PAGE;
  const currentQuotes = filteredQuotes.slice(startIndex, startIndex + QUOTES_PER_PAGE);
  const getSortIcon = (field: SortField) => { if (sortField !== field) return null; return sortOrder === 'asc' ? <SortAsc className="h-4 w-4" /> : <SortDesc className="h-4 w-4" />; };
  const formatDate = (date: Date) => date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const formatCurrency = (amount: number) => new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);

  return (
    <div className="max-w-7xl mx-auto space-y-4">
      {/* Header */}
      <div className="glass rounded-xl shadow-lg p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 bg-primary rounded-lg" style={{ boxShadow: 'var(--shadow-glow)' }}>
              <FileText className="h-4 w-4 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground">Historique des Devis</h1>
              <p className="text-xs text-muted-foreground">{isAdmin ? 'Tous les devis' : 'Vos devis'}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
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
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-border rounded-lg hover:bg-accent text-foreground"
            >
              <FileDown className="h-3.5 w-3.5" /><span>CSV</span>
            </button>
            <button onClick={() => navigate('/quote-cart')} className="flex items-center space-x-1.5 px-3 py-1.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg transition-colors text-sm">
              <Plus className="h-3.5 w-3.5" /><span>Nouveau</span>
            </button>
          </div>
        </div>

        {message && (
          <div className={`mb-3 p-2 rounded-lg border flex items-center space-x-2 text-sm ${message.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-destructive/10 border-destructive/20 text-destructive'}`}>
            {message.type === 'success' ? <Check className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
            <span>{message.text}</span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-4 gap-2.5">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 transform -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-sm border border-input rounded-lg focus:ring-2 focus:ring-ring bg-background text-foreground" placeholder="Rechercher..." />
          </div>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)}
            className="px-2.5 py-1.5 text-sm border border-input rounded-lg focus:ring-2 focus:ring-ring bg-background text-foreground">
            <option value="all">Tous</option><option value="draft">En attente</option><option value="pending">Envoyé</option><option value="final">Confirmé</option>
          </select>
          <div className="relative">
            <Calendar className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <input type="date" value={dateRange.start} onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value }))}
              className="w-full pl-8 pr-2.5 py-1.5 text-sm border border-input rounded-lg focus:ring-2 focus:ring-ring bg-background text-foreground" />
          </div>
          <div className="relative">
            <Calendar className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <input type="date" value={dateRange.end} onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value }))}
              className="w-full pl-8 pr-2.5 py-1.5 text-sm border border-input rounded-lg focus:ring-2 focus:ring-ring bg-background text-foreground" />
          </div>
        </div>

        {(searchQuery || statusFilter !== 'all' || dateRange.start || dateRange.end) && (
          <div className="mt-2">
            <button onClick={() => { setSearchQuery(''); setStatusFilter('all'); setDateRange({ start: '', end: '' }); }} className="flex items-center space-x-1 px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
              <X className="h-3 w-3" /><span>Effacer filtres</span>
            </button>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="glass rounded-xl shadow-lg overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary mx-auto"></div>
            <p className="text-muted-foreground mt-3 text-sm">Chargement...</p>
          </div>
        ) : filteredQuotes.length === 0 ? (
          <div className="p-8 text-center">
            <FileText className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <h3 className="text-base font-medium text-foreground mb-1">{quotes.length === 0 ? 'Aucun Devis' : 'Aucun Résultat'}</h3>
            <p className="text-muted-foreground mb-3 text-sm">{quotes.length === 0 ? 'Créez votre premier devis' : 'Aucun devis ne correspond'}</p>
            <button onClick={() => navigate('/quote-cart')} className="px-3 py-1.5 text-sm bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg transition-colors">Créer un Devis</button>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-secondary">
                  <tr>
                    {([['quoteNumber', Hash, 'N°'], ['customerName', User, 'Client'], ['createdAt', Calendar, 'Date'], ['totalAmount', DollarSign, 'Montant'], ['status', Filter, 'Statut']] as const).map(([field, Icon, label]) => (
                      <th key={field} className="px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider cursor-pointer hover:bg-accent" onClick={() => handleSort(field)}>
                        <div className="flex items-center space-x-1"><Icon className="h-3 w-3" /><span>{label}</span>{getSortIcon(field)}</div>
                      </th>
                    ))}
                    {isAdmin && <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider"><div className="flex items-center space-x-1"><User className="h-3 w-3" /><span>Vendeur</span></div></th>}
                    {isSuperAdmin && <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider"><div className="flex items-center space-x-1"><User className="h-3 w-3" /><span>Créé par</span></div></th>}
                    <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {currentQuotes.map((quote) => (
                    <tr key={quote.id} className="hover:bg-accent/50">
                      <td className="px-3 py-2.5 text-xs font-medium text-foreground">{quote.quoteNumber}</td>
                      <td className="px-3 py-2.5"><div className="text-xs font-medium text-foreground">{quote.customer.fullName}</div><div className="text-[11px] text-muted-foreground">{quote.customer.phoneNumber} • {quote.customer.city}</div></td>
                      <td className="px-3 py-2.5 text-xs text-foreground">{formatDate(quote.createdAt)}</td>
                      <td className="px-3 py-2.5 text-xs font-medium text-foreground">{formatCurrency(quote.totalAmount)} Dh</td>
                      <td className="px-3 py-2.5">
                        <span className={`inline-flex px-1.5 py-0.5 text-[11px] font-semibold rounded-full ${quote.status === 'final' ? 'bg-emerald-500/10 text-emerald-400' : quote.status === 'pending' ? 'bg-blue-500/10 text-blue-400' : 'bg-amber-500/10 text-amber-400'}`}>
                          {quote.status === 'final' ? 'Confirmé' : quote.status === 'pending' ? 'Envoyé' : 'En attente'}
                        </span>
                      </td>
                      {isAdmin && <td className="px-3 py-2.5 text-xs text-foreground">{quote.customer.salesPerson}</td>}
                      {isSuperAdmin && <td className="px-3 py-2.5"><span className="inline-flex px-1.5 py-0.5 text-[11px] font-medium rounded-full bg-primary/10 text-primary">{quote.createdBy || '—'}</span></td>}
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-0.5">
                          {/* Always-visible: Edit + Download */}
                          <button onClick={() => navigate(`/quote-cart/${quote.id}`)} className="p-1.5 text-primary hover:bg-primary/10 rounded transition-colors" title="Modifier"><Edit className="h-3.5 w-3.5" /></button>
                          <button onClick={() => handleExport(quote)} disabled={isExporting === quote.id} className="p-1.5 text-emerald-400 hover:bg-emerald-500/10 rounded transition-colors disabled:opacity-50" title="Télécharger PDF">
                            {isExporting === quote.id ? <Loader className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />}
                          </button>
                          {/* More actions dropdown */}
                          <div className="relative group">
                            <button className="p-1.5 text-muted-foreground hover:bg-accent rounded transition-colors" title="Plus d'actions">
                              <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 16 16"><circle cx="4" cy="8" r="1.2"/><circle cx="8" cy="8" r="1.2"/><circle cx="12" cy="8" r="1.2"/></svg>
                            </button>
                            <div className="absolute right-0 top-full mt-1 z-30 hidden group-hover:flex flex-col bg-card border border-border rounded-lg shadow-lg py-1 min-w-[160px]">
                              <button
                                onClick={async () => {
                                  try {
                                    const [freshQuote, freshSettings] = await Promise.all([
                                      SupabaseQuotesService.getQuote(quote.id),
                                      CompanySettingsService.getSettings(quote.company_id),
                                    ]);
                                    const { blob, filename } = await PdfExportService.generatePdfBlob(freshQuote || quote, freshSettings || companySettings);
                                    setPreviewBlob(blob); setPreviewFilename(filename); setShowPrintPreview(true);
                                  } catch { setMessage({ type: 'error', text: 'Erreur aperçu PDF' }); }
                                }}
                                className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent text-foreground"
                              ><Printer className="h-3.5 w-3.5 text-muted-foreground" />Aperçu impression</button>
                              <button onClick={() => handleWhatsAppShare(quote)} className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent text-foreground">
                                <MessageCircle className="h-3.5 w-3.5 text-emerald-500" />WhatsApp
                              </button>
                              <button onClick={() => handleEmailShare(quote)} className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent text-foreground">
                                <Mail className="h-3.5 w-3.5 text-primary" />Email
                              </button>
                              {(isCompta || isSuperAdmin) && (
                                <button
                                  onClick={() => handleCreateBL(quote)}
                                  disabled={isCreatingBL === quote.id || quote.status === 'final' || (quote.document_type && quote.document_type !== 'quote')}
                                  className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent text-foreground disabled:opacity-40"
                                >
                                  {isCreatingBL === quote.id ? <Loader className="h-3.5 w-3.5 animate-spin" /> : <Truck className="h-3.5 w-3.5 text-teal-500" />}Créer un BL
                                </button>
                              )}
                              <button
                                onClick={async () => {
                                  if (!window.confirm('Dupliquer ce devis ?')) return;
                                  try {
                                    const dup = await SupabaseDocumentsService.duplicateDocument(quote.id);
                                    navigate(`/quote-cart/${dup.id}`);
                                  } catch (e: any) { setMessage({ type: 'error', text: e?.message || 'Erreur duplication' }); }
                                }}
                                className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent text-foreground"
                              ><Copy className="h-3.5 w-3.5 text-muted-foreground" />Dupliquer</button>
                              <div className="border-t border-border my-0.5" />
                              <button onClick={() => handleDelete(quote)} className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-destructive/10 text-destructive">
                                <Trash2 className="h-3.5 w-3.5" />Supprimer
                              </button>
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div className="px-4 py-2.5 border-t border-border">
                <div className="flex items-center justify-between">
                  <div className="text-xs text-muted-foreground">Affichage de {startIndex + 1} à {Math.min(startIndex + QUOTES_PER_PAGE, filteredQuotes.length)} sur {filteredQuotes.length}</div>
                  <div className="flex items-center space-x-1.5">
                    <button onClick={() => setCurrentPage(p => Math.max(1, p-1))} disabled={currentPage === 1} className="px-2 py-1 text-xs border border-border rounded hover:bg-accent disabled:opacity-50">Préc.</button>
                    <span className="px-2 py-1 text-xs text-muted-foreground">{currentPage}/{totalPages}</span>
                    <button onClick={() => setCurrentPage(p => Math.min(totalPages, p+1))} disabled={currentPage === totalPages} className="px-2 py-1 text-xs border border-border rounded hover:bg-accent disabled:opacity-50">Suiv.</button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Summary Stats */}
      {filteredQuotes.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { icon: FileText, label: 'Total Devis', value: filteredQuotes.length, color: 'text-primary bg-primary/10' },
            { icon: DollarSign, label: 'Valeur Totale', value: `${formatCurrency(filteredQuotes.reduce((s,q) => s + q.totalAmount, 0))} Dh`, color: 'text-emerald-400 bg-emerald-500/10' },
            { icon: Edit, label: 'En attente', value: filteredQuotes.filter(q => q.status === 'draft').length, color: 'text-amber-400 bg-amber-500/10' },
            { icon: Check, label: 'Confirmés', value: filteredQuotes.filter(q => q.status === 'final').length, color: 'text-violet-400 bg-violet-500/10' },
          ].map(({ icon: Icon, label, value, color }) => (
            <div key={label} className="glass rounded-lg p-3">
              <div className="flex items-center space-x-2">
                <div className={`p-1.5 rounded-lg ${color.split(' ')[1]}`}><Icon className={`h-4 w-4 ${color.split(' ')[0]}`} /></div>
                <div><p className="text-[11px] text-muted-foreground">{label}</p><p className="text-base font-bold text-foreground">{value}</p></div>
              </div>
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