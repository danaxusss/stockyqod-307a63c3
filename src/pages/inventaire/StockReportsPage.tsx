import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { BarChart3, Download, Loader, Coins, TrendingUp, Moon } from 'lucide-react';
import type { Product, StockMovement } from '../../types';
import { StockService } from '../../utils/supabaseStock';
import { useToast } from '../../context/ToastContext';
import { useAccessibleLocations } from '../../inventory/hooks/useAccessibleLocations';

function fmt(n: number) { return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(n); }
function fmtMad(n: number) { return fmt(n) + ' MAD'; }

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
      const [p, m] = await Promise.all([
        StockService.getProducts(),
        StockService.getMovements({ type: 'out', limit: 5000 }),
      ]);
      setProducts(p); setMovements(m);
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
      if (!lastOutBy.has(m.barcode)) lastOutBy.set(m.barcode, m.created_at);
      if (t >= since) soldBy.set(m.barcode, (soldBy.get(m.barcode) || 0) + Math.abs(m.quantity));
    }
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
    { icon: Coins, label: 'Valeur du stock (CMUP)', value: fmtMad(totals.value), tone: 'text-primary bg-primary/10' },
    { icon: TrendingUp, label: 'Valeur de vente potentielle', value: fmtMad(totals.potential), tone: 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10' },
    { icon: BarChart3, label: 'Marge potentielle', value: fmtMad(totals.margin), tone: 'text-primary bg-primary/10' },
    { icon: Moon, label: `Articles dormants (${periodDays}j)`, value: String(totals.dormant), tone: 'text-amber-600 dark:text-amber-400 bg-amber-500/10' },
  ];

  return (
    <div className="max-w-6xl mx-auto py-6 px-3">
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-primary/10"><BarChart3 className="h-5 w-5 text-primary" /></div>
          <div>
            <h1 className="text-lg font-bold text-foreground leading-tight">Valorisation & rotation</h1>
            <p className="text-xs text-muted-foreground">Valeur du stock, rotation et articles dormants</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-border overflow-hidden">
            {PERIODS.map(p => (
              <button key={p.days} onClick={() => setPeriodDays(p.days)}
                className={`px-2.5 py-1.5 text-xs font-medium ${periodDays === p.days ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'}`}>
                {p.label}
              </button>
            ))}
          </div>
          <button onClick={exportCsv} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-secondary border border-border text-sm text-foreground">
            <Download className="h-3.5 w-3.5" /> CSV
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground"><Loader className="h-5 w-5 animate-spin mr-2" />Chargement…</div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            {kpis.map((k, i) => (
              <div key={i} className="bg-card border border-border/60 rounded-xl p-3">
                <div className={`inline-flex items-center justify-center w-8 h-8 rounded-lg mb-2 ${k.tone}`}><k.icon className="h-4 w-4" /></div>
                <div className="text-base font-bold text-foreground tabular-nums leading-tight">{k.value}</div>
                <div className="text-[11px] text-muted-foreground">{k.label}</div>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2 mb-2 text-xs">
            <span className="text-muted-foreground">Trier par :</span>
            {([['value', 'Valeur stock'], ['soldQty', `Vendu (${periodDays}j)`], ['margin', 'Marge']] as const).map(([k, l]) => (
              <button key={k} onClick={() => setSortKey(k)}
                className={`px-2 py-1 rounded-md ${sortKey === k ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'}`}>{l}</button>
            ))}
          </div>

          <div className="bg-card border border-border/60 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/60 bg-secondary/50 text-xs text-muted-foreground">
                    <th className="text-left font-medium px-3 py-2.5">Article</th>
                    <th className="text-right font-medium px-3 py-2.5">Qté</th>
                    <th className="text-right font-medium px-3 py-2.5">CMUP</th>
                    <th className="text-right font-medium px-3 py-2.5">Valeur</th>
                    <th className="text-right font-medium px-3 py-2.5">Vendu</th>
                    <th className="text-right font-medium px-3 py-2.5">Marge u.</th>
                    <th className="text-left font-medium px-3 py-2.5">Dern. sortie</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.slice(0, 300).map(r => {
                    const dormant = r.qty > 0 && r.soldQty === 0;
                    return (
                      <tr key={r.barcode} className="border-b border-border/40 hover:bg-secondary/30">
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            {dormant && <span title="Dormant" className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />}
                            <div className="min-w-0">
                              <div className="font-medium text-foreground truncate max-w-[260px]">{r.name}</div>
                              <div className="text-[10px] text-muted-foreground font-mono">{r.barcode}{r.brand ? ` · ${r.brand}` : ''}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmt(r.qty)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{fmt(r.cmup)}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmt(r.value)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.soldQty > 0 ? fmt(r.soldQty) : '—'}</td>
                        <td className={`px-3 py-2 text-right tabular-nums ${r.margin < 0 ? 'text-red-600 dark:text-red-400' : 'text-foreground'}`}>{fmt(r.margin)}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{r.lastOut ? new Date(r.lastOut).toLocaleDateString('fr-FR') : '—'}</td>
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
