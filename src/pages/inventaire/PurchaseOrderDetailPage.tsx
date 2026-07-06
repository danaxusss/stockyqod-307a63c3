import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader, PackageCheck, Send, Ban } from 'lucide-react';
import type { PurchaseOrder, PurchaseOrderStatus, StockLocation } from '../../types';
import { PurchaseOrdersService } from '../../utils/supabasePurchaseOrders';
import { StockLocationsService } from '../../utils/supabaseStockLocations';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';

const STATUS: Record<PurchaseOrderStatus, { label: string; cls: string }> = {
  draft:     { label: 'Brouillon', cls: 'bg-secondary text-muted-foreground' },
  sent:      { label: 'Envoyé',    cls: 'bg-blue-500/15 text-blue-600 dark:text-blue-400' },
  partial:   { label: 'Partiel',   cls: 'bg-amber-500/15 text-amber-600 dark:text-amber-400' },
  received:  { label: 'Reçu',      cls: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' },
  cancelled: { label: 'Annulé',    cls: 'bg-red-500/15 text-red-600 dark:text-red-400' },
};

export default function PurchaseOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { showToast } = useToast();

  const [po, setPo] = useState<PurchaseOrder | null>(null);
  const [locations, setLocations] = useState<StockLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const [recvQty, setRecvQty] = useState<Record<string, string>>({});
  const [recvLocation, setRecvLocation] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [p, l] = await Promise.all([PurchaseOrdersService.getById(id), StockLocationsService.getStockLocations()]);
      setPo(p); setLocations(l);
      setRecvLocation(p?.location_key || (l[0] ? (l[0].abbreviation || l[0].name) : ''));
    } catch (e: any) {
      showToast({ type: 'error', message: e?.message || 'Erreur' });
    } finally { setLoading(false); }
  }, [id, showToast]);
  useEffect(() => { load(); }, [load]);

  const setStatus = async (status: PurchaseOrderStatus) => {
    if (!po) return;
    setBusy(true);
    try { await PurchaseOrdersService.setStatus(po.id, status); await load(); }
    catch (e: any) { showToast({ type: 'error', message: e?.message || 'Erreur' }); }
    finally { setBusy(false); }
  };

  const startReceive = () => {
    if (!po?.items) return;
    const init: Record<string, string> = {};
    po.items.forEach(it => { init[it.id!] = String(Math.max(0, it.qty_ordered - it.qty_received)); });
    setRecvQty(init); setReceiving(true);
  };

  const confirmReceive = async () => {
    if (!po) return;
    const received: Record<string, number> = {};
    Object.entries(recvQty).forEach(([k, v]) => { const n = parseFloat(v); if (!isNaN(n) && n > 0) received[k] = n; });
    if (Object.keys(received).length === 0) { showToast({ type: 'error', message: 'Aucune quantité à réceptionner' }); return; }
    if (!recvLocation) { showToast({ type: 'error', message: 'Choisissez un emplacement' }); return; }
    setBusy(true);
    try {
      const loc = locations.find(l => (l.abbreviation || l.name) === recvLocation);
      await PurchaseOrdersService.receive(po.id, received, {
        locationKey: recvLocation, locationId: loc?.id ?? null, createdBy: currentUser?.username || null,
      });
      showToast({ type: 'success', title: 'Réception enregistrée', message: 'Stock mis à jour (CMUP)' });
      setReceiving(false); await load();
    } catch (e: any) {
      showToast({ type: 'error', title: 'Erreur', message: e?.message || 'Échec' });
    } finally { setBusy(false); }
  };

  if (loading) return <div className="flex items-center justify-center py-20 text-muted-foreground"><Loader className="h-5 w-5 animate-spin mr-2" />Chargement…</div>;
  if (!po) return <div className="max-w-3xl mx-auto py-10 text-center text-muted-foreground">Bon introuvable</div>;

  const canReceive = po.status !== 'received' && po.status !== 'cancelled';

  return (
    <div className="max-w-3xl mx-auto py-6 px-3">
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <button onClick={() => navigate('/inventaire/commandes')} className="p-1.5 hover:bg-secondary rounded-lg"><ArrowLeft className="h-4 w-4 text-muted-foreground" /></button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold text-foreground font-mono">{po.po_number}</h1>
          <p className="text-xs text-muted-foreground">{po.provider_name || 'Sans fournisseur'} — {new Date(po.order_date).toLocaleDateString('fr-FR')}</p>
        </div>
        <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${STATUS[po.status].cls}`}>{STATUS[po.status].label}</span>
        {po.status === 'draft' && <button onClick={() => setStatus('sent')} disabled={busy} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary border border-border text-sm"><Send className="h-3.5 w-3.5" />Marquer envoyé</button>}
        {canReceive && <button onClick={startReceive} disabled={busy} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium"><PackageCheck className="h-3.5 w-3.5" />Réceptionner</button>}
        {canReceive && <button onClick={() => setStatus('cancelled')} disabled={busy} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary border border-border text-sm text-red-600 dark:text-red-400"><Ban className="h-3.5 w-3.5" />Annuler</button>}
      </div>

      <div className="bg-card border border-border/60 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/60 bg-secondary/50 text-xs text-muted-foreground">
              <th className="text-left font-medium px-3 py-2">Article</th>
              <th className="text-right font-medium px-3 py-2">Commandé</th>
              <th className="text-right font-medium px-3 py-2">Reçu</th>
              <th className="text-right font-medium px-3 py-2">Coût u.</th>
              {receiving && <th className="text-right font-medium px-3 py-2 w-28">À recevoir</th>}
            </tr>
          </thead>
          <tbody>
            {(po.items || []).map(it => (
              <tr key={it.id} className="border-b border-border/40">
                <td className="px-3 py-2">
                  <div className="font-medium text-foreground truncate max-w-[240px]">{it.label}</div>
                  <div className="text-[10px] text-muted-foreground font-mono">{it.barcode}</div>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{it.qty_ordered}</td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{it.qty_received}</td>
                <td className="px-3 py-2 text-right tabular-nums">{Number(it.unit_cost).toFixed(2)}</td>
                {receiving && (
                  <td className="px-3 py-2">
                    <input type="number" min={0} value={recvQty[it.id!] ?? ''} onChange={e => setRecvQty(prev => ({ ...prev, [it.id!]: e.target.value }))}
                      className="w-full px-2 py-1 text-sm text-right rounded bg-secondary border border-border" />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          <tfoot><tr className="bg-secondary/40"><td colSpan={3} className="px-3 py-2 text-right text-xs font-semibold text-muted-foreground">Total HT</td><td className="px-3 py-2 text-right font-bold tabular-nums">{Number(po.total_ht).toFixed(2)}</td>{receiving && <td></td>}</tr></tfoot>
        </table>
      </div>

      {receiving && (
        <div className="mt-4 bg-card border border-primary/30 rounded-xl p-4">
          <div className="flex items-end gap-2 flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs font-semibold text-muted-foreground mb-1">Emplacement de réception</label>
              <select value={recvLocation} onChange={e => setRecvLocation(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg bg-secondary border border-border">
                {locations.map(l => <option key={l.id} value={l.abbreviation || l.name}>{l.name}</option>)}
              </select>
            </div>
            <button onClick={() => setReceiving(false)} className="px-4 py-2 rounded-lg bg-secondary text-foreground text-sm border border-border">Annuler</button>
            <button onClick={confirmReceive} disabled={busy} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50">
              {busy ? <Loader className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />} Confirmer la réception
            </button>
          </div>
        </div>
      )}

      {po.notes && <p className="mt-3 text-xs text-muted-foreground">Notes : {po.notes}</p>}
    </div>
  );
}
