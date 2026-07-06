import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardList, Plus, Search, Trash2, Loader, Check, X } from 'lucide-react';
import type { Product, Provider, StockLocation, PurchaseOrderItem, PurchaseOrderStatus } from '../../types';
import { StockService } from '../../utils/supabaseStock';
import { StockLocationsService } from '../../utils/supabaseStockLocations';
import { PurchaseOrdersService } from '../../utils/supabasePurchaseOrders';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';

const STATUS: Record<PurchaseOrderStatus, { label: string; cls: string }> = {
  draft:     { label: 'Brouillon', cls: 'bg-secondary text-muted-foreground' },
  sent:      { label: 'Envoyé',    cls: 'bg-blue-500/15 text-blue-600 dark:text-blue-400' },
  partial:   { label: 'Partiel',   cls: 'bg-amber-500/15 text-amber-600 dark:text-amber-400' },
  received:  { label: 'Reçu',      cls: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' },
  cancelled: { label: 'Annulé',    cls: 'bg-red-500/15 text-red-600 dark:text-red-400' },
};

export default function PurchaseOrdersPage() {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { showToast } = useToast();
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setOrders(await PurchaseOrdersService.list()); }
    catch (e: any) { showToast({ type: 'error', message: e?.message || 'Erreur' }); }
    finally { setLoading(false); }
  }, [showToast]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="max-w-5xl mx-auto py-6 px-3">
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-primary/10"><ClipboardList className="h-5 w-5 text-primary" /></div>
          <div>
            <h1 className="text-lg font-bold text-foreground leading-tight">Bons de commande</h1>
            <p className="text-xs text-muted-foreground">Commandes fournisseurs → réception</p>
          </div>
        </div>
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium">
          <Plus className="h-4 w-4" /> Nouveau bon
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground"><Loader className="h-5 w-5 animate-spin mr-2" />Chargement…</div>
      ) : (
        <div className="bg-card border border-border/60 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/60 bg-secondary/50 text-xs text-muted-foreground">
                <th className="text-left font-medium px-3 py-2.5">N°</th>
                <th className="text-left font-medium px-3 py-2.5">Fournisseur</th>
                <th className="text-left font-medium px-3 py-2.5">Date</th>
                <th className="text-right font-medium px-3 py-2.5">Total HT</th>
                <th className="text-left font-medium px-3 py-2.5">Statut</th>
              </tr>
            </thead>
            <tbody>
              {orders.map(o => (
                <tr key={o.id} onClick={() => navigate(`/inventaire/commandes/${o.id}`)}
                  className="border-b border-border/40 hover:bg-secondary/40 cursor-pointer">
                  <td className="px-3 py-2.5 font-mono text-foreground">{o.po_number}</td>
                  <td className="px-3 py-2.5">{o.provider_name || '—'}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{new Date(o.order_date).toLocaleDateString('fr-FR')}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{Number(o.total_ht).toFixed(2)}</td>
                  <td className="px-3 py-2.5"><span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${STATUS[o.status as PurchaseOrderStatus].cls}`}>{STATUS[o.status as PurchaseOrderStatus].label}</span></td>
                </tr>
              ))}
              {orders.length === 0 && <tr><td colSpan={5} className="px-3 py-10 text-center text-muted-foreground">Aucun bon de commande</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <CreatePOModal
          createdBy={currentUser?.username || null}
          onClose={() => setShowCreate(false)}
          onCreated={(id) => { setShowCreate(false); navigate(`/inventaire/commandes/${id}`); }}
        />
      )}
    </div>
  );
}

function CreatePOModal({ createdBy, onClose, onCreated }: { createdBy: string | null; onClose: () => void; onCreated: (id: string) => void; }) {
  const { showToast } = useToast();
  const [products, setProducts] = useState<Product[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [locations, setLocations] = useState<StockLocation[]>([]);
  const [providerId, setProviderId] = useState('');
  const [locationKey, setLocationKey] = useState('');
  const [expected, setExpected] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<PurchaseOrderItem[]>([]);
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const [p, pr, l] = await Promise.all([
        StockService.getProducts(), StockLocationsService.getProviders(), StockLocationsService.getStockLocations(),
      ]);
      setProducts(p); setProviders(pr); setLocations(l);
      if (l.length > 0) setLocationKey(l[0].abbreviation || l[0].name);
    })().catch(() => {});
  }, []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return products.filter(p => !lines.some(l => l.barcode === p.barcode) &&
      (p.name.toLowerCase().includes(q) || p.barcode.toLowerCase().includes(q))).slice(0, 8);
  }, [products, query, lines]);

  const addLine = (p: Product) => {
    setLines(prev => [...prev, { barcode: p.barcode, label: p.name, qty_ordered: 1, qty_received: 0, unit_cost: Number(p.buyprice) || 0 }]);
    setQuery('');
  };
  const upd = (i: number, f: 'qty_ordered' | 'unit_cost', v: number) => setLines(prev => prev.map((l, idx) => idx === i ? { ...l, [f]: v } : l));
  const rm = (i: number) => setLines(prev => prev.filter((_, idx) => idx !== i));
  const total = lines.reduce((s, l) => s + l.qty_ordered * l.unit_cost, 0);

  const submit = async () => {
    if (lines.length === 0) { showToast({ type: 'error', message: 'Ajoutez au moins une ligne' }); return; }
    setSaving(true);
    try {
      const provider = providers.find(p => p.id === providerId);
      const po = await PurchaseOrdersService.create({
        provider_id: providerId || null, provider_name: provider?.name ?? null,
        location_key: locationKey || null, expected_date: expected || null,
        notes: notes.trim() || null, status: 'draft', created_by: createdBy,
      }, lines);
      showToast({ type: 'success', title: 'Bon créé', message: po.po_number });
      onCreated(po.id);
    } catch (e: any) {
      showToast({ type: 'error', title: 'Erreur', message: e?.message || 'Échec' });
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-card border border-border rounded-2xl shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-card border-b border-border/60 px-4 py-3 flex items-center justify-between">
          <h2 className="font-bold text-foreground">Nouveau bon de commande</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-secondary text-muted-foreground"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1">Fournisseur</label>
              <select value={providerId} onChange={e => setProviderId(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg bg-secondary border border-border">
                <option value="">—</option>
                {providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1">Emplacement de réception</label>
              <select value={locationKey} onChange={e => setLocationKey(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg bg-secondary border border-border">
                {locations.map(l => <option key={l.id} value={l.abbreviation || l.name}>{l.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1">Date prévue</label>
              <input type="date" value={expected} onChange={e => setExpected(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg bg-secondary border border-border" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1">Notes</label>
              <input value={notes} onChange={e => setNotes(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg bg-secondary border border-border" />
            </div>
          </div>

          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Ajouter un article…"
              className="w-full pl-8 pr-3 py-2 text-sm rounded-lg bg-secondary border border-border" />
            {results.length > 0 && (
              <div className="absolute z-20 mt-1 w-full bg-card border border-border rounded-lg shadow-lg overflow-hidden">
                {results.map(p => <button key={p.barcode} onClick={() => addLine(p)} className="w-full text-left px-3 py-2 hover:bg-secondary text-sm truncate">{p.name}</button>)}
              </div>
            )}
          </div>

          {lines.length > 0 && (
            <table className="w-full text-sm border border-border/60 rounded-lg overflow-hidden">
              <thead><tr className="bg-secondary/50 text-xs text-muted-foreground">
                <th className="text-left font-medium px-2 py-1.5">Article</th>
                <th className="text-right font-medium px-2 py-1.5 w-20">Qté</th>
                <th className="text-right font-medium px-2 py-1.5 w-28">Coût u.</th>
                <th className="w-8"></th>
              </tr></thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={l.barcode} className="border-t border-border/40">
                    <td className="px-2 py-1.5 truncate max-w-[220px]">{l.label}</td>
                    <td className="px-2 py-1.5"><input type="number" min={1} value={l.qty_ordered} onChange={e => upd(i, 'qty_ordered', Number(e.target.value))} className="w-full px-1.5 py-1 text-right rounded bg-secondary border border-border" /></td>
                    <td className="px-2 py-1.5"><input type="number" min={0} step="0.01" value={l.unit_cost} onChange={e => upd(i, 'unit_cost', Number(e.target.value))} className="w-full px-1.5 py-1 text-right rounded bg-secondary border border-border" /></td>
                    <td className="px-1 text-center"><button onClick={() => rm(i)} className="p-1 text-muted-foreground hover:bg-secondary rounded"><Trash2 className="h-3.5 w-3.5" /></button></td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr className="bg-secondary/40"><td colSpan={2} className="px-2 py-1.5 text-right text-xs font-semibold text-muted-foreground">Total HT</td><td className="px-2 py-1.5 text-right font-bold">{total.toFixed(2)}</td><td></td></tr></tfoot>
            </table>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} className="px-4 py-2 rounded-lg bg-secondary text-foreground text-sm border border-border">Annuler</button>
            <button onClick={submit} disabled={saving || lines.length === 0} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50">
              {saving ? <Loader className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Créer le bon
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
