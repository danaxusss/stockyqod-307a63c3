import React, { useEffect, useState, useCallback } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { ChevronRight, Loader, PackageCheck, Send, Ban, ClipboardList, StickyNote } from 'lucide-react';
import { StatusPill, type StatusTone } from '../../components/lists/StatusPill';
import { formatMoney } from '../../utils/format';
import { OpsLoading, OpsSection } from './StockOpsUi';
import { opsField, opsLabel, opsPanel, opsPhoneBar, opsPrimaryBtn, opsSecondaryBtn } from './stockOpsStyles';
import type { PurchaseOrder, PurchaseOrderStatus } from '../../types';
import { OverReceiptError, PurchaseOrdersService } from '../../utils/supabasePurchaseOrders';
import { useAccessibleLocations } from '../../inventory/hooks/useAccessibleLocations';
import { findLevelKey, locationCandidates } from '../../inventory/lib/locationKeys';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';

const STATUS: Record<PurchaseOrderStatus, { label: string; tone: StatusTone }> = {
  draft:     { label: 'Brouillon', tone: 'neutral' },
  sent:      { label: 'Envoyé',    tone: 'info' },
  partial:   { label: 'Partiel',   tone: 'warning' },
  received:  { label: 'Reçu',      tone: 'success' },
  cancelled: { label: 'Annulé',    tone: 'danger' },
};

