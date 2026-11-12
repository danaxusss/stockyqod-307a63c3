import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import { Package, AlertTriangle, Boxes, ArrowLeftRight, Loader, Coins, ArrowRight, PackagePlus, ClipboardCheck, ShoppingCart, type LucideIcon } from 'lucide-react';
import type { Product, StockMovement, ProductStockSetting } from '../../types';
import { StockService } from '../../utils/supabaseStock';
import { useToast } from '../../context/ToastContext';
import { useAccessibleLocations } from '../../inventory/hooks/useAccessibleLocations';
import { PageHeader, Panel } from '../../components/PageHeader';
import { formatMoney } from '../../utils/format';

function fmt(n: number) {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n);
}

/** A figure that leads to the page where it can be acted on. */
function Kpi({ to, icon: Icon, tone, label, value, cta }: { to: string; icon: LucideIcon; tone: string; label: string; value: ReactNode; cta: string }) {
  return (
    <Link to={to} className="group flex h-full min-w-0 flex-col rounded-xl border border-border bg-card p-3 shadow-sm transition hover:border-primary/40 hover:shadow-md sm:p-4">
      <span className="flex min-w-0 items-center gap-2 text-[13px] font-medium text-muted-foreground sm:text-sm">
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${tone}`}><Icon className="h-4 w-4" aria-hidden="true" /></span>
        <span className="truncate">{label}</span>
      </span>
      <span className="mt-2 truncate text-lg font-bold tabular-nums tracking-tight text-foreground sm:mt-3 sm:text-2xl">{value}</span>
      <span className="mt-3 hidden items-center gap-1 text-sm font-semibold text-primary sm:flex">{cta}<ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" aria-hidden="true" /></span>
    </Link>
  );
}

function isToday(iso: string) {
  const d = new Date(iso); const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}

export default function StockDashboardPage() {
  const { showToast } = useToast();
  const [products, setProducts] = useState<Product[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [settings, setSettings] = useState<ProductStockSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const { keyAllowed, filterLevels } = useAccessibleLocations();

  const accTotal = useCallback((p: Product) => Object.values(filterLevels(p.stock_levels)).reduce((s, v) => s + (Number(v) || 0), 0), [filterLevels]);
  const accValue = useCallback((p: Product) => accTotal(p) * (Number(p.buyprice) || 0), [accTotal]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, m, s] = await Promise.all([
        StockService.getProducts(),
        StockService.getMovements({ limit: 200 }),
        StockService.getStockSettings().catch(() => []),
      ]);
      setProducts(p); setMovements(m); setSettings(s);
    } catch (e: any) {
      showToast({ type: 'error', message: e?.message || 'Erreur de chargement' });
    } finally { setLoading(false); }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  const reorderByBarcode = useMemo(() => {
    const map = new Map<string, number>();
    settings.filter(s => !s.location_key).forEach(s => map.set(s.barcode, s.reorder_point));
    return map;
  }, [settings]);

  const stats = useMemo(() => {
    const totalValue = products.reduce((s, p) => s + accValue(p), 0);
    const outOfStock = products.filter(p => accTotal(p) <= 0).length;
    const lowStock = products.filter(p => {
      const rp = reorderByBarcode.get(p.barcode);
      return rp != null && accTotal(p) <= rp;
    });
    const todayMoves = movements.filter(m => isToday(m.created_at) && keyAllowed(m.location_key)).length;
    const skuInStock = products.filter(p => accTotal(p) > 0).length;
    return { totalValue, outOfStock, lowStock, todayMoves, skuInStock };
  }, [products, movements, reorderByBarcode, accValue, accTotal, keyAllowed]);

  const kpis = [
    { to: '/inventaire/rapports', icon: Coins, label: 'Valeur du stock (CMUP)', value: formatMoney(stats.totalValue), tone: 'text-primary bg-primary/10', cta: 'Valorisation' },
    { to: '/inventaire/niveaux', icon: Boxes, label: 'Réf. en stock', value: fmt(stats.skuInStock), tone: 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10', cta: 'Niveaux de stock' },
    { to: '/inventaire/niveaux', icon: AlertTriangle, label: 'Sous le seuil', value: fmt(stats.lowStock.length), tone: 'text-amber-600 dark:text-amber-400 bg-amber-500/10', cta: 'Voir les articles' },
    { to: '/inventaire/niveaux', icon: Package, label: 'Ruptures', value: fmt(stats.outOfStock), tone: 'text-red-600 dark:text-red-400 bg-red-500/10', cta: 'Voir les articles' },
    { to: '/inventaire/mouvements', icon: ArrowLeftRight, label: 'Mouvements aujourd\'hui', value: fmt(stats.todayMoves), tone: 'text-primary bg-primary/10', cta: 'Journal' },
  ];
  const visibleMovements = movements.filter(m => keyAllowed(m.location_key));
  const productName = new Map(products.map(p => [p.barcode, p.name]));
  const quickLink = 'flex min-h-10 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-semibold text-foreground hover:bg-secondary';

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Stock"
        subtitle="Vue d’ensemble de l’inventaire"
        actions={<>
          <Link to="/inventaire/reception" className={quickLink}><PackagePlus className="h-4 w-4 text-primary" aria-hidden="true" />Réception</Link>
          <Link to="/inventaire/transfert" className={quickLink}><ArrowLeftRight className="h-4 w-4 text-primary" aria-hidden="true" />Transfert</Link>
          <Link to="/inventaire/inventaire" className={quickLink}><ClipboardCheck className="h-4 w-4 text-primary" aria-hidden="true" />Inventaire</Link>
          <Link to="/inventaire/niveaux" className="flex min-h-10 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90"><Boxes className="h-4 w-4" aria-hidden="true" />Niveaux de stock</Link>
        </>}
      />

      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground"><Loader className="mr-2 h-5 w-5 animate-spin" />Chargement…</div>
      ) : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-5">
            {kpis.map((k, i) => <div key={k.label} className={i === 0 ? 'col-span-2 md:col-span-1' : ''}><Kpi {...k} /></div>)}
          </div>

          <div className="grid items-start gap-4 lg:grid-cols-2">
            <Panel
              title={<span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-500" aria-hidden="true" />Réapprovisionnement</span>}
              action={stats.lowStock.length > 0 ? (
                <Link
                  to="/inventaire/commandes"
                  state={{ prefillBarcodes: stats.lowStock.map(p => p.barcode) }}
                  className="flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-primary hover:bg-primary/10"
                >
                  <ShoppingCart className="h-4 w-4" aria-hidden="true" /><span className="sm:hidden">Commander</span><span className="hidden sm:inline">Créer un bon de commande</span>
                </Link>
              ) : undefined}
            >
              {stats.lowStock.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-muted-foreground sm:px-5">Aucun article sous le seuil. Définissez des seuils dans Niveaux de stock.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {stats.lowStock.slice(0, 12).map(p => (
                    <li key={p.barcode} className="flex items-center justify-between gap-3 px-4 py-2.5 sm:px-5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">{p.name}</p>
                        <p className="truncate font-mono text-xs text-muted-foreground">{p.barcode}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-sm font-bold tabular-nums text-amber-700 dark:text-amber-300">{accTotal(p)}</p>
                        <p className="text-xs text-muted-foreground">seuil {reorderByBarcode.get(p.barcode)}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel
              title={<span className="flex items-center gap-2"><ArrowLeftRight className="h-4 w-4 text-primary" aria-hidden="true" />Derniers mouvements</span>}
              action={<Link to="/inventaire/mouvements" className="text-sm font-semibold text-primary hover:underline">Tout voir</Link>}
            >
              {visibleMovements.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-muted-foreground sm:px-5">Aucun mouvement enregistré.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {visibleMovements.slice(0, 12).map(m => (
                    <li key={m.id} className="flex items-center justify-between gap-3 px-4 py-2.5 sm:px-5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">{productName.get(m.barcode) || m.barcode}</p>
                        <p className="truncate text-xs text-muted-foreground"><span className="font-mono">{m.barcode}</span> · {new Date(m.created_at).toLocaleString('fr-FR')}</p>
                      </div>
                      <span className={`shrink-0 text-sm font-semibold tabular-nums ${m.quantity >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`}>
                        {m.quantity >= 0 ? '+' : ''}{m.quantity}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}
