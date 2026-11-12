import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardCheck, Loader, Check, AlertTriangle } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { OpsLoading, OpsSection, ProductSearch, ProductThumb, SearchResult } from './StockOpsUi';
import { opsField, opsLabel, opsPanel, opsPhoneBar, opsPrimaryBtn, opsSecondaryBtn } from './stockOpsStyles';
import type { Product } from '../../types';
import { StockService } from '../../utils/supabaseStock';
import { useAccessibleLocations } from '../../inventory/hooks/useAccessibleLocations';
import { levelAt, locationCandidates } from '../../inventory/lib/locationKeys';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';

interface CountRow { barcode: string; name: string; expected: number; counted: string; }

export default function StockCountPage() {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { showToast } = useToast();

  const [products, setProducts] = useState<Product[]>([]);
  const { accessibleLocations: locations, loading: locationsLoading } = useAccessibleLocations();
  const [locationId, setLocationId] = useState('');
  const [rows, setRows] = useState<CountRow[]>([]);
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  // One id per count sheet, kept across retries: the database applies a count
  // once even if "Valider" is pressed again after a network error.
  const sessionId = useRef(crypto.randomUUID());

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

  const loc = locations.find(l => l.id === locationId);
  const candidates = useMemo(() => locationCandidates(loc), [loc]);

  // Populate the sheet with products that have stock at the chosen location,
  // whatever key (abbreviation, name…) the product stores it under.
  useEffect(() => {
    if (!candidates.length) return;
    const seed = products
      .filter(p => levelAt(p, candidates) !== 0)
      .map(p => ({ barcode: p.barcode, name: p.name, expected: levelAt(p, candidates), counted: '' }));
    setRows(seed);
  }, [candidates, products]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return products.filter(p =>
      !rows.some(r => r.barcode === p.barcode) &&
      (p.name.toLowerCase().includes(q) || p.barcode.toLowerCase().includes(q) || (p.brand || '').toLowerCase().includes(q))
    ).slice(0, 8);
  }, [products, query, rows]);

  const addRow = (p: Product) => {
    setRows(prev => [...prev, { barcode: p.barcode, name: p.name, expected: levelAt(p, candidates), counted: '' }]);
    setQuery('');
  };
  const setCounted = (i: number, v: string) => setRows(prev => prev.map((r, idx) => idx === i ? { ...r, counted: v } : r));

  // Every counted line is sent with the quantity counted: the database sets the
  // level to it, measured against the stock at that moment (not when the sheet
  // was opened), so sales made during the count are not counted twice.
  const counted = rows.filter(r => r.counted !== '' && !isNaN(parseFloat(r.counted)));
  const changed = counted.filter(r => parseFloat(r.counted) !== r.expected);

  const validate = async () => {
    if (!loc) { showToast({ type: 'error', message: 'Choisissez un emplacement' }); return; }
    if (counted.length === 0) { showToast({ type: 'info', message: 'Aucune quantité saisie' }); return; }
    setSaving(true);
    const ref = `Inventaire ${loc.name} ${new Date().toLocaleDateString('fr-FR')}`;
    try {
      const result = await StockService.applyMovements(`count:${sessionId.current}`, counted.map(r => ({
        barcode: r.barcode, locationKeys: candidates, type: 'count' as const, counted: parseFloat(r.counted),
        reason: ref, sourceType: 'count' as const, sourceId: sessionId.current, locationId: loc.id,
      })), currentUser?.username || null);
      showToast(result.duplicate
        ? { type: 'info', title: 'Inventaire déjà validé', message: 'Cet inventaire a déjà été enregistré.' }
        : { type: 'success', title: 'Inventaire validé', message: `${result.movements.length} écart(s) enregistré(s)` });
      navigate('/inventaire/mouvements');
    } catch (e: any) {
      showToast({ type: 'error', title: 'Erreur', message: e?.message || 'Échec de l\'inventaire' });
    } finally { setSaving(false); }
  };

  // Photos for the sheet (display only).
  const imageOf = useMemo(() => new Map(products.map(p => [p.barcode, p.image])), [products]);

  return (
    <div className="mx-auto max-w-6xl pb-28 md:pb-0">
      <PageHeader title="Inventaire physique" subtitle="Comptez, saisissez le réel — seuls les écarts génèrent un mouvement" />

      {loading || locationsLoading ? <OpsLoading /> : (
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0 space-y-4">
            <section className={`${opsPanel} grid gap-4 p-4 sm:p-5 md:grid-cols-[16rem_minmax(0,1fr)]`}>
              <div>
                <label htmlFor="count-location" className={opsLabel}>Emplacement à inventorier</label>
                <select id="count-location" value={locationId} onChange={e => setLocationId(e.target.value)} className={opsField}>
                  {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
                {!locationsLoading && locations.length === 0 && (
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-300"><AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />Aucun emplacement accessible avec votre compte.</p>
                )}
              </div>
              <ProductSearch label="Ajouter un article absent de la liste" value={query} onChange={setQuery} placeholder="Ajouter un article absent de la liste…">
                {results.length > 0 && results.map(p => (
                  <SearchResult key={p.barcode} image={p.image} name={p.name} detail={[p.brand, p.barcode].filter(Boolean).join(' · ')} onClick={() => addRow(p)} />
                ))}
              </ProductSearch>
            </section>

            <OpsSection title="Feuille de comptage" aside={<span className="text-sm text-muted-foreground">{rows.length} article{rows.length !== 1 ? 's' : ''}</span>}>
              {rows.length === 0 ? (
                <div className="px-5 py-10 text-center">
                  <ClipboardCheck className="mx-auto h-10 w-10 text-muted-foreground" aria-hidden="true" />
                  <p className="mt-3 font-medium text-foreground">Aucun article en stock à cet emplacement</p>
                </div>
              ) : (
                <>
                  <div className="hidden grid-cols-[3rem_minmax(0,1fr)_6rem_7rem_5rem] gap-x-4 border-b border-border bg-secondary/40 px-5 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground md:grid">
                    <span /><span>Article</span><span className="text-right">Théorique</span><span className="text-right">Compté</span><span className="text-right">Écart</span>
                  </div>
                  <ul className="divide-y divide-border">
                    {rows.map((r, i) => {
                      const cn = r.counted === '' ? null : parseFloat(r.counted);
                      const variance = cn == null || isNaN(cn) ? null : cn - r.expected;
                      return (
                        <li key={r.barcode} className="grid grid-cols-[3rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-5 md:grid-cols-[3rem_minmax(0,1fr)_6rem_7rem_5rem] md:gap-x-4">
                          <ProductThumb image={imageOf.get(r.barcode)} />
                          <div className="min-w-0">
                            <p className="font-semibold leading-snug text-foreground">{r.name}</p>
                            <p className="truncate font-mono text-xs text-muted-foreground">{r.barcode}</p>
                          </div>
                          <div className="col-span-2 grid grid-cols-3 items-center gap-3 md:contents">
                            <p className="text-sm tabular-nums text-muted-foreground md:text-right"><span className="block text-xs md:hidden">Théorique</span>{r.expected}</p>
                            <label className="block">
                              <span className="block text-xs text-muted-foreground md:sr-only">Compté</span>
                              <input type="number" value={r.counted} onChange={e => setCounted(i, e.target.value)} placeholder="—"
                                className="h-10 w-full rounded-lg border border-input bg-background px-2 text-right text-sm font-semibold tabular-nums text-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
                            </label>
                            <p className={`text-right text-sm font-semibold tabular-nums ${variance == null ? 'text-muted-foreground/40' : variance === 0 ? 'text-muted-foreground' : variance > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                              <span className="block text-xs font-normal text-muted-foreground md:hidden">Écart</span>
                              {variance == null ? '—' : variance === 0 ? '0' : `${variance > 0 ? '+' : ''}${variance}`}
                            </p>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </OpsSection>
          </div>

          <aside className="space-y-4 lg:sticky lg:top-4" aria-label="Récapitulatif">
            <section className={`${opsPanel} p-5`}>
              <h2 className="font-semibold text-foreground">Récapitulatif</h2>
              <dl className="mt-3 space-y-2 text-sm">
                <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Emplacement</dt><dd className="truncate font-medium text-foreground">{loc?.name || '—'}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Articles comptés</dt><dd className="font-medium tabular-nums text-foreground">{counted.length}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Écarts</dt><dd className={`font-semibold tabular-nums ${changed.length > 0 ? 'text-amber-700 dark:text-amber-300' : 'text-foreground'}`}>{changed.length}</dd></div>
              </dl>
              <button onClick={validate} disabled={saving || counted.length === 0} className={`${opsPrimaryBtn} mt-4 w-full`}>
                {saving ? <Loader className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Valider l'inventaire
              </button>
              <button onClick={() => navigate('/inventaire')} className={`${opsSecondaryBtn} mt-2 w-full`}>Annuler</button>
            </section>
          </aside>

          <div className={opsPhoneBar}>
            <div className="mx-auto flex max-w-3xl items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">{counted.length} article(s) compté(s)</p>
                <p className="whitespace-nowrap text-lg font-bold tabular-nums leading-tight text-foreground">{changed.length} écart(s)</p>
              </div>
              <button onClick={validate} disabled={saving || counted.length === 0} className={opsPrimaryBtn}>
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
