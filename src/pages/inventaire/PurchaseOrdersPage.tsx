import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { ClipboardList, Plus, Trash2, Loader, Check, X } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { StatusPill, type StatusTone } from '../../components/lists/StatusPill';
import { DocumentCard } from '../../components/lists/DocumentCard';
import { formatMoney } from '../../utils/format';
import { OpsLoading, ProductSearch, ProductThumb, QtyStepper, SearchResult, stepperInput } from './StockOpsUi';
import { opsField, opsLabel, opsPrimaryBtn, opsSecondaryBtn } from './stockOpsStyles';
import type { Product, Provider, PurchaseOrderItem, PurchaseOrderStatus } from '../../types';
import { StockService } from '../../utils/supabaseStock';
import { StockLocationsService } from '../../utils/supabaseStockLocations';
import { PurchaseOrdersService } from '../../utils/supabasePurchaseOrders';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';
import { useAccessibleLocations } from '../../inventory/hooks/useAccessibleLocations';

const STATUS: Record<PurchaseOrderStatus, { label: string; tone: StatusTone }> = {
  draft:     { label: 'Brouillon', tone: 'neutral' },
  sent:      { label: 'Envoyé',    tone: 'info' },
  partial:   { label: 'Partiel',   tone: 'warning' },
  received:  { label: 'Reçu',      tone: 'success' },
  cancelled: { label: 'Annulé',    tone: 'danger' },
};

const th = 'px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground';

