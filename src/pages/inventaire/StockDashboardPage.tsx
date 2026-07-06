import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Package, AlertTriangle, TrendingUp, Boxes, ArrowLeftRight, Loader, Coins } from 'lucide-react';
import type { Product, StockMovement, ProductStockSetting } from '../../types';
import { StockService, totalStock, stockValue } from '../../utils/supabaseStock';
import { useToast } from '../../context/ToastContext';

function fmt(n: number) {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n);
}
function fmtMad(n: number) {
  return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) + ' MAD';
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
    const totalValue = products.reduce((s, p) => s + stockValue(p), 0);
    const outOfStock = products.filter(p => totalStock(p) <= 0).length;
    const lowStock = products.filter(p => {
      const rp = reorderByBarcode.get(p.barcode);
      return rp != null && totalStock(p) <= rp;
    });
    const todayMoves = movements.filter(m => isToday(m.created_at)).length;
    const skuInStock = products.filter(p => totalStock(p) > 0).length;
    return { totalValue, outOfStock, lowStock, todayMoves, skuInStock };
  }, [products, movements, reorderByBarcode]);

  const kpis = [
    { icon: Coins, label: 'Valeur du stock (CMUP)', value: fmtMad(stats.totalValue), tone: 'text-primary bg-primary/10' },
    { icon: Boxes, label: 'Réf. en stock', value: fmt(stats.skuInStock), tone: 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10' },
    { icon: AlertTriangle, label: 'Sous le seuil', value: fmt(stats.lowStock.length), tone: 'text-amber-600 dark:text-amber-400 bg-amber-500/10' },
    { icon: Package, label: 'Ruptures', value: fmt(stats.outOfStock), tone: 'text-red-600 dark:text-red-400 bg-red-500/10' },
    { icon: ArrowLeftRight, label: 'Mouvements aujourd\'hui', value: fmt(stats.todayMoves), tone: 'text-violet-600 dark:text-violet-400 bg-violet-500/10' },
  ];

  return (
    <div className="max-w-6xl mx-auto py-6 px-3">
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-primary/10">
            <TrendingUp className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-foreground leading-tight">Tableau de bord — Stock</h1>
            <p className="text-xs text-muted-foreground">Vue d'ensemble de l'inventaire</p>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Link to="/inventaire/niveaux" className="px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium">Niveaux de stock</Link>
          <Link to="/inventaire/reception" className="px-3 py-2 rounded-lg bg-secondary text-foreground text-sm font-medium border border-border">Réception</Link>
          <Link to="/inventaire/transfert" className="px-3 py-2 rounded-lg bg-secondary text-foreground text-sm font-medium border border-border">Transfert</Link>
          <Link to="/inventaire/inventaire" className="px-3 py-2 rounded-lg bg-secondary text-foreground text-sm font-medium border border-border">Inventaire</Link>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground"><Loader className="h-5 w-5 animate-spin mr-2" />Chargement…</div>
      ) : (
        <>
          {/* KPI strip */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
            {kpis.map((k, i) => (
              <div key={i} className="bg-card border border-border/60 rounded-xl p-3">
                <div className={`inline-flex items-center justify-center w-8 h-8 rounded-lg mb-2 ${k.tone}`}>
                  <k.icon className="h-4 w-4" />
                </div>
                <div className="text-lg font-bold text-foreground tabular-nums leading-tight">{k.value}</div>
                <div className="text-[11px] text-muted-foreground">{k.label}</div>
              </div>
            ))}
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            {/* Low stock alerts */}
            <div className="bg-card border border-border/60 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                <h2 className="text-sm font-semibold text-foreground">Réapprovisionnement</h2>
              </div>
              {stats.lowStock.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">Aucun article sous le seuil. Définissez des seuils dans Niveaux de stock.</p>
              ) : (
                <div className="space-y-1.5">
                  {stats.lowStock.slice(0, 12).map(p => (
                    <div key={p.barcode} className="flex items-center justify-between px-3 py-2 rounded-lg bg-amber-500/[0.06] border border-amber-500/15">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-foreground truncate max-w-[220px]">{p.name}</div>
                        <div className="text-[10px] text-muted-foreground font-mono">{p.barcode}</div>
                      </div>
                      <div className="text-right shrink-0 ml-2">
                        <div className="text-sm font-bold text-amber-600 dark:text-amber-400 tabular-nums">{totalStock(p)}</div>
                        <div className="text-[10px] text-muted-foreground">seuil {reorderByBarcode.get(p.barcode)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Recent movements */}
            <div className="bg-card border border-border/60 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <ArrowLeftRight className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-semibold text-foreground">Derniers mouvements</h2>
              </div>
              {movements.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">Aucun mouvement enregistré.</p>
              ) : (
                <div className="space-y-1">
                  {movements.slice(0, 12).map(m => (
                    <div key={m.id} className="flex items-center justify-between px-3 py-1.5 rounded-lg hover:bg-secondary/40 text-xs">
                      <div className="min-w-0">
                        <div className="text-foreground truncate max-w-[200px] font-mono">{m.barcode}</div>
                        <div className="text-[10px] text-muted-foreground">{new Date(m.created_at).toLocaleString('fr-FR')}</div>
                      </div>
                      <div className={`font-semibold tabular-nums ${m.quantity >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                        {m.quantity >= 0 ? '+' : ''}{m.quantity}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
