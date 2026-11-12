import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Trash2, Loader, Check, PackagePlus } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { formatMoney } from '../../utils/format';
import { OpsLoading, OpsSection, ProductSearch, ProductThumb, QtyStepper, SearchResult, stepperInput } from './StockOpsUi';
import { opsField, opsLabel, opsPanel, opsPhoneBar, opsPrimaryBtn, opsSecondaryBtn } from './stockOpsStyles';
import type { Product } from '../../types';
import { StockService } from '../../utils/supabaseStock';
import { useAccessibleLocations } from '../../inventory/hooks/useAccessibleLocations';
import { locationCandidates } from '../../inventory/lib/locationKeys';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';

interface Line { barcode: string; name: string; qty: number; unitCost: number; }

export default function StockReceivePage() {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { showToast } = useToast();

  const [products, setProducts] = useState<Product[]>([]);
  const { accessibleLocations: locations } = useAccessibleLocations();
  const [locationId, setLocationId] = useState('');
  // Kept across retries so a reception is never entered twice.
  const receiptId = useRef(crypto.randomUUID());
  const [lines, setLines] = useState<Line[]>([]);
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setProducts(await StockService.getProducts());
    } catch (e: any) {
      showToast({ type: 'error', message: e?.message || 'Erreur de chargement' });
    } finally { setLoading(false); }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (!locationId && locations.length > 0) setLocationId(locations[0].id); }, [locationId, locations]);

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
  const location = locations.find(l => l.id === locationId);

  const validate = async () => {
    if (!location) { showToast({ type: 'error', message: 'Choisissez un emplacement' }); return; }
    if (lines.length === 0) { showToast({ type: 'error', message: 'Ajoutez au moins un article' }); return; }
    if (lines.some(l => l.qty <= 0)) { showToast({ type: 'error', message: 'Quantités invalides' }); return; }
    setSaving(true);
    const ref = `Réception ${new Date().toLocaleDateString('fr-FR')}`;
    try {
      // The whole reception in one transaction, once (retries are ignored).
      const result = await StockService.applyMovements(`receipt:${receiptId.current}`, lines.map(l => ({
        barcode: l.barcode,
        locationKeys: locationCandidates(location),
        type: 'in' as const,
        quantity: l.qty,
        unitCost: l.unitCost || null,
        reason: ref,
        sourceType: 'receipt' as const,
        sourceId: receiptId.current,
        locationId: location.id,
      })), currentUser?.username || null);
      showToast(result.duplicate
        ? { type: 'info', title: 'Réception déjà enregistrée', message: 'Cette réception a déjà été entrée en stock.' }
        : { type: 'success', title: 'Réception validée', message: `${lines.length} article(s) entrés en stock` });
      navigate('/inventaire/mouvements');
    } catch (e: any) {
      showToast({ type: 'error', title: 'Erreur', message: e?.message || 'Échec de la réception' });
    } finally { setSaving(false); }
  };

  // Photos for the lines and results (display only).
  const imageOf = useMemo(() => new Map(products.map(p => [p.barcode, p.image])), [products]);
  const units = lines.reduce((s, l) => s + (Number(l.qty) || 0), 0);

  return (
    <div className="mx-auto max-w-6xl pb-28 md:pb-0">
      <PageHeader title="Réception de stock" subtitle="Entrée de marchandises — met à jour le CMUP" />

      {loading ? <OpsLoading /> : (
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0 space-y-4">
            <section className={`${opsPanel} grid gap-4 p-4 sm:p-5 md:grid-cols-[16rem_minmax(0,1fr)]`}>
              <div>
                <label htmlFor="receive-location" className={opsLabel}>Emplacement de réception</label>
                <select id="receive-location" value={locationId} onChange={e => setLocationId(e.target.value)} className={opsField}>
                  {locations.length === 0 && <option value="">Aucun emplacement accessible</option>}
                  {locations.map(l => (
                    <option key={l.id} value={l.id}>{l.name}{l.abbreviation ? ` (${l.abbreviation})` : ''}</option>
                  ))}
                </select>
              </div>
              <ProductSearch label="Ajouter un article" value={query} onChange={setQuery} placeholder="Rechercher article, code, marque…">
                {results.length > 0 && results.map(p => (
                  <SearchResult key={p.barcode} image={p.image} name={p.name} detail={[p.brand, p.barcode].filter(Boolean).join(' · ')} onClick={() => addLine(p)} />
                ))}
              </ProductSearch>
            </section>

            <OpsSection title="Articles reçus" aside={<span className="text-sm text-muted-foreground">{lines.length} ligne{lines.length !== 1 ? 's' : ''} · {units} unité{units !== 1 ? 's' : ''}</span>}>
              {lines.length === 0 ? (
                <div className="px-5 py-10 text-center">
                  <PackagePlus className="mx-auto h-10 w-10 text-muted-foreground" aria-hidden="true" />
                  <p className="mt-3 font-medium text-foreground">Aucun article pour le moment</p>
                  <p className="mt-1 text-sm text-muted-foreground">Cherchez un article ci-dessus pour l’ajouter à la réception.</p>
                </div>
              ) : (
                <>
                  <div className="hidden grid-cols-[3rem_minmax(0,1fr)_8.5rem_8rem_7.5rem_2.5rem] gap-x-4 border-b border-border bg-secondary/40 px-5 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground md:grid">
                    <span /><span>Article</span><span className="text-center">Quantité</span><span className="text-right">Coût unitaire</span><span className="text-right">Total</span><span />
                  </div>
                  <ul className="divide-y divide-border">
                    {lines.map((l, i) => (
                      <li key={l.barcode} className="grid grid-cols-[3rem_minmax(0,1fr)_2.5rem] items-center gap-x-3 gap-y-3 px-4 py-3 sm:px-5 md:grid-cols-[3rem_minmax(0,1fr)_8.5rem_8rem_7.5rem_2.5rem] md:gap-x-4">
                        <ProductThumb image={imageOf.get(l.barcode)} />
                        <div className="min-w-0">
                          <p className="font-semibold leading-snug text-foreground">{l.name}</p>
                          <p className="truncate font-mono text-xs text-muted-foreground">{l.barcode}</p>
                        </div>
                        <button onClick={() => removeLine(i)} aria-label={`Retirer ${l.name}`}
                          className="flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive md:order-last">
                          <Trash2 className="h-4 w-4" />
                        </button>
                        <div className="col-span-3 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 md:contents">
                          <div className="md:justify-self-center">
                            <QtyStepper label="la quantité" onMinus={() => updateLine(i, 'qty', l.qty - 1)} onPlus={() => updateLine(i, 'qty', l.qty + 1)} minusDisabled={l.qty <= 1}
                              input={<input type="number" min={1} value={l.qty} onChange={e => updateLine(i, 'qty', Number(e.target.value))} aria-label="Quantité" className={stepperInput} />} />
                          </div>
                          <label className="order-3 col-span-2 flex items-center justify-end gap-1 md:order-none md:col-span-1">
                            <span className="mr-auto text-xs text-muted-foreground md:sr-only">Coût unitaire (MAD)</span>
                            <input type="number" min={0} step="0.01" value={l.unitCost} onChange={e => updateLine(i, 'unitCost', Number(e.target.value))}
                              className="h-10 w-24 rounded-lg border border-input bg-background px-2 text-right text-sm tabular-nums text-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
                            <span className="text-sm text-muted-foreground">Dh</span>
                          </label>
                          <p className="order-2 text-right font-semibold tabular-nums text-foreground md:order-none">{formatMoney(l.qty * l.unitCost)}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </OpsSection>
          </div>

          <aside className="space-y-4 lg:sticky lg:top-4" aria-label="Récapitulatif">
            <section className={`${opsPanel} p-5`}>
              <h2 className="font-semibold text-foreground">Récapitulatif</h2>
              <dl className="mt-3 space-y-2 text-sm">
                <div className="flex justify-between"><dt className="text-muted-foreground">Emplacement</dt><dd className="font-medium text-foreground">{location?.name || '—'}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Articles</dt><dd className="font-medium tabular-nums text-foreground">{lines.length}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Unités</dt><dd className="font-medium tabular-nums text-foreground">{units}</dd></div>
              </dl>
              <div className="mt-3 flex items-baseline justify-between gap-2 border-t border-border pt-3">
                <span className="font-semibold text-foreground">Total réception</span>
                <span className="text-xl font-bold tabular-nums text-foreground">{formatMoney(total)}</span>
              </div>
              <button onClick={validate} disabled={saving || lines.length === 0} className={`${opsPrimaryBtn} mt-4 w-full`}>
                {saving ? <Loader className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Valider la réception
              </button>
              <button onClick={() => navigate('/inventaire')} className={`${opsSecondaryBtn} mt-2 w-full`}>Annuler</button>
            </section>
          </aside>

          <div className={opsPhoneBar}>
            <div className="mx-auto flex max-w-3xl items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">Total réception</p>
                <p className="whitespace-nowrap text-lg font-bold tabular-nums leading-tight text-foreground">{formatMoney(total)}</p>
              </div>
              <button onClick={validate} disabled={saving || lines.length === 0} className={opsPrimaryBtn}>
                {saving ? <Loader className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Valider
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
