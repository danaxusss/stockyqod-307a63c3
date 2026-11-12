import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeftRight, Trash2, Loader, Check, ArrowRight, ArrowDown, AlertTriangle } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { OpsLoading, OpsSection, ProductSearch, ProductThumb, QtyStepper, SearchResult, stepperInput } from './StockOpsUi';
import { opsField, opsLabel, opsPanel, opsPhoneBar, opsPrimaryBtn, opsSecondaryBtn } from './stockOpsStyles';
import type { Product } from '../../types';
import { StockService } from '../../utils/supabaseStock';
import { useAccessibleLocations } from '../../inventory/hooks/useAccessibleLocations';
import { levelAt, locationCandidates } from '../../inventory/lib/locationKeys';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';

interface Line { barcode: string; name: string; qty: number; available: number; }

export default function StockTransferPage() {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { showToast } = useToast();

  const [products, setProducts] = useState<Product[]>([]);
  // Stock can only leave a location the user has access to; it may be sent to
  // any of the company's locations.
  const { locations, accessibleLocations } = useAccessibleLocations();
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  // Kept across retries so a transfer is never applied twice.
  const transferId = useRef(crypto.randomUUID());
  const [lines, setLines] = useState<Line[]>([]);
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const byBarcode = useMemo(() => new Map(products.map(p => [p.barcode, p])), [products]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setProducts(await StockService.getProducts());
    } catch (e: any) {
      showToast({ type: 'error', message: e?.message || 'Erreur de chargement' });
    } finally { setLoading(false); }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (!fromId && accessibleLocations.length > 0) setFromId(accessibleLocations[0].id); }, [accessibleLocations, fromId]);
  useEffect(() => {
    if (!toId && locations.length > 1) setToId((locations.find(l => l.id !== fromId) || locations[0]).id);
  }, [fromId, locations, toId]);

  const fromLoc = accessibleLocations.find(l => l.id === fromId);
  const toLoc = locations.find(l => l.id === toId);
  const fromCandidates = useMemo(() => locationCandidates(fromLoc), [fromLoc]);

  // When source changes, refresh available quantities on existing lines.
  useEffect(() => {
    setLines(prev => prev.map(l => ({ ...l, available: levelAt(byBarcode.get(l.barcode), fromCandidates) })));
  }, [fromCandidates, byBarcode]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return products.filter(p =>
      levelAt(p, fromCandidates) > 0 &&
      (p.name.toLowerCase().includes(q) || p.barcode.toLowerCase().includes(q) || (p.brand || '').toLowerCase().includes(q))
    ).slice(0, 8);
  }, [products, query, fromCandidates]);

  const addLine = (p: Product) => {
    if (lines.some(l => l.barcode === p.barcode)) { setQuery(''); return; }
    const available = levelAt(p, fromCandidates);
    setLines(prev => [...prev, { barcode: p.barcode, name: p.name, qty: Math.min(1, available), available }]);
    setQuery('');
  };
  const updateQty = (i: number, v: number) => setLines(prev => prev.map((l, idx) => idx === i ? { ...l, qty: v } : l));
  const removeLine = (i: number) => setLines(prev => prev.filter((_, idx) => idx !== i));

  const hasOverdraw = lines.some(l => l.qty > l.available);

  const validate = async () => {
    if (!fromLoc || !toLoc) { showToast({ type: 'error', message: 'Choisissez les emplacements' }); return; }
    if (fromLoc.id === toLoc.id) { showToast({ type: 'error', message: 'Source et destination identiques' }); return; }
    if (lines.length === 0) { showToast({ type: 'error', message: 'Ajoutez au moins un article' }); return; }
    if (lines.some(l => l.qty <= 0)) { showToast({ type: 'error', message: 'Quantités invalides' }); return; }
    if (hasOverdraw && !confirm('Certaines quantités dépassent le stock disponible à la source. Continuer (stock négatif) ?')) return;
    setSaving(true);
    const group = transferId.current;
    const ref = `Transfert ${fromLoc.name} → ${toLoc.name}`;
    try {
      // Both sides of every line in one transaction: stock cannot leave the
      // source without arriving at the destination, and a retry is ignored.
      const result = await StockService.applyMovements(`transfer:${group}`, lines.flatMap(l => [
        { barcode: l.barcode, locationKeys: fromCandidates, type: 'transfer_out' as const, quantity: l.qty,
          reason: ref, sourceType: 'transfer' as const, sourceId: group, transferGroupId: group, locationId: fromLoc.id },
        { barcode: l.barcode, locationKeys: locationCandidates(toLoc), type: 'transfer_in' as const, quantity: l.qty,
          reason: ref, sourceType: 'transfer' as const, sourceId: group, transferGroupId: group, locationId: toLoc.id },
      ]), currentUser?.username || null);
      showToast(result.duplicate
        ? { type: 'info', title: 'Transfert déjà enregistré', message: 'Ce transfert a déjà été appliqué.' }
        : { type: 'success', title: 'Transfert validé', message: `${lines.length} article(s) transférés` });
      navigate('/inventaire/mouvements');
    } catch (e: any) {
      showToast({ type: 'error', title: 'Erreur', message: e?.message || 'Échec du transfert' });
    } finally { setSaving(false); }
  };

  const units = lines.reduce((s, l) => s + (Number(l.qty) || 0), 0);

  return (
    <div className="mx-auto max-w-6xl pb-28 md:pb-0">
      <PageHeader title="Transfert de stock" subtitle="Déplacer des articles entre emplacements" />

      {loading ? <OpsLoading /> : (
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0 space-y-4">
            <section className={`${opsPanel} grid grid-cols-1 items-end gap-3 p-4 sm:grid-cols-[1fr_auto_1fr] sm:p-5`}>
              <div>
                <label htmlFor="transfer-from" className={opsLabel}>Depuis</label>
                <select id="transfer-from" value={fromId} onChange={e => setFromId(e.target.value)} className={opsField}>
                  {accessibleLocations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </div>
              <span className="-my-1 flex h-5 items-center justify-center text-muted-foreground sm:my-0 sm:h-11" aria-hidden="true">
                <ArrowRight className="hidden h-5 w-5 sm:block" /><ArrowDown className="h-5 w-5 sm:hidden" />
              </span>
              <div>
                <label htmlFor="transfer-to" className={opsLabel}>Vers</label>
                <select id="transfer-to" value={toId} onChange={e => setToId(e.target.value)} className={opsField}>
                  {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </div>
            </section>

            <section className={`${opsPanel} p-4 sm:p-5`}>
              <ProductSearch label="Ajouter un article (avec stock à la source)" value={query} onChange={setQuery} placeholder="Rechercher…">
                {results.length > 0 && results.map(p => (
                  <SearchResult key={p.barcode} image={p.image} name={p.name} detail={[p.brand, p.barcode].filter(Boolean).join(' · ')}
                    aside={<span className="tabular-nums">dispo {levelAt(p, fromCandidates)}</span>} onClick={() => addLine(p)} />
                ))}
              </ProductSearch>
            </section>

            <OpsSection title="Articles à transférer" aside={<span className="text-sm text-muted-foreground">{lines.length} ligne{lines.length !== 1 ? 's' : ''} · {units} unité{units !== 1 ? 's' : ''}</span>}>
              {lines.length === 0 ? (
                <div className="px-5 py-10 text-center">
                  <ArrowLeftRight className="mx-auto h-10 w-10 text-muted-foreground" aria-hidden="true" />
                  <p className="mt-3 font-medium text-foreground">Aucun article pour le moment</p>
                  <p className="mt-1 text-sm text-muted-foreground">Cherchez un article en stock à la source pour l’ajouter.</p>
                </div>
              ) : (
                <>
                  <div className="hidden grid-cols-[3rem_minmax(0,1fr)_6rem_8.5rem_2.5rem] gap-x-4 border-b border-border bg-secondary/40 px-5 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground md:grid">
                    <span /><span>Article</span><span className="text-right">Dispo</span><span className="text-center">Quantité</span><span />
                  </div>
                  <ul className="divide-y divide-border">
                    {lines.map((l, i) => {
                      const over = l.qty > l.available;
                      return (
                        <li key={l.barcode} className="grid grid-cols-[3rem_minmax(0,1fr)_2.5rem] items-center gap-x-3 gap-y-3 px-4 py-3 sm:px-5 md:grid-cols-[3rem_minmax(0,1fr)_6rem_8.5rem_2.5rem] md:gap-x-4">
                          <ProductThumb image={byBarcode.get(l.barcode)?.image} />
                          <div className="min-w-0">
                            <p className="font-semibold leading-snug text-foreground">{l.name}</p>
                            <p className="truncate font-mono text-xs text-muted-foreground">{l.barcode}</p>
                          </div>
                          <button onClick={() => removeLine(i)} aria-label={`Retirer ${l.name}`}
                            className="flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive md:order-last">
                            <Trash2 className="h-4 w-4" />
                          </button>
                          <div className="col-span-3 flex items-center justify-between gap-3 md:contents">
                            <p className="text-sm tabular-nums text-muted-foreground md:text-right"><span className="md:hidden">Dispo </span>{l.available}</p>
                            <div className={`rounded-lg md:justify-self-center ${over ? 'ring-2 ring-destructive/60' : ''}`}>
                              <QtyStepper label="la quantité" onMinus={() => updateQty(i, l.qty - 1)} onPlus={() => updateQty(i, l.qty + 1)} minusDisabled={l.qty <= 1}
                                input={<input type="number" min={1} value={l.qty} onChange={e => updateQty(i, Number(e.target.value))} aria-label="Quantité" aria-invalid={over} className={stepperInput} />} />
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </OpsSection>

            {hasOverdraw && (
              <p className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-red-700 dark:text-red-300" role="alert">
                <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />Certaines quantités dépassent le stock disponible à la source.
              </p>
            )}
          </div>

          <aside className="space-y-4 lg:sticky lg:top-4" aria-label="Récapitulatif">
            <section className={`${opsPanel} p-5`}>
              <h2 className="font-semibold text-foreground">Récapitulatif</h2>
              <dl className="mt-3 space-y-2 text-sm">
                <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Depuis</dt><dd className="truncate font-medium text-foreground">{fromLoc?.name || '—'}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Vers</dt><dd className="truncate font-medium text-foreground">{toLoc?.name || '—'}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Articles</dt><dd className="font-medium tabular-nums text-foreground">{lines.length}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Unités</dt><dd className="font-medium tabular-nums text-foreground">{units}</dd></div>
              </dl>
              <button onClick={validate} disabled={saving || lines.length === 0} className={`${opsPrimaryBtn} mt-4 w-full`}>
                {saving ? <Loader className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Valider le transfert
              </button>
              <button onClick={() => navigate('/inventaire')} className={`${opsSecondaryBtn} mt-2 w-full`}>Annuler</button>
            </section>
          </aside>

          <div className={opsPhoneBar}>
            <div className="mx-auto flex max-w-3xl items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs text-muted-foreground">{fromLoc?.name || '—'} → {toLoc?.name || '—'}</p>
                <p className="whitespace-nowrap text-lg font-bold tabular-nums leading-tight text-foreground">{units} unité{units !== 1 ? 's' : ''}</p>
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
