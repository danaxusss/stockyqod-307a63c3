// @ts-nocheck
import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Search, Filter, Eye, Edit, Trash2, FileDown, Plus, Calendar, User, DollarSign, Hash, SortAsc, SortDesc, AlertCircle, Check, Loader, X } from 'lucide-react';
import { Quote } from '../types';
import { SupabaseQuotesService } from '../utils/supabaseQuotes';
import { ActivityLogger } from '../utils/activityLogger';
import { ExcelExportService } from '../utils/excelExport';
import { useAuth } from '../hooks/useAuth';

const QUOTES_PER_PAGE = 10;
type SortField = 'quoteNumber' | 'customerName' | 'createdAt' | 'totalAmount' | 'status';
type SortOrder = 'asc' | 'desc';

export function QuotesHistoryPage() {
  const navigate = useNavigate();
  const { isAdmin, currentUser, authenticatedUser } = useAuth();
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
    try { await ExcelExportService.exportQuoteToExcel(quote); setMessage({ type: 'success', text: 'Devis exporté' }); }
    catch { setMessage({ type: 'error', text: 'Erreur lors de l\'export' }); }
    finally { setIsExporting(null); }
  };

  const totalPages = Math.ceil(filteredQuotes.length / QUOTES_PER_PAGE);
  const startIndex = (currentPage - 1) * QUOTES_PER_PAGE;
  const currentQuotes = filteredQuotes.slice(startIndex, startIndex + QUOTES_PER_PAGE);
  const getSortIcon = (field: SortField) => { if (sortField !== field) return null; return sortOrder === 'asc' ? <SortAsc className="h-4 w-4" /> : <SortDesc className="h-4 w-4" />; };
  const formatDate = (date: Date) => date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const formatCurrency = (amount: number) => new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="glass rounded-2xl shadow-xl p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center space-x-3">
            <div className="p-3 bg-primary rounded-xl" style={{ boxShadow: 'var(--shadow-glow)' }}>
              <FileText className="h-6 w-6 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">Historique des Devis</h1>
              <p className="text-muted-foreground">{isAdmin ? 'Gérez et consultez tous les devis' : 'Gérez et consultez vos devis'}</p>
            </div>
          </div>
          <button onClick={() => navigate('/quote-cart')} className="flex items-center space-x-2 px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg transition-colors">
            <Plus className="h-4 w-4" /><span>Nouveau Devis</span>
          </button>
        </div>

        {message && (
          <div className={`mb-4 p-3 rounded-lg border flex items-center space-x-2 ${message.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-destructive/10 border-destructive/20 text-destructive'}`}>
            {message.type === 'success' ? <Check className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
            <span>{message.text}</span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-input rounded-lg focus:ring-2 focus:ring-ring bg-background text-foreground" placeholder="Rechercher devis, client..." />
          </div>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)}
            className="px-3 py-2 border border-input rounded-lg focus:ring-2 focus:ring-ring bg-background text-foreground">
            <option value="all">Tous les statuts</option><option value="draft">Brouillon</option><option value="final">Final</option>
          </select>
          <input type="date" value={dateRange.start} onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value }))}
            className="px-3 py-2 border border-input rounded-lg focus:ring-2 focus:ring-ring bg-background text-foreground" />
          <input type="date" value={dateRange.end} onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value }))}
            className="px-3 py-2 border border-input rounded-lg focus:ring-2 focus:ring-ring bg-background text-foreground" />
        </div>

        {(searchQuery || statusFilter !== 'all' || dateRange.start || dateRange.end) && (
          <div className="mt-4">
            <button onClick={() => { setSearchQuery(''); setStatusFilter('all'); setDateRange({ start: '', end: '' }); }} className="flex items-center space-x-2 px-3 py-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
              <X className="h-3 w-3" /><span>Effacer les filtres</span>
            </button>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="glass rounded-2xl shadow-xl overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
            <p className="text-muted-foreground mt-4">Chargement des devis...</p>
          </div>
        ) : filteredQuotes.length === 0 ? (
          <div className="p-12 text-center">
            <FileText className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-medium text-foreground mb-2">{quotes.length === 0 ? 'Aucun Devis' : 'Aucun Résultat'}</h3>
            <p className="text-muted-foreground mb-4">{quotes.length === 0 ? 'Créez votre premier devis' : 'Aucun devis ne correspond à vos critères'}</p>
            <button onClick={() => navigate('/quote-cart')} className="px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg transition-colors">Créer un Devis</button>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-secondary">
                  <tr>
                    {([['quoteNumber', Hash, 'Numéro'], ['customerName', User, 'Client'], ['createdAt', Calendar, 'Date'], ['totalAmount', DollarSign, 'Montant'], ['status', Filter, 'Statut']] as const).map(([field, Icon, label]) => (
                      <th key={field} className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider cursor-pointer hover:bg-accent" onClick={() => handleSort(field)}>
                        <div className="flex items-center space-x-1"><Icon className="h-3 w-3" /><span>{label}</span>{getSortIcon(field)}</div>
                      </th>
                    ))}
                    {isAdmin && <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider"><div className="flex items-center space-x-1"><User className="h-3 w-3" /><span>Vendeur</span></div></th>}
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {currentQuotes.map((quote) => (
                    <tr key={quote.id} className="hover:bg-accent/50">
                      <td className="px-4 py-4 text-sm font-medium text-foreground">{quote.quoteNumber}</td>
                      <td className="px-4 py-4"><div className="text-sm font-medium text-foreground">{quote.customer.fullName}</div><div className="text-sm text-muted-foreground">{quote.customer.phoneNumber} • {quote.customer.city}</div></td>
                      <td className="px-4 py-4 text-sm text-foreground">{formatDate(quote.createdAt)}</td>
                      <td className="px-4 py-4 text-sm font-medium text-foreground">{formatCurrency(quote.totalAmount)} Dh</td>
                      <td className="px-4 py-4">
                        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${quote.status === 'final' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'}`}>
                          {quote.status === 'final' ? 'Final' : 'Brouillon'}
                        </span>
                      </td>
                      {isAdmin && <td className="px-4 py-4 text-sm text-foreground">{quote.customer.salesPerson}</td>}
                      <td className="px-4 py-4">
                        <div className="flex items-center space-x-2">
                          <button onClick={() => navigate(`/quote-cart/${quote.id}`)} className="p-1 text-primary hover:bg-primary/10 rounded transition-colors" title="Modifier"><Edit className="h-4 w-4" /></button>
                          <button onClick={() => handleExport(quote)} disabled={isExporting === quote.id} className="p-1 text-emerald-400 hover:bg-emerald-500/10 rounded transition-colors disabled:opacity-50" title="Exporter">
                            {isExporting === quote.id ? <Loader className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
                          </button>
                          <button onClick={() => handleDelete(quote)} className="p-1 text-destructive hover:bg-destructive/10 rounded transition-colors" title="Supprimer"><Trash2 className="h-4 w-4" /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div className="px-6 py-4 border-t border-border">
                <div className="flex items-center justify-between">
                  <div className="text-sm text-muted-foreground">Affichage de {startIndex + 1} à {Math.min(startIndex + QUOTES_PER_PAGE, filteredQuotes.length)} sur {filteredQuotes.length}</div>
                  <div className="flex items-center space-x-2">
                    <button onClick={() => setCurrentPage(p => Math.max(1, p-1))} disabled={currentPage === 1} className="px-3 py-1 border border-border rounded hover:bg-accent disabled:opacity-50">Précédent</button>
                    <span className="px-3 py-1 text-sm text-muted-foreground">Page {currentPage} sur {totalPages}</span>
                    <button onClick={() => setCurrentPage(p => Math.min(totalPages, p+1))} disabled={currentPage === totalPages} className="px-3 py-1 border border-border rounded hover:bg-accent disabled:opacity-50">Suivant</button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Summary Stats */}
      {filteredQuotes.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[
            { icon: FileText, label: 'Total Devis', value: filteredQuotes.length, color: 'text-primary bg-primary/10' },
            { icon: DollarSign, label: 'Valeur Totale', value: `${formatCurrency(filteredQuotes.reduce((s,q) => s + q.totalAmount, 0))} Dh`, color: 'text-emerald-400 bg-emerald-500/10' },
            { icon: Edit, label: 'Brouillons', value: filteredQuotes.filter(q => q.status === 'draft').length, color: 'text-amber-400 bg-amber-500/10' },
            { icon: Check, label: 'Finalisés', value: filteredQuotes.filter(q => q.status === 'final').length, color: 'text-violet-400 bg-violet-500/10' },
          ].map(({ icon: Icon, label, value, color }) => (
            <div key={label} className="glass rounded-xl shadow-lg p-4">
              <div className="flex items-center space-x-3">
                <div className={`p-2 rounded-lg ${color.split(' ')[1]}`}><Icon className={`h-5 w-5 ${color.split(' ')[0]}`} /></div>
                <div><p className="text-sm text-muted-foreground">{label}</p><p className="text-xl font-bold text-foreground">{value}</p></div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}