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
import { PageHeader, Panel } from '../components/PageHeader';
import { EmptyState, KpiTile, LoadingState, panel } from '../components/backoffice/BackOfficeUi';

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
      <div className="mx-auto max-w-[110rem]">
        <div className={panel}>
          <EmptyState icon={BarChart3} title={<span className="text-base font-semibold">Accès Refusé</span>}
            hint="Vous devez être administrateur pour accéder aux statistiques." />
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
      const totalStock = (Object.values(product.stock_levels || {}) as number[]).reduce((sum, level) => sum + (Number(level) || 0), 0);
      if (totalStock < 5) {
        lowStockProducts++;
      }

      // Product values for top products
      productValues.push({
        name: product.name,
        brand: product.brand || 'Sans marque',
        value: (totalStock as number) * (product.price || 0)
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
    return <LoadingState label="Chargement des statistiques..." />;
  }

  const listRow = 'flex items-center justify-between gap-3 px-4 py-2.5 text-sm sm:px-5';
  const subTitle = (Icon: typeof Package, label: string) => (
    <span className="flex items-center gap-2"><Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />{label}</span>
  );
  const rankTone = (index: number) => index === 0 ? 'bg-amber-500 text-white' : index === 1 ? 'bg-slate-400 text-white' : index === 2 ? 'bg-orange-600 text-white' : 'bg-secondary text-muted-foreground ring-1 ring-inset ring-border';
  const share = (n: number) => quoteStats && quoteStats.totalQuotes ? (n / quoteStats.totalQuotes) * 100 : 0;

  return (
    <div className="mx-auto max-w-[110rem] space-y-6">
      <PageHeader title="Statistiques" subtitle="Vue d'ensemble inventaire & activité" />

      {/* Product & Inventory Statistics */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
          <Package className="h-4 w-4 text-primary" /><span>Produits & Inventaire</span>
        </h2>

        {productStats && (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <KpiTile icon={Package} tone="text-blue-600 bg-blue-500/10 dark:text-blue-400" label="Produits" value={formatNumber(productStats.totalProducts)} />
              <KpiTile icon={DollarSign} tone="text-emerald-600 bg-emerald-500/10 dark:text-emerald-400" label="Valeur Stock" value={`${formatCurrency(productStats.totalStockValue)} Dh`} />
              <KpiTile icon={Building} tone="text-orange-600 bg-orange-500/10 dark:text-orange-400" label="Marques" value={productStats.brandDistribution.length} />
              <KpiTile icon={Target} tone="text-red-600 bg-red-500/10 dark:text-red-400" label="Stock Faible" value={formatNumber(productStats.lowStockProducts)} />
            </div>

            <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
              <Panel title={subTitle(MapPin, 'Stock par Emplacement')}>
                <ul className="divide-y divide-border">
                  {productStats.stockByLocation.slice(0, 5).map((location) => (
                    <li key={location.location} className={listRow}>
                      <div className="min-w-0">
                        <p className="truncate font-medium capitalize text-foreground">{location.location.replace(/_/g, ' ')}</p>
                        <p className="text-xs text-muted-foreground">{formatNumber(location.count)} articles</p>
                      </div>
                      <p className="shrink-0 font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">{formatCurrency(location.value)} Dh</p>
                    </li>
                  ))}
                </ul>
              </Panel>
              <Panel title={subTitle(Building, 'Top Marques')}>
                <ul className="divide-y divide-border">
                  {productStats.brandDistribution.slice(0, 5).map((brand) => (
                    <li key={brand.brand} className={listRow}>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-foreground">{brand.brand}</p>
                        <p className="text-xs text-muted-foreground">{formatNumber(brand.count)} produits</p>
                        <span className="mt-1.5 block h-1.5 w-full max-w-[16rem] overflow-hidden rounded-full bg-secondary" aria-hidden="true">
                          <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.min(100, brand.percentage)}%` }} />
                        </span>
                      </div>
                      <p className="shrink-0 font-semibold tabular-nums text-foreground">{brand.percentage.toFixed(1)}%</p>
                    </li>
                  ))}
                </ul>
              </Panel>
            </div>
          </>
        )}
      </section>

      {/* Sellers & Quotes */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
          <FileText className="h-4 w-4 text-primary" /><span>Vendeurs & Devis</span>
        </h2>

        {quoteStats && (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <KpiTile icon={FileText} label="Total Devis" value={formatNumber(quoteStats.totalQuotes)} />
              <KpiTile icon={DollarSign} tone="text-emerald-600 bg-emerald-500/10 dark:text-emerald-400" label="Valeur Totale" value={`${formatCurrency(quoteStats.totalValue)} Dh`} />
              <KpiTile icon={TrendingUp} label="Moy." value={`${formatCurrency(quoteStats.averageQuoteValue)} Dh`} />
              <KpiTile icon={Calendar} tone="text-amber-600 bg-amber-500/10 dark:text-amber-400" label="Ce Mois" value={formatNumber(quoteStats.quotesThisMonth)} />
            </div>

            <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
              <Panel title={subTitle(Award, 'Top Vendeurs')}>
                <ul className="divide-y divide-border">
                  {quoteStats.topSellers.map((seller, index) => (
                    <li key={seller.name} className={listRow}>
                      <div className="flex min-w-0 items-center gap-3">
                        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${rankTone(index)}`}>{index + 1}</span>
                        <div className="min-w-0">
                          <p className="truncate font-medium text-foreground">{seller.name}</p>
                          <p className="text-xs text-muted-foreground">{formatNumber(seller.quotesCount)} devis</p>
                        </div>
                      </div>
                      <p className="shrink-0 font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">{formatCurrency(seller.totalValue)} Dh</p>
                    </li>
                  ))}
                </ul>
              </Panel>
              <Panel title={subTitle(Activity, 'Activité Récente')}>
                <ul className="max-h-72 divide-y divide-border overflow-y-auto">
                  {quoteStats.recentActivity.map((activity, index) => (
                    <li key={index} className="flex items-start gap-3 px-4 py-2.5 sm:px-5">
                      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground">{activity.action}</p>
                        <p className="truncate text-xs text-muted-foreground">{activity.details}</p>
                        <p className="text-xs text-muted-foreground">{activity.date.toLocaleDateString('fr-FR')} à {activity.date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </Panel>
            </div>

            {/* Status Distribution */}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className={`${panel} p-4`}>
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-sm font-medium text-muted-foreground"><span className="h-2.5 w-2.5 rounded-full bg-amber-500" aria-hidden="true" />En attente</span>
                  <span className="text-base font-bold tabular-nums text-foreground">{formatNumber(quoteStats.draftQuotes)} ({((quoteStats.draftQuotes / quoteStats.totalQuotes) * 100).toFixed(1)}%)</span>
                </div>
                <span className="mt-3 block h-2 overflow-hidden rounded-full bg-secondary" aria-hidden="true"><span className="block h-full rounded-full bg-amber-500" style={{ width: `${share(quoteStats.draftQuotes)}%` }} /></span>
              </div>
              <div className={`${panel} p-4`}>
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-sm font-medium text-muted-foreground"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" aria-hidden="true" />Finalisés</span>
                  <span className="text-base font-bold tabular-nums text-foreground">{formatNumber(quoteStats.finalQuotes)} ({((quoteStats.finalQuotes / quoteStats.totalQuotes) * 100).toFixed(1)}%)</span>
                </div>
                <span className="mt-3 block h-2 overflow-hidden rounded-full bg-secondary" aria-hidden="true"><span className="block h-full rounded-full bg-emerald-500" style={{ width: `${share(quoteStats.finalQuotes)}%` }} /></span>
              </div>
            </div>
          </>
        )}
      </section>

      {/* Users Overview */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
          <Users className="h-4 w-4 text-primary" /><span>Utilisateurs</span>
        </h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <KpiTile icon={Users} tone="text-blue-600 bg-blue-500/10 dark:text-blue-400" label="Total" value={formatNumber(users.length)} />
          <KpiTile icon={Award} label="Admins" value={formatNumber(users.filter(u => u.is_admin).length)} />
          <div className="col-span-2 md:col-span-1">
            <KpiTile icon={FileText} tone="text-emerald-600 bg-emerald-500/10 dark:text-emerald-400" label="Accès Devis" value={formatNumber(users.filter(u => u.can_create_quote).length)} />
          </div>
        </div>
      </section>
    </div>
  );
}
