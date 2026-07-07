import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardCheck, Search, Loader, Check, Plus } from 'lucide-react';
import type { Product, StockLocation } from '../../types';
import { StockService } from '../../utils/supabaseStock';
import { StockLocationsService } from '../../utils/supabaseStockLocations';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';

interface CountRow { barcode: string; name: string; expected: number; counted: string; }

export default function StockCountPage() {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { showToast } = useToast();

  const [products, setProducts] = useState<Product[]>([]);
  const [locations, setLocations] = useState<StockLocation[]>([]);
  const [locationKey, setLocationKey] = useState('');
  const [rows, setRows] = useState<CountRow[]>([]);
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const byBarcode = useMemo(() => new Map(products.map(p => [p.barcode, p])), [products]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, l] = await Promise.all([StockService.getProducts(), StockLocationsService.getStockLocations()]);
      setProducts(p); setLocations(l);
      if (l.length > 0) setLocationKey(l[0].abbreviation || l[0].name);
    } catch (e: any) {
      showToast({ type: 'error', message: e?.message || 'Erreur de chargement' });
    } finally { setLoading(false); }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  // Populate the sheet with products that have stock at the chosen location.
  useEffect(() => {
    if (!locationKey) return;
    const seed = products
      .filter(p => Number(p.stock_levels?.[locationKey] ?? 0) !== 0)
      .map(p => ({ barcode: p.barcode, name: p.name, expected: Number(p.stock_levels?.[locationKey] ?? 0), counted: '' }));
    setRows(seed);
  }, [locationKey, products]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return products.filter(p =>
      !rows.some(r => r.barcode === p.barcode) &&
      (p.name.toLowerCase().includes(q) || p.barcode.toLowerCase().includes(q) || (p.brand || '').toLowerCase().includes(q))
    ).slice(0, 8);
  }, [products, query, rows]);

  const addRow = (p: Product) => {
    setRows(prev => [...prev, { barcode: p.barcode, name: p.name, expected: Number(p.stock_levels?.[locationKey] ?? 0), counted: '' }]);
    setQuery('');
  };
  const setCounted = (i: number, v: string) => setRows(prev => prev.map((r, idx) => idx === i ? { ...r, counted: v } : r));

  const changed = rows.filter(r => r.counted !== '' && !isNaN(parseFloat(r.counted)) && parseFloat(r.counted) !== r.expected);
  const loc = locations.find(l => (l.abbreviation || l.name) === locationKey);

  const validate = async () => {
    if (changed.length === 0) { showToast({ type: 'info', message: 'Aucun écart à enregistrer' }); return; }
    setSaving(true);
    const sessionId = crypto.randomUUID();
    const ref = `Inventaire ${loc?.name || locationKey} ${new Date().toLocaleDateString('fr-FR')}`;
    try {
      for (const r of changed) {
        const delta = parseFloat(r.counted) - r.expected;
        await StockService.applyMovement({
          barcode: r.barcode, locationKey, type: 'count', quantity: delta,
          reason: ref, sourceType: 'count', sourceId: sessionId,
          createdBy: currentUser?.username || null, locationId: loc?.id ?? null,
        });
      }
      showToast({ type: 'success', title: 'Inventaire validé', message: `${changed.length} écart(s) enregistré(s)` });
      navigate('/inventaire/mouvements');
    } catch (e: any) {
      showToast({ type: 'error', title: 'Erreur', message: e?.message || 'Échec de l\'inventaire' });
    } finally { setSaving(false); }
  };

  return (
    <div className="max-w-3xl mx-auto py-6 px-3">
      <div className="flex items-center gap-2 mb-5">
        <div className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-primary/10"><ClipboardCheck className="h-5 w-5 text-primary" /></div>
        <div>
          <h1 className="text-lg font-bold text-foreground leading-tight">Inventaire physique</h1>
          <p className="text-xs text-muted-foreground">Comptez, saisissez le réel — seuls les écarts génèrent un mouvement</p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground"><Loader className="h-5 w-5 animate-spin mr-2" />Chargement…</div>
      ) : (
        <div className="space-y-4">
          <div className="bg-card border border-border/60 rounded-xl p-4">
            <label className="block text-xs font-semibold text-muted-foreground mb-1.5">Emplacement à inventorier</label>
            <select value={locationKey} onChange={e => setLocationKey(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg bg-secondary border border-border focus:outline-none focus:ring-2 focus:ring-primary/30">
              {locations.map(l => <option key={l.id} value={l.abbreviation || l.name}>{l.name}</option>)}
            </select>
          </div>

          <div className="bg-card border border-border/60 rounded-xl p-4">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Ajouter un article absent de la liste…"
                className="w-full pl-8 pr-3 py-2 text-sm rounded-lg bg-secondary border border-border focus:outline-none focus:ring-2 focus:ring-primary/30" />
              {results.length > 0 && (
                <div className="absolute z-20 mt-1 w-full bg-card border border-border rounded-lg shadow-lg overflow-hidden">
                  {results.map(p => (
                    <button key={p.barcode} onClick={() => addRow(p)} className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-secondary text-sm">
                      <Plus className="h-3 w-3 text-muted-foreground" /><span className="truncate">{p.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="bg-card border border-border/60 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60 bg-secondary/50 text-xs text-muted-foreground">
                  <th className="text-left font-medium px-3 py-2">Article</th>
                  <th className="text-right font-medium px-3 py-2 w-24">Théorique</th>
                  <th className="text-right font-medium px-3 py-2 w-28">Compté</th>
                  <th className="text-right font-medium px-3 py-2 w-24">Écart</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const cn = r.counted === '' ? null : parseFloat(r.counted);
                  const variance = cn == null || isNaN(cn) ? null : cn - r.expected;
                  return (
                    <tr key={r.barcode} className="border-b border-border/40">
                      <td className="px-3 py-2">
                        <div className="font-medium text-foreground truncate max-w-[240px]">{r.name}</div>
                        <div className="text-[10px] text-muted-foreground font-mono">{r.barcode}</div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{r.expected}</td>
                      <td className="px-3 py-2">
                        <input type="number" value={r.counted} onChange={e => setCounted(i, e.target.value)} placeholder="—"
                          className="w-full px-2 py-1 text-sm text-right rounded bg-secondary border border-border focus:outline-none focus:ring-1 focus:ring-primary/30" />
                      </td>
                      <td className={`px-3 py-2 text-right tabular-nums font-semibold ${variance == null ? 'text-muted-foreground/40' : variance === 0 ? 'text-muted-foreground' : variance > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                        {variance == null ? '—' : variance === 0 ? '0' : `${variance > 0 ? '+' : ''}${variance}`}
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 && <tr><td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">Aucun article en stock à cet emplacement</td></tr>}
              </tbody>
            </table>
          </div>

          <div className="flex justify-between items-center">
            <span className="text-xs text-muted-foreground">{changed.length} écart(s) à enregistrer</span>
            <div className="flex gap-2">
              <button onClick={() => navigate('/inventaire')} className="px-4 py-2 rounded-lg bg-secondary text-foreground text-sm border border-border">Annuler</button>
              <button onClick={validate} disabled={saving || changed.length === 0}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50">
                {saving ? <Loader className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Valider l'inventaire
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
