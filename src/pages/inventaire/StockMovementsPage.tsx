import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Loader, Search } from 'lucide-react';
import type { Product, StockLocation, StockMovement, StockMovementType } from '../../types';
import { StockService } from '../../utils/supabaseStock';
import { StockLocationsService } from '../../utils/supabaseStockLocations';
import { useToast } from '../../context/ToastContext';
import { useAccessibleLocations } from '../../inventory/hooks/useAccessibleLocations';
import { PageHeader } from '../../components/PageHeader';
import { StatusPill, type StatusTone } from '../../components/lists/StatusPill';

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
// Colour of each movement type: stock coming in, going out, or corrected.
const MOVEMENT_TONES: Record<string, StatusTone> = {
  in: 'success', return: 'success', transfer_in: 'info', out: 'danger', transfer_out: 'info',
  adjustment: 'warning', count: 'warning',
};

const field = 'h-10 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring';

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
          // With a time the date is local (like "to"); alone it would be UTC midnight.
          from: from ? new Date(from + 'T00:00:00').toISOString() : undefined,
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

  const { keyAllowed } = useAccessibleLocations();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return movements.filter(m => {
      if (!keyAllowed(m.location_key)) return false;
      if (!q) return true;
      const p = products.get(m.barcode);
      return m.barcode.toLowerCase().includes(q)
        || (p?.name || '').toLowerCase().includes(q)
        || (m.reason || '').toLowerCase().includes(q);
    });
  }, [movements, query, products, keyAllowed]);

  const qtyClass = (q: number) => q >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300';

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Mouvements de stock"
        subtitle={loading ? 'Journal des entrées, sorties et ajustements' : `${filtered.length} mouvement${filtered.length !== 1 ? 's' : ''} · entrées, sorties et ajustements`}
      >
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3 shadow-sm">
          <div className="relative min-w-0 flex-1 basis-56">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Article, code, motif…" aria-label="Rechercher un mouvement"
              className={`${field} w-full pl-9`} />
          </div>
          <select value={type} onChange={e => setType(e.target.value as StockMovementType | '')} aria-label="Type de mouvement" className={field}>
            {TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <div className="flex w-full items-center gap-1.5 sm:w-auto">
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} aria-label="Du" className={`${field} min-w-0 flex-1`} />
            <span className="text-sm text-muted-foreground" aria-hidden="true">→</span>
            <input type="date" value={to} onChange={e => setTo(e.target.value)} aria-label="Au" className={`${field} min-w-0 flex-1`} />
          </div>
        </div>
      </PageHeader>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground"><Loader className="mr-2 h-5 w-5 animate-spin" />Chargement…</div>
        ) : filtered.length === 0 ? (
          <p className="px-4 py-12 text-center text-sm text-muted-foreground">Aucun mouvement</p>
        ) : (
          <>
            {/* Phones: one card per movement */}
            <ul className="divide-y divide-border md:hidden">
              {filtered.map(m => {
                const p = products.get(m.barcode);
                return (
                  <li key={m.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-foreground">{p?.name || m.barcode}</p>
                        <p className="truncate font-mono text-xs text-muted-foreground">{m.barcode}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className={`font-semibold tabular-nums ${qtyClass(m.quantity)}`}>{m.quantity >= 0 ? '+' : ''}{fmt(m.quantity)}</p>
                        {m.balance_after != null && <p className="text-xs tabular-nums text-muted-foreground">→ {fmt(m.balance_after)}</p>}
                      </div>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      <StatusPill tone={MOVEMENT_TONES[m.type] || 'neutral'}>{MOVEMENT_LABELS[m.type] || m.type}</StatusPill>
                      <span>{resolve(m.location_key)}</span>
                      <span>· {SOURCE_LABELS[m.source_type] || m.source_type}</span>
                    </div>
                    {m.reason && <p className="mt-1 text-xs text-muted-foreground">{m.reason}</p>}
                    <p className="mt-1 text-xs text-muted-foreground">{new Date(m.created_at).toLocaleString('fr-FR')}{m.created_by ? ` · ${m.created_by}` : ''}</p>
                  </li>
                );
              })}
            </ul>

            {/* Wider screens: the journal as a table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-secondary/40 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-2.5 text-left">Date</th>
                    <th className="px-4 py-2.5 text-left">Article</th>
                    <th className="px-4 py-2.5 text-left">Emplacement</th>
                    <th className="px-4 py-2.5 text-left">Type</th>
                    <th className="px-4 py-2.5 text-right">Qté</th>
                    <th className="px-4 py-2.5 text-right">Solde</th>
                    <th className="px-4 py-2.5 text-left">Origine</th>
                    <th className="px-4 py-2.5 text-left">Par</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map(m => {
                    const p = products.get(m.barcode);
                    return (
                      <tr key={m.id} className="hover:bg-secondary/40">
                        <td className="whitespace-nowrap px-4 py-2.5 text-xs text-muted-foreground">{new Date(m.created_at).toLocaleString('fr-FR')}</td>
                        <td className="px-4 py-2.5">
                          <p className="max-w-[16rem] truncate font-medium text-foreground">{p?.name || m.barcode}</p>
                          <p className="font-mono text-xs text-muted-foreground">{m.barcode}</p>
                        </td>
                        <td className="px-4 py-2.5 text-foreground">{resolve(m.location_key)}</td>
                        <td className="px-4 py-2.5">
                          <StatusPill tone={MOVEMENT_TONES[m.type] || 'neutral'}>{MOVEMENT_LABELS[m.type] || m.type}</StatusPill>
                          {m.reason && <p className="mt-0.5 max-w-[14rem] truncate text-xs text-muted-foreground" title={m.reason}>{m.reason}</p>}
                        </td>
                        <td className={`px-4 py-2.5 text-right font-semibold tabular-nums ${qtyClass(m.quantity)}`}>
                          {m.quantity >= 0 ? '+' : ''}{fmt(m.quantity)}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{m.balance_after != null ? fmt(m.balance_after) : '—'}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">{SOURCE_LABELS[m.source_type] || m.source_type}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">{m.created_by || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
