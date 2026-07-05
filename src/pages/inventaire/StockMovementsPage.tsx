import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { ArrowLeftRight, Loader, Search } from 'lucide-react';
import type { Product, StockLocation, StockMovement, StockMovementType } from '../../types';
import { StockService } from '../../utils/supabaseStock';
import { StockLocationsService } from '../../utils/supabaseStockLocations';
import { useToast } from '../../context/ToastContext';

function fmt(n: number) {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(n);
}

const MOVEMENT_LABELS: Record<string, string> = {
  in: 'Entrée', out: 'Sortie', adjustment: 'Ajustement', count: 'Inventaire',
  transfer_in: 'Transfert +', transfer_out: 'Transfert −', return: 'Retour',
};
const SOURCE_LABELS: Record<string, string> = {
  manual: 'Manuel', bl: 'Bon de livraison', invoice: 'Facture', receipt: 'Réception',
  transfer: 'Transfert', count: 'Inventaire', return: 'Retour',
};
const TYPE_OPTIONS: { value: StockMovementType | ''; label: string }[] = [
  { value: '', label: 'Tous les types' },
  { value: 'in', label: 'Entrées' },
  { value: 'out', label: 'Sorties' },
  { value: 'adjustment', label: 'Ajustements' },
  { value: 'count', label: 'Inventaires' },
  { value: 'transfer_in', label: 'Transferts (entrée)' },
  { value: 'transfer_out', label: 'Transferts (sortie)' },
  { value: 'return', label: 'Retours' },
];

export default function StockMovementsPage() {
  const { showToast } = useToast();
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [products, setProducts] = useState<Map<string, Product>>(new Map());
  const [locations, setLocations] = useState<StockLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [type, setType] = useState<StockMovementType | ''>('');
  const [query, setQuery] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const resolve = useCallback((key: string): string => {
    const loc = locations.find(l => l.abbreviation === key || l.name === key || l.name.toLowerCase().replace(/\s+/g, '_') === key);
    return loc?.name || key.replace(/_/g, ' ');
  }, [locations]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [m, prods, locs] = await Promise.all([
        StockService.getMovements({
          type: type || undefined,
          from: from ? new Date(from).toISOString() : undefined,
          to: to ? new Date(to + 'T23:59:59').toISOString() : undefined,
          limit: 800,
        }),
        StockService.getProducts(),
        StockLocationsService.getStockLocations(),
      ]);
      setMovements(m);
      setProducts(new Map(prods.map(p => [p.barcode, p])));
      setLocations(locs);
    } catch (e: any) {
      showToast({ type: 'error', message: e?.message || 'Erreur de chargement' });
    } finally { setLoading(false); }
  }, [type, from, to, showToast]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return movements;
    return movements.filter(m => {
      const p = products.get(m.barcode);
      return m.barcode.toLowerCase().includes(q)
        || (p?.name || '').toLowerCase().includes(q)
        || (m.reason || '').toLowerCase().includes(q);
    });
  }, [movements, query, products]);

  return (
    <div className="max-w-6xl mx-auto py-6 px-3">
      <div className="flex items-center gap-2 mb-4">
        <div className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-primary/10">
          <ArrowLeftRight className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-foreground leading-tight">Mouvements de stock</h1>
          <p className="text-xs text-muted-foreground">Journal de toutes les entrées, sorties et ajustements</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-end gap-2 mb-4 flex-wrap">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Article, code, motif…"
            className="pl-8 pr-3 py-2 text-sm rounded-lg bg-secondary border border-border w-56 focus:outline-none focus:ring-2 focus:ring-primary/30" />
        </div>
        <select value={type} onChange={e => setType(e.target.value as StockMovementType | '')}
          className="px-3 py-2 text-sm rounded-lg bg-secondary border border-border focus:outline-none focus:ring-2 focus:ring-primary/30">
          {TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <div className="flex items-center gap-1">
          <input type="date" value={from} onChange={e => setFrom(e.target.value)}
            className="px-2 py-2 text-sm rounded-lg bg-secondary border border-border focus:outline-none focus:ring-2 focus:ring-primary/30" />
          <span className="text-muted-foreground text-xs">→</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)}
            className="px-2 py-2 text-sm rounded-lg bg-secondary border border-border focus:outline-none focus:ring-2 focus:ring-primary/30" />
        </div>
      </div>

      <div className="bg-card border border-border/60 rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground"><Loader className="h-5 w-5 animate-spin mr-2" />Chargement…</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60 bg-secondary/50 text-xs text-muted-foreground">
                  <th className="text-left font-medium px-3 py-2.5">Date</th>
                  <th className="text-left font-medium px-3 py-2.5">Article</th>
                  <th className="text-left font-medium px-3 py-2.5">Emplacement</th>
                  <th className="text-left font-medium px-3 py-2.5">Type</th>
                  <th className="text-right font-medium px-3 py-2.5">Qté</th>
                  <th className="text-right font-medium px-3 py-2.5">Solde</th>
                  <th className="text-left font-medium px-3 py-2.5">Origine</th>
                  <th className="text-left font-medium px-3 py-2.5">Par</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(m => {
                  const p = products.get(m.barcode);
                  return (
                    <tr key={m.id} className="border-b border-border/40 hover:bg-secondary/30">
                      <td className="px-3 py-2 whitespace-nowrap text-xs text-muted-foreground">{new Date(m.created_at).toLocaleString('fr-FR')}</td>
                      <td className="px-3 py-2">
                        <div className="font-medium text-foreground truncate max-w-[220px]">{p?.name || m.barcode}</div>
                        <div className="text-[10px] text-muted-foreground font-mono">{m.barcode}</div>
                      </td>
                      <td className="px-3 py-2 text-xs">{resolve(m.location_key)}</td>
                      <td className="px-3 py-2 text-xs">{MOVEMENT_LABELS[m.type] || m.type}{m.reason ? <span className="text-muted-foreground"> · {m.reason}</span> : ''}</td>
                      <td className={`px-3 py-2 text-right tabular-nums font-semibold ${m.quantity >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                        {m.quantity >= 0 ? '+' : ''}{fmt(m.quantity)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{m.balance_after != null ? fmt(m.balance_after) : '—'}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{SOURCE_LABELS[m.source_type] || m.source_type}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{m.created_by || '—'}</td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan={8} className="px-3 py-10 text-center text-muted-foreground">Aucun mouvement</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
