import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Search, Package, AlertTriangle, X, History, SlidersHorizontal, Loader } from 'lucide-react';
import type { Product, StockLocation, StockMovement, ProductStockSetting } from '../../types';
import { StockService, totalStock } from '../../utils/supabaseStock';
import { StockLocationsService } from '../../utils/supabaseStockLocations';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';

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
    return rp != null && totalStock(p) <= rp;
  }, [reorderByBarcode]);

  // Location keys present across products, filtered by what the user may see.
  const locationKeys = useMemo(() => {
    const keys = new Set<string>();
    products.forEach(p => Object.keys(p.stock_levels || {}).forEach(k => keys.add(k)));
    return Array.from(keys)
      .filter(k => canAccessStockLocation(k))
      .sort((a, b) => resolve(a).localeCompare(resolve(b)));
  }, [products, canAccessStockLocation, resolve]);

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
    <div className="max-w-7xl mx-auto py-6 px-3">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-primary/10">
            <Package className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-foreground leading-tight">Niveaux de stock</h1>
            <p className="text-xs text-muted-foreground">{products.length} articles · {locationKeys.length} emplacements</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Rechercher article, code, marque…"
              className="pl-8 pr-3 py-2 text-sm rounded-lg bg-secondary border border-border w-64 max-w-full focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <button
            onClick={() => setOnlyLow(v => !v)}
            className={`flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-medium border transition-colors ${
              onlyLow ? 'bg-amber-500/15 border-amber-500/40 text-amber-700 dark:text-amber-400'
                      : 'bg-secondary border-border text-muted-foreground hover:text-foreground'
            }`}
            title="Afficher uniquement les articles sous le seuil"
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            Sous seuil{lowCount > 0 ? ` (${lowCount})` : ''}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader className="h-5 w-5 animate-spin mr-2" /> Chargement…
        </div>
      ) : (
        <div className="bg-card border border-border/60 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60 bg-secondary/50 text-xs text-muted-foreground">
                  <th className="text-left font-medium px-3 py-2.5">Article</th>
                  {locationKeys.map(k => (
                    <th key={k} className="text-right font-medium px-3 py-2.5 whitespace-nowrap">{resolve(k)}</th>
                  ))}
                  <th className="text-right font-medium px-3 py-2.5">Total</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(p => {
                  const low = isLow(p);
                  return (
                    <tr
                      key={p.barcode}
                      onClick={() => setDetail(p)}
                      className="border-b border-border/40 hover:bg-secondary/40 cursor-pointer transition-colors"
                    >
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          {low && <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" title="Sous le seuil" />}
                          <div className="min-w-0">
                            <div className="font-medium text-foreground truncate max-w-[280px]">{p.name}</div>
                            <div className="text-[11px] text-muted-foreground font-mono">{p.barcode}{p.brand ? ` · ${p.brand}` : ''}</div>
                          </div>
                        </div>
                      </td>
                      {locationKeys.map(k => {
                        const v = Number(p.stock_levels?.[k] ?? 0);
                        return (
                          <td key={k} className={`px-3 py-2.5 text-right tabular-nums ${v <= 0 ? 'text-muted-foreground/50' : 'text-foreground'}`}>
                            {v === 0 ? '—' : fmt(v)}
                          </td>
                        );
                      })}
                      <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-foreground">{fmt(totalStock(p))}</td>
                      <td className="px-2 text-muted-foreground"><History className="h-3.5 w-3.5" /></td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan={locationKeys.length + 3} className="px-3 py-10 text-center text-muted-foreground">Aucun article</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {detail && (
        <ProductStockDrawer
          product={detail}
          locations={locations}
          resolve={resolve}
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
  product, locations, resolve, canWrite, currentUsername, onClose, onChanged,
}: {
  product: Product;
  locations: StockLocation[];
  resolve: (k: string) => string;
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
    locations.forEach(l => s.add(l.abbreviation || l.name));
    return Array.from(s).sort((a, b) => resolve(a).localeCompare(resolve(b)));
  }, [product, locations, resolve]);

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
    const delta = target - current;
    if (delta === 0) { showToast({ type: 'error', message: 'Aucun changement' }); return; }
    setSaving(true);
    try {
      const loc = locations.find(l => l.abbreviation === adjustKey || l.name === adjustKey);
      await StockService.applyMovement({
        barcode: product.barcode,
        locationKey: adjustKey,
        type: 'count',
        quantity: delta,               // signed variance
        reason: reason.trim(),
        sourceType: 'count',
        createdBy: currentUsername,
        locationId: loc?.id ?? null,
      });
      showToast({ type: 'success', message: `Stock ajusté (${delta > 0 ? '+' : ''}${delta})` });
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
        <div className="sticky top-0 bg-card border-b border-border/60 px-4 py-3 flex items-start justify-between z-10">
          <div className="min-w-0">
            <h2 className="font-bold text-foreground truncate">{product.name}</h2>
            <p className="text-[11px] text-muted-foreground font-mono">{product.barcode}{product.brand ? ` · ${product.brand}` : ''}</p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-secondary text-muted-foreground"><X className="h-4 w-4" /></button>
        </div>

        <div className="p-4 space-y-4">
          {/* Per-location levels */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Stock par emplacement</h3>
            <div className="space-y-1.5">
              {keys.map(k => {
                const v = Number(product.stock_levels?.[k] ?? 0);
                return (
                  <div key={k} className="flex items-center justify-between px-3 py-2 rounded-lg bg-secondary/60">
                    <span className="text-sm text-foreground">{resolve(k)}</span>
                    <div className="flex items-center gap-3">
                      <span className="font-semibold tabular-nums">{fmt(v)}</span>
                      {canWrite && (
                        <button
                          onClick={() => { setAdjustKey(k); setNewQty(String(v)); setReason(''); }}
                          className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md bg-primary/10 text-primary hover:bg-primary/20"
                        >
                          <SlidersHorizontal className="h-3 w-3" /> Ajuster
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
                <label className="block text-[11px] text-muted-foreground mb-1">Seuil de réappro. (alerte sous seuil)</label>
                <input type="number" min={0} value={reorderPoint} onChange={e => setReorderPoint(e.target.value)}
                  placeholder="ex: 5"
                  className="w-full px-3 py-2 text-sm rounded-lg bg-secondary border border-border focus:outline-none focus:ring-2 focus:ring-primary/30" />
              </div>
              <button onClick={saveReorder} disabled={reorderSaving}
                className="px-3 py-2 rounded-lg bg-secondary border border-border text-sm text-foreground disabled:opacity-50">
                {reorderSaving ? '…' : 'Enregistrer'}
              </button>
            </div>
          )}

          {/* Adjust form */}
          {adjustKey != null && (
            <div className="border border-primary/30 rounded-xl p-3 bg-primary/[0.03]">
              <div className="text-xs font-semibold text-foreground mb-2">Ajuster — {resolve(adjustKey)}</div>
              <label className="block text-[11px] text-muted-foreground mb-1">Quantité réelle (comptée)</label>
              <input
                type="number" value={newQty} onChange={e => setNewQty(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg bg-secondary border border-border mb-2 focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <label className="block text-[11px] text-muted-foreground mb-1">Motif (obligatoire)</label>
              <input
                value={reason} onChange={e => setReason(e.target.value)}
                placeholder="ex: inventaire, casse, correction…"
                className="w-full px-3 py-2 text-sm rounded-lg bg-secondary border border-border mb-3 focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <div className="flex gap-2">
                <button onClick={submitAdjust} disabled={saving}
                  className="flex-1 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50">
                  {saving ? 'Enregistrement…' : 'Valider l\'ajustement'}
                </button>
                <button onClick={() => setAdjustKey(null)} className="px-3 py-2 rounded-lg bg-secondary text-muted-foreground text-sm">Annuler</button>
              </div>
            </div>
          )}

          {/* Movement history */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Historique des mouvements</h3>
            {loading ? (
              <div className="text-sm text-muted-foreground py-4 flex items-center"><Loader className="h-4 w-4 animate-spin mr-2" />Chargement…</div>
            ) : movements.length === 0 ? (
              <div className="text-sm text-muted-foreground py-4">Aucun mouvement</div>
            ) : (
              <div className="space-y-1">
                {movements.map(m => (
                  <div key={m.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-secondary/40 text-xs">
                    <div className="min-w-0">
                      <div className="font-medium text-foreground">{MOVEMENT_LABELS[m.type] || m.type} · {resolve(m.location_key)}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {new Date(m.created_at).toLocaleString('fr-FR')}{m.reason ? ` · ${m.reason}` : ''}{m.created_by ? ` · ${m.created_by}` : ''}
                      </div>
                    </div>
                    <div className="text-right shrink-0 ml-2">
                      <div className={`font-semibold tabular-nums ${m.quantity >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                        {m.quantity >= 0 ? '+' : ''}{fmt(m.quantity)}
                      </div>
                      {m.balance_after != null && <div className="text-[10px] text-muted-foreground">→ {fmt(m.balance_after)}</div>}
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
