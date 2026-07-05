import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { PackagePlus, Search, Trash2, Plus, Loader, Check } from 'lucide-react';
import type { Product, StockLocation } from '../../types';
import { StockService } from '../../utils/supabaseStock';
import { StockLocationsService } from '../../utils/supabaseStockLocations';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';

interface Line { barcode: string; name: string; qty: number; unitCost: number; }

export default function StockReceivePage() {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { showToast } = useToast();

  const [products, setProducts] = useState<Product[]>([]);
  const [locations, setLocations] = useState<StockLocation[]>([]);
  const [locationKey, setLocationKey] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, l] = await Promise.all([StockService.getProducts(), StockLocationsService.getStockLocations()]);
      setProducts(p);
      setLocations(l);
      if (l.length > 0) setLocationKey(l[0].abbreviation || l[0].name);
    } catch (e: any) {
      showToast({ type: 'error', message: e?.message || 'Erreur de chargement' });
    } finally { setLoading(false); }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return products.filter(p =>
      p.name.toLowerCase().includes(q) || p.barcode.toLowerCase().includes(q) || (p.brand || '').toLowerCase().includes(q)
    ).slice(0, 8);
  }, [products, query]);

  const addLine = (p: Product) => {
    if (lines.some(l => l.barcode === p.barcode)) { setQuery(''); return; }
    setLines(prev => [...prev, { barcode: p.barcode, name: p.name, qty: 1, unitCost: Number(p.buyprice) || 0 }]);
    setQuery('');
  };

  const updateLine = (i: number, field: 'qty' | 'unitCost', v: number) =>
    setLines(prev => prev.map((l, idx) => idx === i ? { ...l, [field]: v } : l));
  const removeLine = (i: number) => setLines(prev => prev.filter((_, idx) => idx !== i));

  const total = lines.reduce((s, l) => s + l.qty * l.unitCost, 0);
  const locId = locations.find(l => (l.abbreviation || l.name) === locationKey)?.id ?? null;

  const validate = async () => {
    if (!locationKey) { showToast({ type: 'error', message: 'Choisissez un emplacement' }); return; }
    if (lines.length === 0) { showToast({ type: 'error', message: 'Ajoutez au moins un article' }); return; }
    if (lines.some(l => l.qty <= 0)) { showToast({ type: 'error', message: 'Quantités invalides' }); return; }
    setSaving(true);
    const receiptId = crypto.randomUUID();
    const ref = `Réception ${new Date().toLocaleDateString('fr-FR')}`;
    try {
      for (const l of lines) {
        await StockService.applyMovement({
          barcode: l.barcode,
          locationKey,
          type: 'in',
          quantity: l.qty,
          unitCost: l.unitCost || null,
          reason: ref,
          sourceType: 'receipt',
          sourceId: receiptId,
          createdBy: currentUser?.username || null,
          locationId: locId,
        });
      }
      showToast({ type: 'success', title: 'Réception validée', message: `${lines.length} article(s) entrés en stock` });
      navigate('/inventaire/mouvements');
    } catch (e: any) {
      showToast({ type: 'error', title: 'Erreur', message: e?.message || 'Échec de la réception' });
    } finally { setSaving(false); }
  };

  return (
    <div className="max-w-3xl mx-auto py-6 px-3">
      <div className="flex items-center gap-2 mb-5">
        <div className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-primary/10">
          <PackagePlus className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-foreground leading-tight">Réception de stock</h1>
          <p className="text-xs text-muted-foreground">Entrée de marchandises — met à jour le CMUP</p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground"><Loader className="h-5 w-5 animate-spin mr-2" />Chargement…</div>
      ) : (
        <div className="space-y-4">
          {/* Location */}
          <div className="bg-card border border-border/60 rounded-xl p-4">
            <label className="block text-xs font-semibold text-muted-foreground mb-1.5">Emplacement de réception</label>
            <select value={locationKey} onChange={e => setLocationKey(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg bg-secondary border border-border focus:outline-none focus:ring-2 focus:ring-primary/30">
              {locations.length === 0 && <option value="">Aucun emplacement configuré</option>}
              {locations.map(l => (
                <option key={l.id} value={l.abbreviation || l.name}>{l.name}{l.abbreviation ? ` (${l.abbreviation})` : ''}</option>
              ))}
            </select>
          </div>

          {/* Product search */}
          <div className="bg-card border border-border/60 rounded-xl p-4">
            <label className="block text-xs font-semibold text-muted-foreground mb-1.5">Ajouter un article</label>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Rechercher article, code, marque…"
                className="w-full pl-8 pr-3 py-2 text-sm rounded-lg bg-secondary border border-border focus:outline-none focus:ring-2 focus:ring-primary/30" />
              {results.length > 0 && (
                <div className="absolute z-20 mt-1 w-full bg-card border border-border rounded-lg shadow-lg overflow-hidden">
                  {results.map(p => (
                    <button key={p.barcode} onClick={() => addLine(p)}
                      className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-secondary text-sm">
                      <span className="truncate">{p.name}</span>
                      <span className="text-[10px] text-muted-foreground font-mono ml-2 shrink-0">{p.barcode}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Lines */}
          {lines.length > 0 && (
            <div className="bg-card border border-border/60 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/60 bg-secondary/50 text-xs text-muted-foreground">
                    <th className="text-left font-medium px-3 py-2">Article</th>
                    <th className="text-right font-medium px-3 py-2 w-24">Qté</th>
                    <th className="text-right font-medium px-3 py-2 w-32">Coût unit. (MAD)</th>
                    <th className="text-right font-medium px-3 py-2 w-28">Total</th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={l.barcode} className="border-b border-border/40">
                      <td className="px-3 py-2">
                        <div className="font-medium text-foreground truncate max-w-[220px]">{l.name}</div>
                        <div className="text-[10px] text-muted-foreground font-mono">{l.barcode}</div>
                      </td>
                      <td className="px-3 py-2">
                        <input type="number" min={1} value={l.qty} onChange={e => updateLine(i, 'qty', Number(e.target.value))}
                          className="w-full px-2 py-1 text-sm text-right rounded bg-secondary border border-border focus:outline-none focus:ring-1 focus:ring-primary/30" />
                      </td>
                      <td className="px-3 py-2">
                        <input type="number" min={0} step="0.01" value={l.unitCost} onChange={e => updateLine(i, 'unitCost', Number(e.target.value))}
                          className="w-full px-2 py-1 text-sm text-right rounded bg-secondary border border-border focus:outline-none focus:ring-1 focus:ring-primary/30" />
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-foreground">{(l.qty * l.unitCost).toFixed(2)}</td>
                      <td className="px-2 text-center">
                        <button onClick={() => removeLine(i)} className="p-1 rounded hover:bg-secondary text-muted-foreground"><Trash2 className="h-3.5 w-3.5" /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-secondary/40">
                    <td colSpan={3} className="px-3 py-2 text-right text-xs font-semibold text-muted-foreground">Total réception</td>
                    <td className="px-3 py-2 text-right font-bold tabular-nums">{total.toFixed(2)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button onClick={() => navigate('/inventaire')} className="px-4 py-2 rounded-lg bg-secondary text-foreground text-sm border border-border">Annuler</button>
            <button onClick={validate} disabled={saving || lines.length === 0}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50">
              {saving ? <Loader className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Valider la réception
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
