import React, { useState, useEffect } from 'react';
import { 
  BarChart3, 
  Package, 
  Users, 
  FileText, 
  DollarSign, 
  TrendingUp, 
  MapPin,
  Building,
  Calendar,
  Target,
  Award,
  Activity
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useAppContext } from '../context/AppContext';
import { SupabaseQuotesService } from '../utils/supabaseQuotes';
import { SupabaseUsersService } from '../utils/supabaseUsers';
import { Quote, AppUser } from '../types';

interface ProductStats {
  totalProducts: number;
  totalStockValue: number;
  stockByLocation: { location: string; count: number; value: number }[];
  brandDistribution: { brand: string; count: number; percentage: number }[];
  lowStockProducts: number;
  topValueProducts: { name: string; brand: string; value: number }[];
}

interface QuoteStats {
  totalQuotes: number;
  totalValue: number;
  draftQuotes: number;
  finalQuotes: number;
  averageQuoteValue: number;
  quotesThisMonth: number;
  topSellers: { name: string; quotesCount: number; totalValue: number }[];
  recentActivity: { date: Date; action: string; details: string }[];
}

export function StatisticsPage() {
  const { isAdmin } = useAuth();
  const { state } = useAppContext();
  const [isLoading, setIsLoading] = useState(true);
  const [productStats, setProductStats] = useState<ProductStats | null>(null);
  const [quoteStats, setQuoteStats] = useState<QuoteStats | null>(null);
  const [users, setUsers] = useState<AppUser[]>([]);

  useEffect(() => {
    const loadStatistics = async () => {
      setIsLoading(true);
      try {
        const [quotes, allUsers] = await Promise.all([
          SupabaseQuotesService.getAllQuotes(),
          SupabaseUsersService.getAllUsers()
        ]);

        setUsers(allUsers);
        const pStats = calculateProductStats(state.products);
        setProductStats(pStats);
        const qStats = calculateQuoteStats(quotes, allUsers);
        setQuoteStats(qStats);
      } catch (error) {
        console.error('Failed to load statistics:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadStatistics();
  }, [state.products]);

  // Redirect if not admin
  if (!isAdmin) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl p-8 text-center">
          <BarChart3 className="h-16 w-16 text-red-600 dark:text-red-400 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-red-900 dark:text-red-100 mb-2">
            Accès Refusé
          </h1>
          <p className="text-red-700 dark:text-red-300">
            Vous devez être administrateur pour accéder aux statistiques.
          </p>
        </div>
      </div>
    );
  }


  const calculateProductStats = (products: any[]): ProductStats => {
    const totalProducts = products.length;
    let totalStockValue = 0;
    const locationMap = new Map<string, { count: number; value: number }>();
    const brandMap = new Map<string, number>();
    let lowStockProducts = 0;
    const productValues: { name: string; brand: string; value: number }[] = [];

    products.forEach(product => {
      // Calculate total stock and value by location
      Object.entries(product.stock_levels || {}).forEach(([location, stock]) => {
        const stockNum = Number(stock) || 0;
        const value = stockNum * (product.price || 0);
        totalStockValue += value;

        const existing = locationMap.get(location) || { count: 0, value: 0 };
        locationMap.set(location, {
          count: existing.count + stockNum,
          value: existing.value + value
        });
      });

      // Brand distribution
      const brand = product.brand || 'Sans marque';
      brandMap.set(brand, (brandMap.get(brand) || 0) + 1);

      // Low stock check (less than 5 total)
      const totalStock = Object.values(product.stock_levels || {}).reduce((sum: number, level) => sum + (Number(level) || 0), 0);
      if (totalStock < 5) {
        lowStockProducts++;
      }

      // Product values for top products
      productValues.push({
        name: product.name,
        brand: product.brand || 'Sans marque',
        value: totalStock * (product.price || 0)
      });
    });

    // Convert maps to arrays and sort
    const stockByLocation = Array.from(locationMap.entries()).map(([location, data]) => ({
      location,
      count: data.count,
      value: data.value
    })).sort((a, b) => b.value - a.value);

    const brandDistribution = Array.from(brandMap.entries()).map(([brand, count]) => ({
      brand,
      count,
      percentage: (count / totalProducts) * 100
    })).sort((a, b) => b.count - a.count);

    const topValueProducts = productValues
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);

    return {
      totalProducts,
      totalStockValue,
      stockByLocation,
      brandDistribution,
      lowStockProducts,
      topValueProducts
    };
  };

  const calculateQuoteStats = (quotes: Quote[], users: AppUser[]): QuoteStats => {
    const totalQuotes = quotes.length;
    const totalValue = quotes.reduce((sum, quote) => sum + quote.totalAmount, 0);
    const draftQuotes = quotes.filter(q => q.status === 'draft').length;
    const finalQuotes = quotes.filter(q => q.status === 'final').length;
    const averageQuoteValue = totalQuotes > 0 ? totalValue / totalQuotes : 0;

    // Quotes this month
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const quotesThisMonth = quotes.filter(q => q.createdAt >= startOfMonth).length;

    // Top sellers
    const sellerMap = new Map<string, { quotesCount: number; totalValue: number }>();
    quotes.forEach(quote => {
      const seller = quote.customer.salesPerson;
      const existing = sellerMap.get(seller) || { quotesCount: 0, totalValue: 0 };
      sellerMap.set(seller, {
        quotesCount: existing.quotesCount + 1,
        totalValue: existing.totalValue + quote.totalAmount
      });
    });

    const topSellers = Array.from(sellerMap.entries()).map(([name, data]) => ({
      name,
      quotesCount: data.quotesCount,
      totalValue: data.totalValue
    })).sort((a, b) => b.totalValue - a.totalValue).slice(0, 5);

    // Recent activity (last 10 quotes)
    const recentActivity = quotes
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 10)
      .map(quote => ({
        date: quote.createdAt,
        action: `Devis ${quote.status === 'final' ? 'finalisé' : 'créé'}`,
        details: `${quote.quoteNumber} - ${quote.customer.fullName} (${formatCurrency(quote.totalAmount)} Dh)`
      }));

    return {
      totalQuotes,
      totalValue,
      draftQuotes,
      finalQuotes,
      averageQuoteValue,
      quotesThisMonth,
      topSellers,
      recentActivity
    };
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('fr-FR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  };

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat('fr-FR').format(num);
  };

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto">
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="text-gray-600 dark:text-gray-400 mt-4">Chargement des statistiques...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm rounded-2xl shadow-xl p-6">
        <div className="flex items-center space-x-3">
          <div className="p-3 bg-gradient-to-r from-blue-500 to-blue-600 rounded-xl">
            <BarChart3 className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              Statistiques Générales
            </h1>
            <p className="text-gray-600 dark:text-gray-400">
              Vue d'ensemble de votre inventaire et activité commerciale
            </p>
          </div>
        </div>
      </div>

      {/* Product & Inventory Statistics */}
      <div className="bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm rounded-2xl shadow-xl p-6">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-6 flex items-center space-x-2">
          <Package className="h-5 w-5" />
          <span>Statistiques Produits & Inventaire</span>
        </h2>

        {productStats && (
          <>
            {/* Overview Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
              <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg">
                <div className="flex items-center space-x-3">
                  <Package className="h-8 w-8 text-blue-600 dark:text-blue-400" />
                  <div>
                    <p className="text-sm text-blue-600 dark:text-blue-400">Total Produits</p>
                    <p className="text-2xl font-bold text-blue-900 dark:text-blue-100">
                      {formatNumber(productStats.totalProducts)}
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-emerald-50 dark:bg-emerald-900/20 p-4 rounded-lg">
                <div className="flex items-center space-x-3">
                  <DollarSign className="h-8 w-8 text-emerald-600 dark:text-emerald-400" />
                  <div>
                    <p className="text-sm text-emerald-600 dark:text-emerald-400">Valeur Stock</p>
                    <p className="text-2xl font-bold text-emerald-900 dark:text-emerald-100">
                      {formatCurrency(productStats.totalStockValue)} Dh
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-orange-50 dark:bg-orange-900/20 p-4 rounded-lg">
                <div className="flex items-center space-x-3">
                  <Building className="h-8 w-8 text-orange-600 dark:text-orange-400" />
                  <div>
                    <p className="text-sm text-orange-600 dark:text-orange-400">Marques</p>
                    <p className="text-2xl font-bold text-orange-900 dark:text-orange-100">
                      {productStats.brandDistribution.length}
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-red-50 dark:bg-red-900/20 p-4 rounded-lg">
                <div className="flex items-center space-x-3">
                  <Target className="h-8 w-8 text-red-600 dark:text-red-400" />
                  <div>
                    <p className="text-sm text-red-600 dark:text-red-400">Stock Faible</p>
                    <p className="text-2xl font-bold text-red-900 dark:text-red-100">
                      {formatNumber(productStats.lowStockProducts)}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Stock by Location */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center space-x-2">
                  <MapPin className="h-5 w-5" />
                  <span>Stock par Emplacement</span>
                </h3>
                <div className="space-y-3">
                  {productStats.stockByLocation.slice(0, 5).map((location, index) => (
                    <div key={location.location} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-slate-700 rounded-lg">
                      <div>
                        <p className="font-medium text-gray-900 dark:text-white capitalize">
                          {location.location.replace(/_/g, ' ')}
                        </p>
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                          {formatNumber(location.count)} articles
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold text-emerald-600 dark:text-emerald-400">
                          {formatCurrency(location.value)} Dh
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Top Brands */}
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center space-x-2">
                  <Building className="h-5 w-5" />
                  <span>Top Marques</span>
                </h3>
                <div className="space-y-3">
                  {productStats.brandDistribution.slice(0, 5).map((brand, index) => (
                    <div key={brand.brand} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-slate-700 rounded-lg">
                      <div>
                        <p className="font-medium text-gray-900 dark:text-white">
                          {brand.brand}
                        </p>
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                          {formatNumber(brand.count)} produits
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold text-blue-600 dark:text-blue-400">
                          {brand.percentage.toFixed(1)}%
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Sellers & Quotes Statistics */}
      <div className="bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm rounded-2xl shadow-xl p-6">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-6 flex items-center space-x-2">
          <FileText className="h-5 w-5" />
          <span>Statistiques Vendeurs & Devis</span>
        </h2>

        {quoteStats && (
          <>
            {/* Overview Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
              <div className="bg-purple-50 dark:bg-purple-900/20 p-4 rounded-lg">
                <div className="flex items-center space-x-3">
                  <FileText className="h-8 w-8 text-purple-600 dark:text-purple-400" />
                  <div>
                    <p className="text-sm text-purple-600 dark:text-purple-400">Total Devis</p>
                    <p className="text-2xl font-bold text-purple-900 dark:text-purple-100">
                      {formatNumber(quoteStats.totalQuotes)}
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-green-50 dark:bg-green-900/20 p-4 rounded-lg">
                <div className="flex items-center space-x-3">
                  <DollarSign className="h-8 w-8 text-green-600 dark:text-green-400" />
                  <div>
                    <p className="text-sm text-green-600 dark:text-green-400">Valeur Totale</p>
                    <p className="text-2xl font-bold text-green-900 dark:text-green-100">
                      {formatCurrency(quoteStats.totalValue)} Dh
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-indigo-50 dark:bg-indigo-900/20 p-4 rounded-lg">
                <div className="flex items-center space-x-3">
                  <TrendingUp className="h-8 w-8 text-indigo-600 dark:text-indigo-400" />
                  <div>
                    <p className="text-sm text-indigo-600 dark:text-indigo-400">Valeur Moyenne</p>
                    <p className="text-2xl font-bold text-indigo-900 dark:text-indigo-100">
                      {formatCurrency(quoteStats.averageQuoteValue)} Dh
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-yellow-50 dark:bg-yellow-900/20 p-4 rounded-lg">
                <div className="flex items-center space-x-3">
                  <Calendar className="h-8 w-8 text-yellow-600 dark:text-yellow-400" />
                  <div>
                    <p className="text-sm text-yellow-600 dark:text-yellow-400">Ce Mois</p>
                    <p className="text-2xl font-bold text-yellow-900 dark:text-yellow-100">
                      {formatNumber(quoteStats.quotesThisMonth)}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Quote Status Distribution */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center space-x-2">
                  <Award className="h-5 w-5" />
                  <span>Top Vendeurs</span>
                </h3>
                <div className="space-y-3">
                  {quoteStats.topSellers.map((seller, index) => (
                    <div key={seller.name} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-slate-700 rounded-lg">
                      <div className="flex items-center space-x-3">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white font-bold ${
                          index === 0 ? 'bg-yellow-500' : 
                          index === 1 ? 'bg-gray-400' : 
                          index === 2 ? 'bg-orange-600' : 'bg-blue-500'
                        }`}>
                          {index + 1}
                        </div>
                        <div>
                          <p className="font-medium text-gray-900 dark:text-white">
                            {seller.name}
                          </p>
                          <p className="text-sm text-gray-600 dark:text-gray-400">
                            {formatNumber(seller.quotesCount)} devis
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold text-emerald-600 dark:text-emerald-400">
                          {formatCurrency(seller.totalValue)} Dh
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Recent Activity */}
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center space-x-2">
                  <Activity className="h-5 w-5" />
                  <span>Activité Récente</span>
                </h3>
                <div className="space-y-3 max-h-80 overflow-y-auto">
                  {quoteStats.recentActivity.map((activity, index) => (
                    <div key={index} className="flex items-start space-x-3 p-3 bg-gray-50 dark:bg-slate-700 rounded-lg">
                      <div className="w-2 h-2 bg-blue-500 rounded-full mt-2 flex-shrink-0"></div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 dark:text-white">
                          {activity.action}
                        </p>
                        <p className="text-xs text-gray-600 dark:text-gray-400 truncate">
                          {activity.details}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-500">
                          {activity.date.toLocaleDateString('fr-FR')} à {activity.date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Status Distribution */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-yellow-50 dark:bg-yellow-900/20 p-4 rounded-lg">
                <div className="flex items-center space-x-3">
                  <div className="w-4 h-4 bg-yellow-500 rounded-full"></div>
                  <div>
                    <p className="text-sm text-yellow-600 dark:text-yellow-400">Devis Brouillons</p>
                    <p className="text-xl font-bold text-yellow-900 dark:text-yellow-100">
                      {formatNumber(quoteStats.draftQuotes)} ({((quoteStats.draftQuotes / quoteStats.totalQuotes) * 100).toFixed(1)}%)
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-green-50 dark:bg-green-900/20 p-4 rounded-lg">
                <div className="flex items-center space-x-3">
                  <div className="w-4 h-4 bg-green-500 rounded-full"></div>
                  <div>
                    <p className="text-sm text-green-600 dark:text-green-400">Devis Finalisés</p>
                    <p className="text-xl font-bold text-green-900 dark:text-green-100">
                      {formatNumber(quoteStats.finalQuotes)} ({((quoteStats.finalQuotes / quoteStats.totalQuotes) * 100).toFixed(1)}%)
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Users Overview */}
      <div className="bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm rounded-2xl shadow-xl p-6">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-6 flex items-center space-x-2">
          <Users className="h-5 w-5" />
          <span>Utilisateurs du Système</span>
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg">
            <div className="flex items-center space-x-3">
              <Users className="h-8 w-8 text-blue-600 dark:text-blue-400" />
              <div>
                <p className="text-sm text-blue-600 dark:text-blue-400">Total Utilisateurs</p>
                <p className="text-2xl font-bold text-blue-900 dark:text-blue-100">
                  {formatNumber(users.length)}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-purple-50 dark:bg-purple-900/20 p-4 rounded-lg">
            <div className="flex items-center space-x-3">
              <Award className="h-8 w-8 text-purple-600 dark:text-purple-400" />
              <div>
                <p className="text-sm text-purple-600 dark:text-purple-400">Administrateurs</p>
                <p className="text-2xl font-bold text-purple-900 dark:text-purple-100">
                  {formatNumber(users.filter(u => u.is_admin).length)}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-emerald-50 dark:bg-emerald-900/20 p-4 rounded-lg">
            <div className="flex items-center space-x-3">
              <FileText className="h-8 w-8 text-emerald-600 dark:text-emerald-400" />
              <div>
                <p className="text-sm text-emerald-600 dark:text-emerald-400">Accès Devis</p>
                <p className="text-2xl font-bold text-emerald-900 dark:text-emerald-100">
                  {formatNumber(users.filter(u => u.can_create_quote).length)}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}