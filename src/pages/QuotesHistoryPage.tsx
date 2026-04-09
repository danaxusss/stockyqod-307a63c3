// @ts-nocheck
import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  FileText, 
  Search, 
  Filter, 
  Eye, 
  Edit, 
  Trash2, 
  FileDown, 
  Plus,
  Calendar,
  User,
  DollarSign,
  Hash,
  SortAsc,
  SortDesc,
  AlertCircle,
  Check,
  Loader,
  X
} from 'lucide-react';
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

  // Data state
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [filteredQuotes, setFilteredQuotes] = useState<Quote[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // UI state
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'draft' | 'final'>('all');
  const [dateRange, setDateRange] = useState({ start: '', end: '' });
  const [currentPage, setCurrentPage] = useState(1);
  const [sortField, setSortField] = useState<SortField>('createdAt');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
  const [isExporting, setIsExporting] = useState<string | null>(null);

  // Load quotes
  const loadQuotes = useCallback(async () => {
    setIsLoading(true);
    setMessage(null);
    try {
      console.log('Loading quotes from database...');
      const allQuotes = await getAllQuotes();
      
      const currentUsername = currentUser?.username || authenticatedUser?.username;
      console.log(`Loaded ${allQuotes.length} quotes for user: ${currentUsername} (admin: ${isAdmin})`);
      
      console.log(`Loaded ${allQuotes.length} quotes:`, allQuotes.map(q => ({ id: q.id, number: q.quoteNumber, created: q.createdAt })));
      setQuotes(allQuotes);
      setFilteredQuotes(allQuotes);
      
      if (allQuotes.length === 0) {
        console.log(isAdmin ? 'No quotes found in database' : `No quotes found for user: ${currentUsername}`);
      }
    } catch (error) {
      console.error('Failed to load quotes:', error);
      setMessage({ type: 'error', text: 'Erreur lors du chargement des devis' });
    } finally {
      setIsLoading(false);
    }
  }, [isAdmin, currentUser, authenticatedUser]);

  // Initial load
  useEffect(() => {
    loadQuotes();
  }, [loadQuotes]);

  // Clear messages after timeout
  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => setMessage(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [message]);

  // Filter and sort quotes
  useEffect(() => {
    let filtered = [...quotes];

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(quote =>
        quote.quoteNumber.toLowerCase().includes(query) ||
        quote.customer.fullName.toLowerCase().includes(query) ||
        quote.customer.phoneNumber.includes(query) ||
        quote.customer.city.toLowerCase().includes(query)
      );
    }

    // Apply status filter
    if (statusFilter !== 'all') {
      filtered = filtered.filter(quote => quote.status === statusFilter);
    }

    // Apply date range filter
    if (dateRange.start) {
      const startDate = new Date(dateRange.start);
      filtered = filtered.filter(quote => quote.createdAt >= startDate);
    }
    if (dateRange.end) {
      const endDate = new Date(dateRange.end);
      endDate.setHours(23, 59, 59, 999); // End of day
      filtered = filtered.filter(quote => quote.createdAt <= endDate);
    }

    // Apply sorting
    filtered.sort((a, b) => {
      let aValue: any;
      let bValue: any;

      switch (sortField) {
        case 'quoteNumber':
          aValue = a.quoteNumber;
          bValue = b.quoteNumber;
          break;
        case 'customerName':
          aValue = a.customer.fullName.toLowerCase();
          bValue = b.customer.fullName.toLowerCase();
          break;
        case 'createdAt':
          aValue = a.createdAt.getTime();
          bValue = b.createdAt.getTime();
          break;
        case 'totalAmount':
          aValue = a.totalAmount;
          bValue = b.totalAmount;
          break;
        case 'status':
          aValue = a.status;
          bValue = b.status;
          break;
        default:
          return 0;
      }

      if (aValue < bValue) return sortOrder === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });

    setFilteredQuotes(filtered);
    setCurrentPage(1); // Reset to first page when filters change
  }, [quotes, searchQuery, statusFilter, dateRange, sortField, sortOrder]);

  // Handle sort
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  // Handle delete
  const handleDelete = async (quote: Quote) => {
    const confirmed = window.confirm(
      `Êtes-vous sûr de vouloir supprimer le devis ${quote.quoteNumber} ?\n\nCette action est irréversible.`
    );

    if (!confirmed) return;

    try {
      await deleteQuote(quote.id);
      setMessage({ 
        type: 'success', 
        text: navigator.onLine 
          ? 'Devis supprimé localement et du serveur'
          : 'Devis supprimé localement (sera synchronisé quand vous serez en ligne)'
      });
      await loadQuotes(); // Reload quotes
    } catch (error) {
      console.error('Failed to delete quote:', error);
      setMessage({ type: 'error', text: 'Erreur lors de la suppression du devis' });
    }
  };

  // Handle export
  const handleExport = async (quote: Quote) => {
    setIsExporting(quote.id);
    try {
      await ExcelExportService.exportQuoteToExcel(quote);
      setMessage({ type: 'success', text: 'Devis exporté avec succès' });
    } catch (error) {
      console.error('Export failed:', error);
      setMessage({ type: 'error', text: 'Erreur lors de l\'export Excel' });
    } finally {
      setIsExporting(null);
    }
  };

  // Clear filters
  const clearFilters = () => {
    setSearchQuery('');
    setStatusFilter('all');
    setDateRange({ start: '', end: '' });
  };

  // Pagination
  const totalPages = Math.ceil(filteredQuotes.length / QUOTES_PER_PAGE);
  const startIndex = (currentPage - 1) * QUOTES_PER_PAGE;
  const endIndex = startIndex + QUOTES_PER_PAGE;
  const currentQuotes = filteredQuotes.slice(startIndex, endIndex);

  // Get sort icon
  const getSortIcon = (field: SortField) => {
    if (sortField !== field) return null;
    return sortOrder === 'asc' ? <SortAsc className="h-4 w-4" /> : <SortDesc className="h-4 w-4" />;
  };

  // Format date
  const formatDate = (date: Date) => {
    return date.toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  };

  // Format currency
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('fr-FR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm rounded-2xl shadow-xl p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center space-x-3">
            <div className="p-3 bg-gradient-to-r from-purple-500 to-purple-600 rounded-xl">
              <FileText className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                Historique des Devis
              </h1>
              <p className="text-gray-600 dark:text-gray-400">
                {isAdmin ? 'Gérez et consultez tous les devis' : 'Gérez et consultez vos devis'}
              </p>
            </div>
          </div>

          <button
            onClick={() => navigate('/quote-cart')}
            className="flex items-center space-x-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
          >
            <Plus className="h-4 w-4" />
            <span>Nouveau Devis</span>
          </button>
        </div>

        {/* Messages */}
        {message && (
          <div className={`mb-4 p-3 rounded-lg border flex items-center space-x-2 ${
            message.type === 'success' 
              ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-300'
              : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300'
          }`}>
            {message.type === 'success' ? (
              <Check className="h-4 w-4" />
            ) : (
              <AlertCircle className="h-4 w-4" />
            )}
            <span>{message.text}</span>
          </div>
        )}

        {/* Filters */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
              placeholder="Rechercher devis, client..."
            />
          </div>

          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | 'draft' | 'final')}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
          >
            <option value="all">Tous les statuts</option>
            <option value="draft">Brouillon</option>
            <option value="final">Final</option>
          </select>

          {/* Date Range */}
          <input
            type="date"
            value={dateRange.start}
            onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value }))}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
            placeholder="Date début"
          />

          <input
            type="date"
            value={dateRange.end}
            onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value }))}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
            placeholder="Date fin"
          />
        </div>

        {/* Clear Filters */}
        {(searchQuery || statusFilter !== 'all' || dateRange.start || dateRange.end) && (
          <div className="mt-4">
            <button
              onClick={clearFilters}
              className="flex items-center space-x-2 px-3 py-1 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
            >
              <X className="h-3 w-3" />
              <span>Effacer les filtres</span>
            </button>
          </div>
        )}
      </div>

      {/* Quotes Table */}
      <div className="bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm rounded-2xl shadow-xl overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
            <p className="text-gray-600 dark:text-gray-400 mt-4">Chargement des devis...</p>
          </div>
        ) : filteredQuotes.length === 0 ? (
          <div className="p-12 text-center">
            <FileText className="h-16 w-16 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
              {quotes.length === 0 ? 'Aucun Devis' : 'Aucun Résultat'}
            </h3>
            <p className="text-gray-600 dark:text-gray-400 mb-4">
              {quotes.length === 0 
                ? (isAdmin ? 'Aucun devis dans le système' : 'Créez votre premier devis pour commencer')
                : 'Aucun devis ne correspond à vos critères de recherche'
              }
            </p>
            <button
              onClick={() => navigate('/quote-cart')}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
            >
              Créer un Devis
            </button>
          </div>
        ) : (
          <>
            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-slate-700">
                  <tr>
                    <th 
                      className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-slate-600"
                      onClick={() => handleSort('quoteNumber')}
                    >
                      <div className="flex items-center space-x-1">
                        <Hash className="h-3 w-3" />
                        <span>Numéro</span>
                        {getSortIcon('quoteNumber')}
                      </div>
                    </th>
                    <th 
                      className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-slate-600"
                      onClick={() => handleSort('customerName')}
                    >
                      <div className="flex items-center space-x-1">
                        <User className="h-3 w-3" />
                        <span>Client</span>
                        {getSortIcon('customerName')}
                      </div>
                    </th>
                    <th 
                      className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-slate-600"
                      onClick={() => handleSort('createdAt')}
                    >
                      <div className="flex items-center space-x-1">
                        <Calendar className="h-3 w-3" />
                        <span>Date</span>
                        {getSortIcon('createdAt')}
                      </div>
                    </th>
                    <th 
                      className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-slate-600"
                      onClick={() => handleSort('totalAmount')}
                    >
                      <div className="flex items-center space-x-1">
                        <DollarSign className="h-3 w-3" />
                        <span>Montant</span>
                        {getSortIcon('totalAmount')}
                      </div>
                    </th>
                    <th 
                      className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-slate-600"
                      onClick={() => handleSort('status')}
                    >
                      <div className="flex items-center space-x-1">
                        <Filter className="h-3 w-3" />
                        <span>Statut</span>
                        {getSortIcon('status')}
                      </div>
                    </th>
                    {isAdmin && (
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        <div className="flex items-center space-x-1">
                          <User className="h-3 w-3" />
                          <span>Vendeur</span>
                        </div>
                      </th>
                    )}
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {currentQuotes.map((quote) => (
                    <tr key={quote.id} className="hover:bg-gray-50 dark:hover:bg-slate-700/50">
                      <td className="px-4 py-4 text-sm font-medium text-gray-900 dark:text-white">
                        {quote.quoteNumber}
                      </td>
                      <td className="px-4 py-4">
                        <div>
                          <div className="text-sm font-medium text-gray-900 dark:text-white">
                            {quote.customer.fullName}
                          </div>
                          <div className="text-sm text-gray-500 dark:text-gray-400">
                            {quote.customer.phoneNumber} • {quote.customer.city}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-sm text-gray-900 dark:text-white">
                        {formatDate(quote.createdAt)}
                      </td>
                      <td className="px-4 py-4 text-sm font-medium text-gray-900 dark:text-white">
                        {formatCurrency(quote.totalAmount)} Dh
                      </td>
                      <td className="px-4 py-4">
                        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                          quote.status === 'final'
                            ? 'bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-300'
                            : 'bg-yellow-100 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-300'
                        }`}>
                          {quote.status === 'final' ? 'Final' : 'Brouillon'}
                        </span>
                      </td>
                      {isAdmin && (
                        <td className="px-4 py-4 text-sm text-gray-900 dark:text-white">
                          {quote.customer.salesPerson}
                        </td>
                      )}
                      <td className="px-4 py-4">
                        <div className="flex items-center space-x-2">
                          <button
                            onClick={() => navigate(`/quote-cart/${quote.id}`)}
                            className="p-1 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors"
                            title="Modifier"
                          >
                            <Edit className="h-4 w-4" />
                          </button>
                          
                          <button
                            onClick={() => handleExport(quote)}
                            disabled={isExporting === quote.id}
                            className="p-1 text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 rounded transition-colors disabled:opacity-50"
                            title="Exporter Excel"
                          >
                            {isExporting === quote.id ? (
                              <Loader className="h-4 w-4 animate-spin" />
                            ) : (
                              <FileDown className="h-4 w-4" />
                            )}
                          </button>
                          
                          <button
                            onClick={() => handleDelete(quote)}
                            className="p-1 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                            title="Supprimer"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700">
                <div className="flex items-center justify-between">
                  <div className="text-sm text-gray-700 dark:text-gray-300">
                    Affichage de {startIndex + 1} à {Math.min(endIndex, filteredQuotes.length)} sur {filteredQuotes.length} devis
                  </div>
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                      disabled={currentPage === 1}
                      className="px-3 py-1 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Précédent
                    </button>
                    <span className="px-3 py-1 text-sm text-gray-700 dark:text-gray-300">
                      Page {currentPage} sur {totalPages}
                    </span>
                    <button
                      onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                      disabled={currentPage === totalPages}
                      className="px-3 py-1 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Suivant
                    </button>
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
          <div className="bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm rounded-xl shadow-lg p-4">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
                <FileText className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">Total Devis</p>
                <p className="text-xl font-bold text-gray-900 dark:text-white">
                  {filteredQuotes.length}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm rounded-xl shadow-lg p-4">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-green-100 dark:bg-green-900/30 rounded-lg">
                <DollarSign className="h-5 w-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">Valeur Totale</p>
                <p className="text-xl font-bold text-gray-900 dark:text-white">
                  {formatCurrency(filteredQuotes.reduce((sum, quote) => sum + quote.totalAmount, 0))} Dh
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm rounded-xl shadow-lg p-4">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-yellow-100 dark:bg-yellow-900/30 rounded-lg">
                <Edit className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
              </div>
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">Brouillons</p>
                <p className="text-xl font-bold text-gray-900 dark:text-white">
                  {filteredQuotes.filter(q => q.status === 'draft').length}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm rounded-xl shadow-lg p-4">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
                <Check className="h-5 w-5 text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">Finalisés</p>
                <p className="text-xl font-bold text-gray-900 dark:text-white">
                  {filteredQuotes.filter(q => q.status === 'final').length}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}