export default function PurchaseOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { showToast } = useToast();

  const [po, setPo] = useState<PurchaseOrder | null>(null);
  const { accessibleLocations: locations } = useAccessibleLocations();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const [recvQty, setRecvQty] = useState<Record<string, string>>({});
  const [recvLocation, setRecvLocation] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const p = await PurchaseOrdersService.getById(id);
      setPo(p);
      if (p?.location_key) setRecvLocation(p.location_key);
    } catch (e: any) {
      showToast({ type: 'error', message: e?.message || 'Erreur' });
    } finally { setLoading(false); }
  }, [id, showToast]);
  useEffect(() => { load(); }, [load]);
  // Default to the first location the user can receive into.
  useEffect(() => {
    if (!recvLocation && locations.length > 0) setRecvLocation(locations[0].abbreviation || locations[0].name);
  }, [locations, recvLocation]);

  const setStatus = async (status: PurchaseOrderStatus) => {
    if (!po) return;
    setBusy(true);
    try { await PurchaseOrdersService.setStatus(po.id, status); await load(); }
    catch (e: any) { showToast({ type: 'error', message: e?.message || 'Erreur' }); }
    finally { setBusy(false); }
  };

  // Cancelling cannot be undone from this page: ask first.
  const cancelOrder = () => {
    if (!confirm('Annuler ce bon de commande ?')) return;
    void setStatus('cancelled');
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
    const loc = locations.find(l => findLevelKey({ [recvLocation]: 0 }, locationCandidates(l)) === recvLocation);
    if (!loc) { showToast({ type: 'error', message: 'Emplacement non accessible' }); return; }
    setBusy(true);
    const receive = (allowOver: boolean) => PurchaseOrdersService.receive(po.id, received, {
      locationKeys: locationCandidates(loc, recvLocation), locationId: loc.id, createdBy: currentUser?.username || null, allowOver,
    });
    try {
      try {
        await receive(false);
      } catch (e) {
        // More than ordered (or than what remains after someone else's reception).
        if (!(e instanceof OverReceiptError) || !confirm(`${e.message}.\nRéceptionner quand même cette quantité ?`)) throw e;
        await receive(true);
      }
      showToast({ type: 'success', title: 'Réception enregistrée', message: 'Stock mis à jour (CMUP)' });
      setReceiving(false); await load();
    } catch (e: any) {
      showToast({ type: 'error', title: 'Erreur', message: e?.message || 'Échec' });
      await load();
    } finally { setBusy(false); }
  };

  if (loading) return <OpsLoading />;
  if (!po) return (
    <div className="mx-auto max-w-md py-16 text-center">
      <ClipboardList className="mx-auto h-10 w-10 text-muted-foreground" aria-hidden="true" />
      <p className="mt-3 font-medium text-foreground">Bon introuvable</p>
      <Link to="/inventaire/commandes" className="mt-3 inline-block text-sm font-semibold text-primary hover:underline">Retour aux bons de commande</Link>
    </div>
  );

  const canReceive = po.status !== 'received' && po.status !== 'cancelled';

  const dateFr = (d: string | null) => d ? new Date(d).toLocaleDateString('fr-FR') : '—';

  return (
    <div className="mx-auto max-w-6xl pb-28 md:pb-0">
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0">
          <nav aria-label="Fil d’Ariane" className="hidden items-center gap-1.5 text-sm text-muted-foreground sm:flex">
            <button type="button" onClick={() => navigate('/inventaire/commandes')} className="hover:text-foreground">Commandes fournisseur</button>
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="text-foreground">{po.po_number}</span>
          </nav>
          <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">Bon de commande {po.po_number}</h1>
        </div>
        <StatusPill tone={STATUS[po.status].tone}>{STATUS[po.status].label}</StatusPill>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-4">
          <OpsSection title="Articles" aside={<span className="text-sm text-muted-foreground">{(po.items || []).length} ligne{(po.items || []).length !== 1 ? 's' : ''}</span>}>
            <div className={`hidden gap-x-4 border-b border-border bg-secondary/40 px-5 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground md:grid ${receiving ? 'grid-cols-[minmax(0,1fr)_6rem_8rem_7rem_7rem]' : 'grid-cols-[minmax(0,1fr)_6rem_8rem_7rem]'}`}>
              <span>Article</span><span className="text-right">Commandé</span><span>Reçu</span><span className="text-right">Coût u.</span>{receiving && <span className="text-right">À recevoir</span>}
            </div>
            <ul className="divide-y divide-border">
              {(po.items || []).map(it => {
                const pct = it.qty_ordered > 0 ? Math.min(100, (it.qty_received / it.qty_ordered) * 100) : 0;
                return (
                  <li key={it.id} className={`grid grid-cols-1 gap-y-2 px-4 py-3 sm:px-5 md:items-center md:gap-x-4 ${receiving ? 'md:grid-cols-[minmax(0,1fr)_6rem_8rem_7rem_7rem]' : 'md:grid-cols-[minmax(0,1fr)_6rem_8rem_7rem]'}`}>
                    <div className="min-w-0">
                      <p className="font-semibold leading-snug text-foreground">{it.label}</p>
                      <p className="truncate font-mono text-xs text-muted-foreground">{it.barcode}</p>
                    </div>
                    <div className={`grid items-center gap-3 md:contents ${receiving ? 'grid-cols-4' : 'grid-cols-3'}`}>
                      <p className="text-sm tabular-nums text-foreground md:text-right"><span className="block text-xs text-muted-foreground md:hidden">Commandé</span>{it.qty_ordered}</p>
                      <div className="text-sm">
                        <span className="block text-xs text-muted-foreground md:hidden">Reçu</span>
                        <span className="tabular-nums text-muted-foreground">{it.qty_received} / {it.qty_ordered}</span>
                        <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-secondary" aria-hidden="true">
                          <span className={`block h-full rounded-full ${pct >= 100 ? 'bg-emerald-500' : 'bg-amber-500'}`} style={{ width: `${pct}%` }} />
                        </span>
                      </div>
                      <p className="text-right text-sm tabular-nums text-foreground"><span className="block text-xs text-muted-foreground md:hidden">Coût u.</span>{formatMoney(Number(it.unit_cost))}</p>
                      {receiving && (
                        <label className="block">
                          <span className="block text-right text-xs text-muted-foreground md:sr-only">À recevoir</span>
                          <input type="number" min={0} value={recvQty[it.id!] ?? ''} onChange={e => setRecvQty(prev => ({ ...prev, [it.id!]: e.target.value }))}
                            className="h-10 w-full rounded-lg border border-primary/40 bg-background px-2 text-right text-sm font-semibold tabular-nums text-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
                        </label>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="flex items-baseline justify-between gap-2 border-t border-border px-5 py-3">
              <span className="font-semibold text-foreground">Total HT</span>
              <span className="text-lg font-bold tabular-nums text-foreground">{formatMoney(Number(po.total_ht))}</span>
            </div>
          </OpsSection>

          {po.notes && (
            <section className={`${opsPanel} flex gap-3 p-4 sm:p-5`}>
              <StickyNote className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <p className="text-sm text-foreground"><span className="font-semibold">Notes : </span>{po.notes}</p>
            </section>
          )}
        </div>

        <aside className="space-y-4 lg:sticky lg:top-4" aria-label="Détails et actions">
          <section className={`${opsPanel} p-5`}>
            <h2 className="font-semibold text-foreground">Commande</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Fournisseur</dt><dd className="truncate text-right font-medium text-foreground">{po.provider_name || 'Sans fournisseur'}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Date</dt><dd className="font-medium text-foreground">{dateFr(po.order_date)}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Date prévue</dt><dd className="font-medium text-foreground">{dateFr(po.expected_date)}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Emplacement</dt><dd className="font-medium text-foreground">{po.location_key || '—'}</dd></div>
            </dl>
            <div className="mt-3 flex items-baseline justify-between gap-2 border-t border-border pt-3">
              <span className="font-semibold text-foreground">Total HT</span>
              <span className="text-xl font-bold tabular-nums text-foreground">{formatMoney(Number(po.total_ht))}</span>
            </div>
            {!receiving && (canReceive || po.status === 'draft') && (
              <div className="mt-4 space-y-2">
                {canReceive && <button onClick={startReceive} disabled={busy} className={`${opsPrimaryBtn} w-full`}><PackageCheck className="h-4 w-4" />Réceptionner</button>}
                {po.status === 'draft' && <button onClick={() => setStatus('sent')} disabled={busy} className={`${opsSecondaryBtn} w-full`}><Send className="h-4 w-4" />Marquer envoyé</button>}
                {canReceive && <button onClick={cancelOrder} disabled={busy} className={`${opsSecondaryBtn} w-full text-red-700 dark:text-red-300`}><Ban className="h-4 w-4" />Annuler le bon</button>}
              </div>
            )}
          </section>

          {receiving && (
            <section className={`${opsPanel} border-primary/40 p-5`}>
              <h2 className="font-semibold text-foreground">Réception</h2>
              <p className="mt-1 text-xs text-muted-foreground">Saisissez les quantités reçues dans la colonne « À recevoir ».</p>
              <div className="mt-3">
                <label htmlFor="po-recv-location" className={opsLabel}>Emplacement de réception</label>
                <select id="po-recv-location" value={recvLocation} onChange={e => setRecvLocation(e.target.value)} className={opsField}>
                  {locations.map(l => <option key={l.id} value={l.abbreviation || l.name}>{l.name}</option>)}
                </select>
              </div>
              <button onClick={confirmReceive} disabled={busy} className={`${opsPrimaryBtn} mt-4 w-full`}>
                {busy ? <Loader className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />} Confirmer la réception
              </button>
              <button onClick={() => setReceiving(false)} className={`${opsSecondaryBtn} mt-2 w-full`}>Annuler</button>
            </section>
          )}
        </aside>
      </div>

      {(receiving || canReceive) && (
        <div className={opsPhoneBar}>
          <div className="mx-auto flex max-w-3xl items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground">Total HT</p>
              <p className="whitespace-nowrap text-lg font-bold tabular-nums leading-tight text-foreground">{formatMoney(Number(po.total_ht))}</p>
            </div>
            {receiving ? (
              <button onClick={confirmReceive} disabled={busy} className={opsPrimaryBtn}>
                {busy ? <Loader className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />} Confirmer
              </button>
            ) : (
              <button onClick={startReceive} disabled={busy} className={opsPrimaryBtn}><PackageCheck className="h-4 w-4" />Réceptionner</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
