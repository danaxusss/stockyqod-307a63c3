import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { BarChart3, Download, Loader, Coins, TrendingUp, Moon } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { StatusPill } from '../../components/lists/StatusPill';
import { formatMoney } from '../../utils/format';
import type { Product, StockMovement } from '../../types';
import { StockService } from '../../utils/supabaseStock';
import { useToast } from '../../context/ToastContext';
import { useAccessibleLocations } from '../../inventory/hooks/useAccessibleLocations';

function fmt(n: number) { return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(n); }

interface Row {
  barcode: string; name: string; brand: string;
  qty: number; cmup: number; value: number; sellValue: number;
  soldQty: number; lastOut: string | null; margin: number;
}

const PERIODS = [
  { days: 30, label: '30 j' },
  { days: 90, label: '90 j' },
  { days: 365, label: '12 mois' },
];
const LONGEST_PERIOD_DAYS = Math.max(...PERIODS.map(p => p.days));

export default function StockReportsPage() {
  const { showToast } = useToast();
  const [products, setProducts] = useState<Product[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [periodDays, setPeriodDays] = useState(90);
  const [sortKey, setSortKey] = useState<'value' | 'soldQty' | 'margin'>('value');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Every sale and credit-note return of the longest period offered (the
      // API caps a single read at 1000 rows, which made busy items look dormant).
      const since = new Date(Date.now() - LONGEST_PERIOD_DAYS * 86400000).toISOString();
      const [p, out, returns] = await Promise.all([
        StockService.getProducts(),
        StockService.getAllMovements({ type: 'out', from: since }),
        StockService.getAllMovements({ type: 'return', sourceType: 'return', from: since }),
      ]);
      setProducts(p); setMovements([...out, ...returns]);
    } catch (e: any) {
      showToast({ type: 'error', message: e?.message || 'Erreur de chargement' });
    } finally { setLoading(false); }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  const { keyAllowed, filterLevels } = useAccessibleLocations();

  const rows = useMemo<Row[]>(() => {
    const since = Date.now() - periodDays * 86400000;
    const soldBy = new Map<string, number>();
    const lastOutBy = new Map<string, string>();
    for (const m of movements) {
      if (!keyAllowed(m.location_key)) continue;
      const t = new Date(m.created_at).getTime();
      if (m.type === 'out') {
        const last = lastOutBy.get(m.barcode);
        if (!last || last < m.created_at) lastOutBy.set(m.barcode, m.created_at);
      }
      // Goods returned on a credit note were not really sold.
      const sold = m.type === 'out' ? Math.abs(m.quantity) : -Math.abs(m.quantity);
      if (t >= since) soldBy.set(m.barcode, (soldBy.get(m.barcode) || 0) + sold);
    }
    soldBy.forEach((qty, barcode) => { if (qty < 0) soldBy.set(barcode, 0); });
    return products.map(p => {
      const qty = Object.values(filterLevels(p.stock_levels)).reduce((s, v) => s + (Number(v) || 0), 0);
      const cmup = Number(p.buyprice) || 0;
      const sell = Number(p.price) || 0;
      return {
        barcode: p.barcode, name: p.name, brand: p.brand || '',
        qty, cmup, value: qty * cmup, sellValue: qty * sell,
        soldQty: soldBy.get(p.barcode) || 0,
        lastOut: lastOutBy.get(p.barcode) || null,
        margin: sell - cmup,
      };
    });
  }, [products, movements, periodDays, keyAllowed, filterLevels]);

  const totals = useMemo(() => {
    const value = rows.reduce((s, r) => s + r.value, 0);
    const potential = rows.reduce((s, r) => s + r.sellValue, 0);
    const dormant = rows.filter(r => r.qty > 0 && (r.soldQty === 0)).length;
    return { value, potential, margin: potential - value, dormant };
  }, [rows]);

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => (b[sortKey] as number) - (a[sortKey] as number));
  }, [rows, sortKey]);

  const exportCsv = () => {
    const header = ['Code', 'Article', 'Marque', 'Qté', 'CMUP', 'Valeur stock', 'Prix vente', 'Valeur vente', `Vendu (${periodDays}j)`, 'Marge unit.', 'Dernière sortie'];
    const lines = sorted.map(r => [
      r.barcode, `"${r.name.replace(/"/g, '""')}"`, r.brand, r.qty, r.cmup.toFixed(2),
      r.value.toFixed(2), (r.cmup + r.margin).toFixed(2), r.sellValue.toFixed(2),
      r.soldQty, r.margin.toFixed(2), r.lastOut ? new Date(r.lastOut).toLocaleDateString('fr-FR') : '',
    ].join(';'));
    const csv = '﻿' + [header.join(';'), ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `valorisation-stock-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  const kpis = [
    { icon: Coins, label: 'Valeur du stock (CMUP)', value: formatMoney(totals.value), tone: 'text-primary bg-primary/10' },
    { icon: TrendingUp, label: 'Valeur de vente potentielle', value: formatMoney(totals.potential), tone: 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10' },
    { icon: BarChart3, label: 'Marge potentielle', value: formatMoney(totals.margin), tone: 'text-primary bg-primary/10' },
    { icon: Moon, label: `Articles dormants (${periodDays}j)`, value: String(totals.dormant), tone: 'text-amber-600 dark:text-amber-400 bg-amber-500/10' },
  ];

  const sortOptions = [['value', 'Valeur stock'], ['soldQty', `Vendu (${periodDays}j)`], ['margin', 'Marge']] as const;
  const segment = (active: boolean) => `min-h-9 px-3 text-sm font-medium transition-colors ${active ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:text-foreground'}`;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Valorisation & rapports"
        subtitle="Valeur du stock, rotation et articles dormants"
        actions={<>
          <div role="group" aria-label="Période" className="flex overflow-hidden rounded-lg border border-border">
            {PERIODS.map(p => (
              <button key={p.days} type="button" onClick={() => setPeriodDays(p.days)} aria-pressed={periodDays === p.days} className={segment(periodDays === p.days)}>
                {p.label}
              </button>
            ))}
          </div>
          <button type="button" onClick={exportCsv} className="flex min-h-10 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-semibold text-foreground hover:bg-secondary">
            <Download className="h-4 w-4" aria-hidden="true" /> CSV
          </button>
        </>}
      />

      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground"><Loader className="mr-2 h-5 w-5 animate-spin" />Chargement…</div>
      ) : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {kpis.map(k => (
              <div key={k.label} className="flex min-w-0 flex-col rounded-xl border border-border bg-card p-3 shadow-sm sm:p-4">
                <span className="flex min-w-0 items-center gap-2 text-[13px] font-medium text-muted-foreground sm:text-sm">
                  <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${k.tone}`}><k.icon className="h-4 w-4" aria-hidden="true" /></span>
                  <span className="truncate">{k.label}</span>
                </span>
                <span className="mt-2 truncate text-lg font-bold tabular-nums tracking-tight text-foreground sm:mt-3 sm:text-xl">{k.value}</span>
              </div>
            ))}
          </div>

          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3 sm:px-5">
              <h2 className="font-semibold text-foreground">Articles</h2>
              <span className="flex-1" />
              <span className="text-sm text-muted-foreground">Trier par</span>
              <div role="group" aria-label="Trier par" className="flex overflow-hidden rounded-lg border border-border">
                {sortOptions.map(([k, l]) => (
                  <button key={k} type="button" onClick={() => setSortKey(k)} aria-pressed={sortKey === k} className={segment(sortKey === k)}>{l}</button>
                ))}
              </div>
            </div>

            {/* Phones: one card per article */}
            <ul className="divide-y divide-border md:hidden">
              {sorted.slice(0, 300).map(r => {
                const dormant = r.qty > 0 && r.soldQty === 0;
                return (
                  <li key={r.barcode} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="line-clamp-2 font-medium text-foreground">{r.name}</p>
                        <p className="truncate text-xs text-muted-foreground"><span className="font-mono">{r.barcode}</span>{r.brand ? ` · ${r.brand}` : ''}</p>
                      </div>
                      <p className="shrink-0 font-semibold tabular-nums text-foreground">{formatMoney(r.value)}</p>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      {dormant && <StatusPill tone="warning" icon={<Moon className="h-3 w-3" aria-hidden="true" />}>Dormant</StatusPill>}
                      <span>Qté <span className="tabular-nums text-foreground">{fmt(r.qty)}</span></span>
                      <span>CMUP <span className="tabular-nums text-foreground">{fmt(r.cmup)}</span></span>
                      <span>Vendu <span className="tabular-nums text-foreground">{r.soldQty > 0 ? fmt(r.soldQty) : '—'}</span></span>
                      <span>Marge u. <span className={`tabular-nums ${r.margin < 0 ? 'text-red-700 dark:text-red-300' : 'text-foreground'}`}>{fmt(r.margin)}</span></span>
                      <span>Sortie {r.lastOut ? new Date(r.lastOut).toLocaleDateString('fr-FR') : '—'}</span>
                    </div>
                  </li>
                );
              })}
            </ul>

            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-secondary/40 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-2.5 text-left">Article</th>
                    <th className="px-4 py-2.5 text-right">Qté</th>
                    <th className="px-4 py-2.5 text-right">CMUP</th>
                    <th className="px-4 py-2.5 text-right">Valeur</th>
                    <th className="px-4 py-2.5 text-right">Vendu</th>
                    <th className="px-4 py-2.5 text-right">Marge u.</th>
                    <th className="px-4 py-2.5 text-left">Dern. sortie</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {sorted.slice(0, 300).map(r => {
                    const dormant = r.qty > 0 && r.soldQty === 0;
                    return (
                      <tr key={r.barcode} className="hover:bg-secondary/40">
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <div className="min-w-0">
                              <p className="max-w-[18rem] truncate font-medium text-foreground">{r.name}</p>
                              <p className="text-xs text-muted-foreground"><span className="font-mono">{r.barcode}</span>{r.brand ? ` · ${r.brand}` : ''}</p>
                            </div>
                            {dormant && <StatusPill tone="warning" icon={<Moon className="h-3 w-3" aria-hidden="true" />}>Dormant</StatusPill>}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{fmt(r.qty)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{fmt(r.cmup)}</td>
                        <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{fmt(r.value)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{r.soldQty > 0 ? fmt(r.soldQty) : '—'}</td>
                        <td className={`px-4 py-2.5 text-right tabular-nums ${r.margin < 0 ? 'text-red-700 dark:text-red-300' : 'text-foreground'}`}>{fmt(r.margin)}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">{r.lastOut ? new Date(r.lastOut).toLocaleDateString('fr-FR') : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
