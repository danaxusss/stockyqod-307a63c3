import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeftRight, Search, Trash2, Loader, Check, ArrowRight } from 'lucide-react';
import type { Product, StockLocation } from '../../types';
import { StockService } from '../../utils/supabaseStock';
import { StockLocationsService } from '../../utils/supabaseStockLocations';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';

interface Line { barcode: string; name: string; qty: number; available: number; }

export default function StockTransferPage() {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { showToast } = useToast();

  const [products, setProducts] = useState<Product[]>([]);
  const [locations, setLocations] = useState<StockLocation[]>([]);
  const [fromKey, setFromKey] = useState('');
  const [toKey, setToKey] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const byBarcode = useMemo(() => new Map(products.map(p => [p.barcode, p])), [products]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, l] = await Promise.all([StockService.getProducts(), StockLocationsService.getStockLocations()]);
      setProducts(p); setLocations(l);
      if (l.length > 0) setFromKey(l[0].abbreviation || l[0].name);
      if (l.length > 1) setToKey(l[1].abbreviation || l[1].name);
    } catch (e: any) {
      showToast({ type: 'error', message: e?.message || 'Erreur de chargement' });
    } finally { setLoading(false); }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  // When source changes, refresh available quantities on existing lines.
  useEffect(() => {
    setLines(prev => prev.map(l => ({ ...l, available: Number(byBarcode.get(l.barcode)?.stock_levels?.[fromKey] ?? 0) })));
  }, [fromKey, byBarcode]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return products.filter(p =>
      (Number(p.stock_levels?.[fromKey] ?? 0) > 0) &&
      (p.name.toLowerCase().includes(q) || p.barcode.toLowerCase().includes(q) || (p.brand || '').toLowerCase().includes(q))
    ).slice(0, 8);
  }, [products, query, fromKey]);

  const addLine = (p: Product) => {
    if (lines.some(l => l.barcode === p.barcode)) { setQuery(''); return; }
    const available = Number(p.stock_levels?.[fromKey] ?? 0);
    setLines(prev => [...prev, { barcode: p.barcode, name: p.name, qty: Math.min(1, available), available }]);
    setQuery('');
  };
  const updateQty = (i: number, v: number) => setLines(prev => prev.map((l, idx) => idx === i ? { ...l, qty: v } : l));
  const removeLine = (i: number) => setLines(prev => prev.filter((_, idx) => idx !== i));

  const fromLoc = locations.find(l => (l.abbreviation || l.name) === fromKey);
  const toLoc = locations.find(l => (l.abbreviation || l.name) === toKey);
  const hasOverdraw = lines.some(l => l.qty > l.available);

  const validate = async () => {
    if (!fromKey || !toKey) { showToast({ type: 'error', message: 'Choisissez les emplacements' }); return; }
    if (fromKey === toKey) { showToast({ type: 'error', message: 'Source et destination identiques' }); return; }
    if (lines.length === 0) { showToast({ type: 'error', message: 'Ajoutez au moins un article' }); return; }
    if (lines.some(l => l.qty <= 0)) { showToast({ type: 'error', message: 'Quantités invalides' }); return; }
    if (hasOverdraw && !confirm('Certaines quantités dépassent le stock disponible à la source. Continuer (stock négatif) ?')) return;
    setSaving(true);
    const group = crypto.randomUUID();
    const ref = `Transfert ${fromLoc?.name || fromKey} → ${toLoc?.name || toKey}`;
    try {
      for (const l of lines) {
        await StockService.applyMovement({
          barcode: l.barcode, locationKey: fromKey, type: 'transfer_out', quantity: l.qty,
          reason: ref, sourceType: 'transfer', sourceId: group, transferGroupId: group,
          createdBy: currentUser?.username || null, locationId: fromLoc?.id ?? null,
        });
        await StockService.applyMovement({
          barcode: l.barcode, locationKey: toKey, type: 'transfer_in', quantity: l.qty,
          reason: ref, sourceType: 'transfer', sourceId: group, transferGroupId: group,
          createdBy: currentUser?.username || null, locationId: toLoc?.id ?? null,
        });
      }
      showToast({ type: 'success', title: 'Transfert validé', message: `${lines.length} article(s) transférés` });
      navigate('/inventaire/mouvements');
    } catch (e: any) {
      showToast({ type: 'error', title: 'Erreur', message: e?.message || 'Échec du transfert' });
    } finally { setSaving(false); }
  };

  return (
    <div className="max-w-3xl mx-auto py-6 px-3">
      <div className="flex items-center gap-2 mb-5">
        <div className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-primary/10"><ArrowLeftRight className="h-5 w-5 text-primary" /></div>
        <div>
          <h1 className="text-lg font-bold text-foreground leading-tight">Transfert de stock</h1>
          <p className="text-xs text-muted-foreground">Déplacer des articles entre emplacements</p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground"><Loader className="h-5 w-5 animate-spin mr-2" />Chargement…</div>
      ) : (
        <div className="space-y-4">
          <div className="bg-card border border-border/60 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] gap-3 items-end">
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1.5">Depuis</label>
              <select value={fromKey} onChange={e => setFromKey(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg bg-secondary border border-border focus:outline-none focus:ring-2 focus:ring-primary/30">
                {locations.map(l => <option key={l.id} value={l.abbreviation || l.name}>{l.name}</option>)}
              </select>
            </div>
            <ArrowRight className="h-5 w-5 text-muted-foreground mx-auto hidden sm:block" />
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1.5">Vers</label>
              <select value={toKey} onChange={e => setToKey(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg bg-secondary border border-border focus:outline-none focus:ring-2 focus:ring-primary/30">
                {locations.map(l => <option key={l.id} value={l.abbreviation || l.name}>{l.name}</option>)}
              </select>
            </div>
          </div>

          <div className="bg-card border border-border/60 rounded-xl p-4">
            <label className="block text-xs font-semibold text-muted-foreground mb-1.5">Ajouter un article (avec stock à la source)</label>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Rechercher…"
                className="w-full pl-8 pr-3 py-2 text-sm rounded-lg bg-secondary border border-border focus:outline-none focus:ring-2 focus:ring-primary/30" />
              {results.length > 0 && (
                <div className="absolute z-20 mt-1 w-full bg-card border border-border rounded-lg shadow-lg overflow-hidden">
                  {results.map(p => (
                    <button key={p.barcode} onClick={() => addLine(p)} className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-secondary text-sm">
                      <span className="truncate">{p.name}</span>
                      <span className="text-[10px] text-muted-foreground ml-2 shrink-0">dispo {Number(p.stock_levels?.[fromKey] ?? 0)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {lines.length > 0 && (
            <div className="bg-card border border-border/60 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/60 bg-secondary/50 text-xs text-muted-foreground">
                    <th className="text-left font-medium px-3 py-2">Article</th>
                    <th className="text-right font-medium px-3 py-2 w-24">Dispo</th>
                    <th className="text-right font-medium px-3 py-2 w-28">Qté</th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={l.barcode} className="border-b border-border/40">
                      <td className="px-3 py-2">
                        <div className="font-medium text-foreground truncate max-w-[240px]">{l.name}</div>
                        <div className="text-[10px] text-muted-foreground font-mono">{l.barcode}</div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{l.available}</td>
                      <td className="px-3 py-2">
                        <input type="number" min={1} value={l.qty} onChange={e => updateQty(i, Number(e.target.value))}
                          className={`w-full px-2 py-1 text-sm text-right rounded bg-secondary border focus:outline-none focus:ring-1 focus:ring-primary/30 ${l.qty > l.available ? 'border-red-500/60' : 'border-border'}`} />
                      </td>
                      <td className="px-2 text-center"><button onClick={() => removeLine(i)} className="p-1 rounded hover:bg-secondary text-muted-foreground"><Trash2 className="h-3.5 w-3.5" /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {hasOverdraw && <p className="text-xs text-red-600 dark:text-red-400">⚠ Certaines quantités dépassent le stock disponible à la source.</p>}

          <div className="flex justify-end gap-2">
            <button onClick={() => navigate('/inventaire')} className="px-4 py-2 rounded-lg bg-secondary text-foreground text-sm border border-border">Annuler</button>
            <button onClick={validate} disabled={saving || lines.length === 0}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50">
              {saving ? <Loader className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Valider le transfert
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