export default function PurchaseOrdersPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { currentUser } = useAuth();
  const { showToast } = useToast();
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const prefillBarcodes: string[] = (location.state as any)?.prefillBarcodes || [];

  useEffect(() => {
    if (prefillBarcodes.length > 0) setShowCreate(true);
  }, [prefillBarcodes.length]);

  const load = useCallback(async () => {
    setLoading(true);
    try { setOrders(await PurchaseOrdersService.list()); }
    catch (e: any) { showToast({ type: 'error', message: e?.message || 'Erreur' }); }
    finally { setLoading(false); }
  }, [showToast]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Commandes fournisseur" subtitle="Commandes fournisseurs → réception"
        actions={(
          <button onClick={() => setShowCreate(true)} className={opsPrimaryBtn}>
            <Plus className="h-4 w-4" /> Nouveau bon
          </button>
        )} />

      {loading ? <OpsLoading /> : (
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          {orders.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <ClipboardList className="mx-auto h-10 w-10 text-muted-foreground" aria-hidden="true" />
              <p className="mt-3 font-medium text-foreground">Aucun bon de commande</p>
            </div>
          ) : (
            <>
              <ul className="divide-y divide-border md:hidden">
                {orders.map(o => (
                  <DocumentCard key={o.id} to={`/inventaire/commandes/${o.id}`}
                    number={o.po_number}
                    status={<StatusPill tone={STATUS[o.status as PurchaseOrderStatus].tone}>{STATUS[o.status as PurchaseOrderStatus].label}</StatusPill>}
                    title={o.provider_name || '—'}
                    date={new Date(o.order_date).toLocaleDateString('fr-FR')}
                    amount={formatMoney(Number(o.total_ht))} />
                ))}
              </ul>
              <table className="hidden w-full text-sm md:table">
                <thead className="border-b border-border bg-secondary/40">
                  <tr>
                    <th className={`${th} text-left`}>N°</th>
                    <th className={`${th} text-left`}>Fournisseur</th>
                    <th className={`${th} text-left`}>Date</th>
                    <th className={`${th} text-right`}>Total HT</th>
                    <th className={`${th} text-left`}>Statut</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {orders.map(o => (
                    <tr key={o.id} onClick={() => navigate(`/inventaire/commandes/${o.id}`)} className="cursor-pointer hover:bg-secondary/60">
                      <td className="whitespace-nowrap px-3 py-2.5">
                        <Link to={`/inventaire/commandes/${o.id}`} onClick={e => e.stopPropagation()} className="font-mono font-semibold text-primary hover:underline">{o.po_number}</Link>
                      </td>
                      <td className="px-3 py-2.5 font-medium text-foreground">{o.provider_name || '—'}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">{new Date(o.order_date).toLocaleDateString('fr-FR')}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums text-foreground">{formatMoney(Number(o.total_ht))}</td>
                      <td className="px-3 py-2.5"><StatusPill tone={STATUS[o.status as PurchaseOrderStatus].tone}>{STATUS[o.status as PurchaseOrderStatus].label}</StatusPill></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}

      {showCreate && (
        <CreatePOModal
          createdBy={currentUser?.username || null}
          initialBarcodes={prefillBarcodes}
          onClose={() => setShowCreate(false)}
          onCreated={(id) => { setShowCreate(false); navigate(`/inventaire/commandes/${id}`); }}
        />
      )}
    </div>
  );
}

function CreatePOModal({ createdBy, initialBarcodes = [], onClose, onCreated }: { createdBy: string | null; initialBarcodes?: string[]; onClose: () => void; onCreated: (id: string) => void; }) {
  const { showToast } = useToast();
  const [products, setProducts] = useState<Product[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const { accessibleLocations: locations } = useAccessibleLocations();
  const [providerId, setProviderId] = useState('');
  const [locationKey, setLocationKey] = useState('');
  const [expected, setExpected] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<PurchaseOrderItem[]>([]);
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!locationKey && locations.length > 0) setLocationKey(locations[0].abbreviation || locations[0].name);
  }, [locationKey, locations]);

  useEffect(() => {
    (async () => {
      const [p, pr, settings] = await Promise.all([
        StockService.getProducts(), StockLocationsService.getProviders(),
        StockService.getStockSettings().catch(() => []),
      ]);
      setProducts(p); setProviders(pr);
      if (initialBarcodes.length > 0) {
        const reorderQty = new Map(settings.filter(s => !s.location_key).map(s => [s.barcode, s.reorder_qty]));
        const seeded = initialBarcodes
          .map(bc => p.find(x => x.barcode === bc))
          .filter((x): x is Product => !!x)
          .map(x => ({ barcode: x.barcode, label: x.name, qty_ordered: reorderQty.get(x.barcode) || 1, qty_received: 0, unit_cost: Number(x.buyprice) || 0 }));
        setLines(seeded);
      }
    })().catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

  const imageOf = new Map(products.map(p => [p.barcode, p.image]));

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-3" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div role="dialog" aria-modal="true" aria-labelledby="new-po-title"
        className="relative flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border border-border bg-card shadow-2xl sm:rounded-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 id="new-po-title" className="font-semibold text-foreground">Nouveau bon de commande</h2>
          <button onClick={onClose} aria-label="Fermer" className="flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="po-provider" className={opsLabel}>Fournisseur</label>
              <select id="po-provider" value={providerId} onChange={e => setProviderId(e.target.value)} className={opsField}>
                <option value="">—</option>
                {providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="po-location" className={opsLabel}>Emplacement de réception</label>
              <select id="po-location" value={locationKey} onChange={e => setLocationKey(e.target.value)} className={opsField}>
                {locations.map(l => <option key={l.id} value={l.abbreviation || l.name}>{l.name}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="po-expected" className={opsLabel}>Date prévue</label>
              <input id="po-expected" type="date" value={expected} onChange={e => setExpected(e.target.value)} className={opsField} />
            </div>
            <div>
              <label htmlFor="po-notes" className={opsLabel}>Notes</label>
              <input id="po-notes" value={notes} onChange={e => setNotes(e.target.value)} className={opsField} />
            </div>
          </div>

          <ProductSearch label="Articles" value={query} onChange={setQuery} placeholder="Ajouter un article…">
            {results.length > 0 && results.map(p => (
              <SearchResult key={p.barcode} image={p.image} name={p.name} detail={p.barcode} onClick={() => addLine(p)} />
            ))}
          </ProductSearch>

          {lines.length > 0 && (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {lines.map((l, i) => (
                <li key={l.barcode} className="grid grid-cols-[minmax(0,1fr)_2.5rem] items-center gap-x-3 gap-y-2 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_8.5rem_7rem_2.5rem]">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="hidden sm:block"><ProductThumb image={imageOf.get(l.barcode)} size="sm" /></span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{l.label}</p>
                      <p className="truncate font-mono text-xs text-muted-foreground">{l.barcode}</p>
                    </div>
                  </div>
                  <button onClick={() => rm(i)} aria-label={`Retirer ${l.label}`} className="flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive sm:order-last"><Trash2 className="h-4 w-4" /></button>
                  <div className="col-span-2 flex items-center justify-between gap-3 sm:contents">
                    <QtyStepper label="la quantité" onMinus={() => upd(i, 'qty_ordered', l.qty_ordered - 1)} onPlus={() => upd(i, 'qty_ordered', l.qty_ordered + 1)} minusDisabled={l.qty_ordered <= 1}
                      input={<input type="number" min={1} value={l.qty_ordered} onChange={e => upd(i, 'qty_ordered', Number(e.target.value))} aria-label="Quantité" className={stepperInput} />} />
                    <label className="flex items-center justify-end gap-1">
                      <span className="sr-only">Coût unitaire</span>
                      <input type="number" min={0} step="0.01" value={l.unit_cost} onChange={e => upd(i, 'unit_cost', Number(e.target.value))}
                        className="h-10 w-24 rounded-lg border border-input bg-background px-2 text-right text-sm tabular-nums text-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
                      <span className="text-sm text-muted-foreground">Dh</span>
                    </label>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3">
          <p className="text-sm text-muted-foreground">Total HT <span className="ml-1 text-base font-bold tabular-nums text-foreground">{formatMoney(total)}</span></p>
          <div className="flex gap-2">
            <button onClick={onClose} className={opsSecondaryBtn}>Annuler</button>
            <button onClick={submit} disabled={saving || lines.length === 0} className={opsPrimaryBtn}>
              {saving ? <Loader className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Créer le bon
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
