import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Search, AlertTriangle, X, History, SlidersHorizontal, Loader, ChevronRight } from 'lucide-react';
import type { Product, StockLocation, StockMovement, ProductStockSetting } from '../../types';
import { StockService } from '../../utils/supabaseStock';
import { StockLocationsService } from '../../utils/supabaseStockLocations';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';
import { useAccessibleLocations } from '../../inventory/hooks/useAccessibleLocations';
import { findLevelKey, locationCandidates } from '../../inventory/lib/locationKeys';
import { PageHeader } from '../../components/PageHeader';
import { StatusPill } from '../../components/lists/StatusPill';

const field = 'h-10 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring';

function fmt(n: number) {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(n);
}

const MOVEMENT_LABELS: Record<string, string> = {
  in: 'Entrée', out: 'Sortie', adjustment: 'Ajustement', count: 'Inventaire',
  transfer_in: 'Transfert (entrée)', transfer_out: 'Transfert (sortie)', return: 'Retour',
};

/** Resolve a friendly label for a stock_levels key using the configured locations. */
function useLocationResolver(locations: StockLocation[]) {
  return useCallback((key: string): string => {
    const loc = locations.find(l =>
      l.abbreviation === key ||
      l.name === key ||
      l.name.toLowerCase().replace(/\s+/g, '_') === key
    );
    return loc?.name || key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }, [locations]);
}

export default function StockLevelsPage() {
  const { isSuperAdmin, isAdmin, isManager, currentUser, canAccessStockLocation } = useAuth();
  const { showToast } = useToast();
  const canWrite = isSuperAdmin || isAdmin || isManager;

  const [products, setProducts] = useState<Product[]>([]);
  const [locations, setLocations] = useState<StockLocation[]>([]);
  const [settings, setSettings] = useState<ProductStockSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [onlyLow, setOnlyLow] = useState(false);
  const [detail, setDetail] = useState<Product | null>(null);

  const resolve = useLocationResolver(locations);
  const { keyAllowed, filterLevels } = useAccessibleLocations();

  // Total across only the locations this user may see (branch scoping).
  const accessibleTotal = useCallback(
    (p: Product) => Object.values(filterLevels(p.stock_levels)).reduce((s, v) => s + (Number(v) || 0), 0),
    [filterLevels]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, l, s] = await Promise.all([
        StockService.getProducts(),
        StockLocationsService.getStockLocations(),
        StockService.getStockSettings().catch(() => []),
      ]);
      setProducts(p);
      setLocations(l);
      setSettings(s);
      // Keep the open drawer on fresh levels, or a second adjustment would be
      // computed from the first one's starting point.
      setDetail(current => current ? (p.find(x => x.barcode === current.barcode) ?? current) : current);
    } catch (e: any) {
      showToast({ type: 'error', message: e?.message || 'Erreur de chargement du stock' });
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  // Reorder point per barcode (location-agnostic setting = null location_key)
  const reorderByBarcode = useMemo(() => {
    const m = new Map<string, number>();
    settings.filter(s => !s.location_key).forEach(s => m.set(s.barcode, s.reorder_point));
    return m;
  }, [settings]);

  const isLow = useCallback((p: Product) => {
    const rp = reorderByBarcode.get(p.barcode);
    return rp != null && accessibleTotal(p) <= rp;
  }, [reorderByBarcode, accessibleTotal]);

  // Location keys present across products, filtered by what the user may see.
  const locationKeys = useMemo(() => {
    const keys = new Set<string>();
    products.forEach(p => Object.keys(p.stock_levels || {}).forEach(k => keys.add(k)));
    return Array.from(keys)
      .filter(k => keyAllowed(k))
      .sort((a, b) => resolve(a).localeCompare(resolve(b)));
  }, [products, keyAllowed, resolve]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter(p => {
      if (onlyLow && !isLow(p)) return false;
      if (!q) return true;
      return p.name.toLowerCase().includes(q)
        || p.barcode.toLowerCase().includes(q)
        || (p.brand || '').toLowerCase().includes(q);
    });
  }, [products, query, onlyLow, isLow]);

  const lowCount = useMemo(() => products.filter(isLow).length, [products, isLow]);

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Niveaux de stock"
        subtitle={`${products.length} articles · ${locationKeys.length} emplacements`}
      >
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3 shadow-sm">
          <div className="relative min-w-0 flex-1 basis-64">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Rechercher article, code, marque…"
              aria-label="Rechercher un article"
              className={`${field} w-full pl-9`}
            />
          </div>
          <button
            type="button"
            onClick={() => setOnlyLow(v => !v)}
            aria-pressed={onlyLow}
            className={`flex h-10 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors ${
              onlyLow ? 'border-amber-500/40 bg-amber-500/15 text-amber-800 dark:text-amber-300'
                      : 'border-border bg-card text-muted-foreground hover:text-foreground'
            }`}
            title="Afficher uniquement les articles sous le seuil"
          >
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            Sous seuil{lowCount > 0 ? ` (${lowCount})` : ''}
          </button>
        </div>
      </PageHeader>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader className="mr-2 h-5 w-5 animate-spin" /> Chargement…
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          {filtered.length === 0 ? (
            <p className="px-4 py-12 text-center text-sm text-muted-foreground">Aucun article</p>
          ) : (
            <>
              {/* Phones: a card per article, stock by location as chips */}
              <ul className="divide-y divide-border md:hidden">
                {filtered.map(p => {
                  const low = isLow(p);
                  const stocked = locationKeys.filter(k => Number(p.stock_levels?.[k] ?? 0) !== 0);
                  return (
                    <li key={p.barcode}>
                      <button type="button" onClick={() => setDetail(p)} className="flex w-full items-start gap-3 px-4 py-3 text-left active:bg-secondary">
                        <div className="min-w-0 flex-1">
                          <p className="line-clamp-2 font-medium text-foreground">{p.name}</p>
                          <p className="truncate text-xs text-muted-foreground"><span className="font-mono">{p.barcode}</span>{p.brand ? ` · ${p.brand}` : ''}</p>
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {low && <StatusPill tone="warning" icon={<AlertTriangle className="h-3 w-3" aria-hidden="true" />}>Sous le seuil</StatusPill>}
                            {stocked.map(k => (
                              <span key={k} className="rounded-md bg-secondary px-1.5 py-0.5 text-xs text-muted-foreground">
                                {resolve(k)} <span className="font-semibold tabular-nums text-foreground">{fmt(Number(p.stock_levels?.[k] ?? 0))}</span>
                              </span>
                            ))}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-lg font-bold tabular-nums text-foreground">{fmt(accessibleTotal(p))}</p>
                          <p className="text-xs text-muted-foreground">total</p>
                        </div>
                        <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      </button>
                    </li>
                  );
                })}
              </ul>

              {/* Wider screens: one column per location */}
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-secondary/40 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      <th className="px-4 py-2.5 text-left">Article</th>
                      {locationKeys.map(k => (
                        <th key={k} className="whitespace-nowrap px-3 py-2.5 text-right">{resolve(k)}</th>
                      ))}
                      <th className="px-4 py-2.5 text-right">Total</th>
                      <th className="w-10"><span className="sr-only">Historique</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filtered.map(p => {
                      const low = isLow(p);
                      return (
                        <tr
                          key={p.barcode}
                          onClick={() => setDetail(p)}
                          className="cursor-pointer transition-colors hover:bg-secondary/40"
                        >
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2">
                              <div className="min-w-0">
                                <p className="max-w-[18rem] truncate font-medium text-foreground">{p.name}</p>
                                <p className="text-xs text-muted-foreground"><span className="font-mono">{p.barcode}</span>{p.brand ? ` · ${p.brand}` : ''}</p>
                              </div>
                              {low && <StatusPill tone="warning" icon={<AlertTriangle className="h-3 w-3" aria-hidden="true" />}>Sous le seuil</StatusPill>}
                            </div>
                          </td>
                          {locationKeys.map(k => {
                            const v = Number(p.stock_levels?.[k] ?? 0);
                            return (
                              <td key={k} className={`px-3 py-2.5 text-right tabular-nums ${v <= 0 ? 'text-muted-foreground/60' : 'text-foreground'}`}>
                                {v === 0 ? '—' : fmt(v)}
                              </td>
                            );
                          })}
                          <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-foreground">{fmt(accessibleTotal(p))}</td>
                          <td className="px-2 text-muted-foreground"><History className="h-4 w-4" aria-label="Voir l’historique" /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {detail && (
        <ProductStockDrawer
          product={detail}
          locations={locations}
          resolve={resolve}
          keyAllowed={keyAllowed}
          canWrite={canWrite}
          currentUsername={currentUser?.username || null}
          onClose={() => setDetail(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}

// ── Product detail drawer: per-location levels, adjust, movement history ──────
function ProductStockDrawer({
  product, locations, resolve, keyAllowed, canWrite, currentUsername, onClose, onChanged,
}: {
  product: Product;
  locations: StockLocation[];
  resolve: (k: string) => string;
  keyAllowed: (k: string) => boolean;
  canWrite: boolean;
  currentUsername: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { showToast } = useToast();
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [adjustKey, setAdjustKey] = useState<string | null>(null);
  const [newQty, setNewQty] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [reorderPoint, setReorderPoint] = useState('');
  const [reorderSaving, setReorderSaving] = useState(false);

  const keys = useMemo(() => {
    const s = new Set<string>(Object.keys(product.stock_levels || {}));
    // A configured location the product has no stock key for yet; skipped when
    // the product already stores it under another spelling ("Dépôt" vs "DEP").
    locations.forEach(l => { if (!findLevelKey(product.stock_levels, locationCandidates(l))) s.add(l.abbreviation || l.name); });
    return Array.from(s).filter(k => keyAllowed(k)).sort((a, b) => resolve(a).localeCompare(resolve(b)));
  }, [product, locations, resolve, keyAllowed]);

  const loadMoves = useCallback(async () => {
    setLoading(true);
    try {
      const [moves, settings] = await Promise.all([
        StockService.getMovementsForProduct(product.barcode),
        StockService.getStockSettings().catch(() => []),
      ]);
      setMovements(moves);
      const s = settings.find(x => x.barcode === product.barcode && !x.location_key);
      setReorderPoint(s ? String(s.reorder_point) : '');
    } catch (e: any) {
      showToast({ type: 'error', message: e?.message || 'Erreur historique' });
    } finally { setLoading(false); }
  }, [product.barcode, showToast]);

  useEffect(() => { loadMoves(); }, [loadMoves]);

  const saveReorder = async () => {
    const rp = parseFloat(reorderPoint);
    if (isNaN(rp) || rp < 0) { showToast({ type: 'error', message: 'Seuil invalide' }); return; }
    setReorderSaving(true);
    try {
      await StockService.upsertStockSetting({ barcode: product.barcode, location_key: null, reorder_point: rp, reorder_qty: 0 });
      showToast({ type: 'success', message: 'Seuil enregistré' });
      onChanged();
    } catch (e: any) {
      showToast({ type: 'error', message: e?.message || 'Échec' });
    } finally { setReorderSaving(false); }
  };

  const submitAdjust = async () => {
    if (adjustKey == null) return;
    const target = parseFloat(newQty);
    if (isNaN(target)) { showToast({ type: 'error', message: 'Quantité invalide' }); return; }
    if (!reason.trim()) { showToast({ type: 'error', message: 'Motif requis' }); return; }
    const current = Number(product.stock_levels?.[adjustKey] ?? 0);
    if (target === current) { showToast({ type: 'error', message: 'Aucun changement' }); return; }
    setSaving(true);
    try {
      const loc = locations.find(l => findLevelKey({ [adjustKey]: 0 }, locationCandidates(l)) === adjustKey);
      // Sets the level to the target, measured against the live stock.
      const result = await StockService.applyMovements(null, [{
        barcode: product.barcode,
        locationKeys: [adjustKey],
        type: 'count',
        counted: target,
        reason: reason.trim(),
        sourceType: 'count',
        locationId: loc?.id ?? null,
      }], currentUsername);
      const delta = Number(result.movements[0]?.quantity ?? 0);
      showToast({ type: 'success', message: delta ? `Stock ajusté (${delta > 0 ? '+' : ''}${delta})` : 'Stock déjà à cette quantité' });
      if (delta < 0) {
        const { notifyLowStock } = await import('../../inventory/lib/lowStockAlert');
        void notifyLowStock([product.barcode]);
      }
      setAdjustKey(null); setNewQty(''); setReason('');
      await loadMoves();
      onChanged();
    } catch (e: any) {
      showToast({ type: 'error', message: e?.message || 'Échec de l\'ajustement' });
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative w-full max-w-md bg-card border-l border-border h-full overflow-y-auto shadow-2xl animate-in slide-in-from-right duration-200"
        onClick={e => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-border bg-card px-4 py-3">
          <div className="min-w-0">
            <h2 className="line-clamp-2 font-semibold text-foreground">{product.name}</h2>
            <p className="truncate text-xs text-muted-foreground"><span className="font-mono">{product.barcode}</span>{product.brand ? ` · ${product.brand}` : ''}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fermer" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground"><X className="h-5 w-5" /></button>
        </div>

        <div className="p-4 space-y-4">
          {/* Per-location levels */}
          <div>
            <h3 className="mb-2 text-sm font-semibold text-foreground">Stock par emplacement</h3>
            <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
              {keys.map(k => {
                const v = Number(product.stock_levels?.[k] ?? 0);
                return (
                  <div key={k} className="flex min-h-12 items-center justify-between gap-3 px-3 py-2">
                    <span className="text-sm text-foreground">{resolve(k)}</span>
                    <div className="flex items-center gap-3">
                      <span className="font-semibold tabular-nums text-foreground">{fmt(v)}</span>
                      {canWrite && (
                        <button
                          onClick={() => { setAdjustKey(k); setNewQty(String(v)); setReason(''); }}
                          className="flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-semibold text-primary hover:bg-primary/10"
                        >
                          <SlidersHorizontal className="h-4 w-4" aria-hidden="true" /> Ajuster
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Reorder threshold */}
          {canWrite && (
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <label htmlFor="stock-reorder-point" className="mb-1 block text-xs font-medium text-muted-foreground">Seuil de réappro. (alerte sous seuil)</label>
                <input id="stock-reorder-point" type="number" min={0} value={reorderPoint} onChange={e => setReorderPoint(e.target.value)}
                  placeholder="ex: 5"
                  className={`${field} w-full`} />
              </div>
              <button type="button" onClick={saveReorder} disabled={reorderSaving}
                className="h-10 rounded-lg border border-border bg-card px-3 text-sm font-semibold text-foreground hover:bg-secondary disabled:opacity-50">
                {reorderSaving ? '…' : 'Enregistrer'}
              </button>
            </div>
          )}

          {/* Adjust form */}
          {adjustKey != null && (
            <div className="rounded-xl border border-primary/30 bg-primary/[0.03] p-3">
              <p className="mb-2 text-sm font-semibold text-foreground">Ajuster — {resolve(adjustKey)}</p>
              <label htmlFor="stock-adjust-qty" className="mb-1 block text-xs font-medium text-muted-foreground">Quantité réelle (comptée)</label>
              <input
                id="stock-adjust-qty" type="number" value={newQty} onChange={e => setNewQty(e.target.value)}
                className={`${field} mb-2 w-full`}
              />
              <label htmlFor="stock-adjust-reason" className="mb-1 block text-xs font-medium text-muted-foreground">Motif (obligatoire)</label>
              <input
                id="stock-adjust-reason" value={reason} onChange={e => setReason(e.target.value)}
                placeholder="ex: inventaire, casse, correction…"
                className={`${field} mb-3 w-full`}
              />
              <div className="flex gap-2">
                <button type="button" onClick={submitAdjust} disabled={saving}
                  className="h-10 flex-1 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                  {saving ? 'Enregistrement…' : 'Valider l\'ajustement'}
                </button>
                <button type="button" onClick={() => setAdjustKey(null)} className="h-10 rounded-lg border border-border px-3 text-sm font-medium text-foreground hover:bg-secondary">Annuler</button>
              </div>
            </div>
          )}

          {/* Movement history */}
          <div>
            <h3 className="mb-2 text-sm font-semibold text-foreground">Historique des mouvements</h3>
            {loading ? (
              <div className="text-sm text-muted-foreground py-4 flex items-center"><Loader className="h-4 w-4 animate-spin mr-2" />Chargement…</div>
            ) : movements.length === 0 ? (
              <div className="text-sm text-muted-foreground py-4">Aucun mouvement</div>
            ) : (
              <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
                {movements.map(m => (
                  <div key={m.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-foreground">{MOVEMENT_LABELS[m.type] || m.type} · {resolve(m.location_key)}</div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(m.created_at).toLocaleString('fr-FR')}{m.reason ? ` · ${m.reason}` : ''}{m.created_by ? ` · ${m.created_by}` : ''}
                      </div>
                    </div>
                    <div className="text-right shrink-0 ml-2">
                      <div className={`text-sm font-semibold tabular-nums ${m.quantity >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`}>
                        {m.quantity >= 0 ? '+' : ''}{fmt(m.quantity)}
                      </div>
                      {m.balance_after != null && <div className="text-xs tabular-nums text-muted-foreground">→ {fmt(m.balance_after)}</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
