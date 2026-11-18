import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AlertTriangle, Check, ChevronRight, FileDown, Loader, PackageMinus, PackagePlus, Save, Trash2, Undo2 } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { StatusPill } from '../../components/lists/StatusPill';
import { OpsLoading, OpsSection, ProductSearch, ProductThumb, QtyStepper, SearchResult, stepperInput } from './StockOpsUi';
import { opsField, opsLabel, opsPanel, opsPhoneBar, opsPrimaryBtn, opsSecondaryBtn } from './stockOpsStyles';
import type { Product } from '../../types';
import { StockService } from '../../utils/supabaseStock';
import { useAccessibleLocations } from '../../inventory/hooks/useAccessibleLocations';
import { levelAt, locationCandidates } from '../../inventory/lib/locationKeys';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';
import { toDateInputValue, formatMoney } from '../../utils/format';
import {
  costUpdatesAverage, draftProblems, isNegativeStockRefusal, KIND_LABEL, reasonLabel, StockVouchersService,
  VOUCHER_REASONS, VOUCHER_STATUS, voucherErrorMessage, type StockVoucher, type StockVoucherLine, type VoucherKind,
} from '../../utils/stockVouchers';

/**
 * One Bon d'entrée / Bon de sortie: a draft can be edited, saved, deleted or
 * validated (which moves the stock); a validated one is read-only and can be
 * printed or cancelled (which moves the stock back).
 */
export default function StockVoucherPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { currentUser, isAdmin } = useAuth();
  const { showToast } = useToast();
  const { accessibleLocations } = useAccessibleLocations();

  const isNew = !id || id === 'nouveau';
  const [voucher, setVoucher] = useState<StockVoucher | null>(null);
  const [kind, setKind] = useState<VoucherKind>(params.get('type') === 'sortie' ? 'sortie' : 'entree');
  const [date, setDate] = useState(toDateInputValue());
  const [locationId, setLocationId] = useState('');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<StockVoucherLine[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'' | 'save' | 'validate' | 'delete' | 'cancel' | 'pdf'>('');

  const editable = isNew || voucher?.status === 'draft';
  const byBarcode = useMemo(() => new Map(products.map(p => [p.barcode, p])), [products]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, existing] = await Promise.all([
        StockService.getProducts(),
        isNew ? Promise.resolve(null) : StockVouchersService.get(id as string),
      ]);
      setProducts(list);
      if (!isNew) {
        if (!existing) { showToast({ type: 'error', message: 'Bon introuvable' }); navigate('/inventaire/bons'); return; }
        setVoucher(existing);
        setKind(existing.kind);
        setDate(existing.voucher_date);
        setLocationId(existing.location_id || '');
        setReason(existing.reason);
        setNote(existing.note || '');
        setLines(existing.lines || []);
      }
    } catch (e) {
      showToast({ type: 'error', message: voucherErrorMessage(e) });
    } finally { setLoading(false); }
  }, [id, isNew, navigate, showToast]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => { if (!locationId && accessibleLocations.length > 0 && editable) setLocationId(accessibleLocations[0].id); }, [accessibleLocations, locationId, editable]);
  useEffect(() => { if (!reason) setReason(VOUCHER_REASONS[kind][0].value); }, [kind, reason]);

  const location = accessibleLocations.find(l => l.id === locationId);
  const candidates = useMemo(() => locationCandidates(location), [location]);
  const available = useCallback((barcode: string) => levelAt(byBarcode.get(barcode), candidates), [byBarcode, candidates]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return products.filter(p => (kind === 'entree' || available(p.barcode) > 0)
      && (p.name.toLowerCase().includes(q) || p.barcode.toLowerCase().includes(q) || (p.brand || '').toLowerCase().includes(q))).slice(0, 8);
  }, [products, query, kind, available]);

  const addLine = (p: Product) => {
    setQuery('');
    if (lines.some(l => l.barcode === p.barcode)) return;
    setLines(prev => [...prev, { barcode: p.barcode, product_name: p.name, quantity: 1, unit_cost: null }]);
  };
  const updateLine = (i: number, patch: Partial<StockVoucherLine>) => setLines(prev => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const removeLine = (i: number) => setLines(prev => prev.filter((_, idx) => idx !== i));

  const shortages = kind === 'sortie' ? lines.filter(l => Number(l.quantity) > available(l.barcode)) : [];
  const units = lines.reduce((s, l) => s + (Number(l.quantity) || 0), 0);
  const problems = draftProblems({ location_id: locationId || null, reason, lines });

  const save = async (): Promise<string | null> => {
    if (problems.length) { showToast({ type: 'error', message: problems[0] }); return null; }
    const savedId = await StockVouchersService.saveDraft({
      id: voucher?.id, kind, voucher_date: date, location_id: locationId || null, reason, note,
      created_by: currentUser?.username || null, lines,
    });
    return savedId;
  };

  const onSave = async () => {
    setBusy('save');
    try {
      const savedId = await save();
      if (!savedId) return;
      showToast({ type: 'success', message: 'Brouillon enregistré' });
      if (isNew) navigate(`/inventaire/bons/${savedId}`, { replace: true }); else await load();
    } catch (e) { showToast({ type: 'error', message: voucherErrorMessage(e) }); }
    finally { setBusy(''); }
  };

  const onValidate = async () => {
    const action = kind === 'entree' ? 'ajoutera' : 'retirera';
    if (!confirm(`Valider ce ${KIND_LABEL[kind].toLowerCase()} ? Il ${action} ${units} unité${units !== 1 ? 's' : ''} au stock de ${location?.name || 'l’emplacement'} et ne pourra plus être modifié.`)) return;
    setBusy('validate');
    let savedId: string | null = null;
    try {
      savedId = await save();
      if (!savedId) return;
      const result = await StockVouchersService.validate(savedId);
      showToast({ type: 'success', title: `${result.number} validé`, message: `${result.movements} mouvement${result.movements !== 1 ? 's' : ''} de stock` });
      if (isNew) navigate(`/inventaire/bons/${savedId}`, { replace: true }); else await load();
    } catch (e) {
      // Stock would go below zero: only an admin may push it through.
      if (savedId && isNegativeStockRefusal(e) && isAdmin
        && confirm(`${voucherErrorMessage(e)}\n\nEn tant qu’administrateur, vous pouvez valider quand même : le stock deviendra négatif. Continuer ?`)) {
        try {
          const result = await StockVouchersService.validate(savedId, true);
          showToast({ type: 'warning', title: `${result.number} validé`, message: 'Stock négatif accepté par un administrateur.' });
          if (isNew) navigate(`/inventaire/bons/${savedId}`, { replace: true }); else await load();
        } catch (e2) { showToast({ type: 'error', message: voucherErrorMessage(e2) }); }
      } else {
        showToast({ type: 'error', title: 'Validation refusée', message: voucherErrorMessage(e) });
        if (savedId && isNew) navigate(`/inventaire/bons/${savedId}`, { replace: true });
      }
    } finally { setBusy(''); }
  };

  const onDelete = async () => {
    if (!voucher || !confirm('Supprimer ce brouillon ?')) return;
    setBusy('delete');
    try { await StockVouchersService.deleteDraft(voucher.id); showToast({ type: 'success', message: 'Brouillon supprimé' }); navigate('/inventaire/bons'); }
    catch (e) { showToast({ type: 'error', message: voucherErrorMessage(e) }); }
    finally { setBusy(''); }
  };

  const onCancel = async () => {
    if (!voucher) return;
    const why = prompt(`Annuler ${voucher.number} ? Le stock sera remis comme avant ce bon.\n\nMotif de l’annulation :`);
    if (why === null) return;
    setBusy('cancel');
    try {
      const result = await StockVouchersService.cancel(voucher.id, why);
      showToast({ type: 'success', title: `${voucher.number} annulé`, message: `${result.reversed} mouvement${result.reversed !== 1 ? 's' : ''} inverse${result.reversed !== 1 ? 's' : ''}` });
      await load();
    } catch (e) { showToast({ type: 'error', message: voucherErrorMessage(e) }); }
    finally { setBusy(''); }
  };

  const onPdf = async () => {
    if (!voucher) return;
    setBusy('pdf');
    try {
      const [{ exportStockVoucherPdf }, { CompanySettingsService }] = await Promise.all([import('../../utils/stockVoucherPdf'), import('../../utils/companySettings')]);
      const settings = await CompanySettingsService.getSettings(voucher.company_id || undefined).catch(() => null);
      exportStockVoucherPdf({ ...voucher, lines }, { locationName: location?.name || '—', settings });
    } catch (e) { showToast({ type: 'error', message: voucherErrorMessage(e) }); }
    finally { setBusy(''); }
  };

  if (loading) return <div className="mx-auto max-w-[110rem]"><OpsLoading /></div>;

  const title = voucher?.number ? `${KIND_LABEL[kind]} ${voucher.number}` : `Nouveau ${KIND_LABEL[kind].toLowerCase()}`;
  const KindIcon = kind === 'entree' ? PackagePlus : PackageMinus;
  const spinner = (name: typeof busy) => (busy === name ? <Loader className="h-4 w-4 animate-spin" aria-hidden="true" /> : null);

  return (
    <div className="mx-auto max-w-[110rem] pb-28 md:pb-0">
      <nav className="mb-2 flex items-center gap-1 text-sm text-muted-foreground" aria-label="Fil d’Ariane">
        <Link to="/inventaire/bons" className="hover:text-foreground hover:underline">Bons d'entrée et de sortie</Link>
        <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" /><span className="text-foreground">{voucher?.number || 'Brouillon'}</span>
      </nav>
      <PageHeader
        title={<span className="inline-flex items-center gap-2">{title}{voucher && <StatusPill tone={VOUCHER_STATUS[voucher.status].tone}>{VOUCHER_STATUS[voucher.status].label}</StatusPill>}</span>}
        subtitle={editable ? 'Brouillon : le stock ne bouge qu’à la validation.' : voucher?.status === 'validated'
          ? `Validé par ${voucher.validated_by || '—'} le ${voucher.validated_at ? new Date(voucher.validated_at).toLocaleString('fr-FR') : '—'}${voucher.negative_override ? ' · stock négatif accepté' : ''}`
          : `Annulé par ${voucher?.cancelled_by || '—'}${voucher?.cancel_reason ? ` · ${voucher.cancel_reason}` : ''}`}
        actions={!editable && voucher ? (
          <>
            <button onClick={onPdf} disabled={!!busy} className={opsSecondaryBtn}>{spinner('pdf') || <FileDown className="h-4 w-4" aria-hidden="true" />} PDF</button>
            {voucher.status === 'validated' && (
              <button onClick={onCancel} disabled={!!busy} className={`${opsSecondaryBtn} text-red-700 dark:text-red-300`}>{spinner('cancel') || <Undo2 className="h-4 w-4" aria-hidden="true" />} Annuler le bon</button>
            )}
          </>
        ) : undefined}
      />

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-4">
          <section className={`${opsPanel} grid gap-3 p-4 sm:grid-cols-2 sm:p-5 xl:grid-cols-4`}>
            <div>
              <label htmlFor="voucher-kind" className={opsLabel}>Type</label>
              <select id="voucher-kind" value={kind} disabled={!isNew} onChange={e => { const k = e.target.value as VoucherKind; setKind(k); setReason(VOUCHER_REASONS[k][0].value); }} className={opsField}>
                <option value="entree">Bon d'entrée</option>
                <option value="sortie">Bon de sortie</option>
              </select>
            </div>
            <div>
              <label htmlFor="voucher-date" className={opsLabel}>Date</label>
              <input id="voucher-date" type="date" value={date} disabled={!editable} onChange={e => setDate(e.target.value)} className={opsField} />
            </div>
            <div>
              <label htmlFor="voucher-location" className={opsLabel}>Emplacement</label>
              <select id="voucher-location" value={locationId} disabled={!editable} onChange={e => setLocationId(e.target.value)} className={opsField}>
                {!editable && location == null && <option value="">—</option>}
                {accessibleLocations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="voucher-reason" className={opsLabel}>Motif</label>
              <select id="voucher-reason" value={reason} disabled={!editable} onChange={e => setReason(e.target.value)} className={opsField}>
                {VOUCHER_REASONS[kind].map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2 xl:col-span-4">
              <label htmlFor="voucher-note" className={opsLabel}>Note</label>
              <input id="voucher-note" value={note} disabled={!editable} onChange={e => setNote(e.target.value)} placeholder="Ex. palette abîmée à la livraison, salon de mars…" className={opsField} />
            </div>
          </section>

          {editable && (
            <section className={`${opsPanel} p-4 sm:p-5`}>
              <ProductSearch label={kind === 'entree' ? 'Ajouter un article' : 'Ajouter un article (en stock à cet emplacement)'} value={query} onChange={setQuery} placeholder="Nom, référence ou marque…">
                {results.map(p => (
                  <SearchResult key={p.barcode} image={p.image} name={p.name} detail={[p.brand, p.barcode].filter(Boolean).join(' · ')}
                    aside={<span className="tabular-nums">stock {available(p.barcode)}</span>} onClick={() => addLine(p)} />
                ))}
              </ProductSearch>
            </section>
          )}

          <OpsSection title="Articles" aside={<span className="text-sm text-muted-foreground">{lines.length} ligne{lines.length !== 1 ? 's' : ''} · {units} unité{units !== 1 ? 's' : ''}</span>}>
            {lines.length === 0 ? (
              <div className="px-5 py-10 text-center">
                <KindIcon className="mx-auto h-10 w-10 text-muted-foreground" aria-hidden="true" />
                <p className="mt-3 font-medium text-foreground">Aucun article</p>
                <p className="mt-1 text-sm text-muted-foreground">Cherchez un article ci-dessus pour l’ajouter.</p>
              </div>
            ) : (
              <>
                <div className={`hidden gap-x-4 border-b border-border bg-secondary/40 px-5 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground md:grid ${kind === 'entree' ? 'grid-cols-[3rem_minmax(0,1fr)_6rem_8.5rem_9rem_2.5rem]' : 'grid-cols-[3rem_minmax(0,1fr)_6rem_8.5rem_2.5rem]'}`}>
                  <span /><span>Article</span><span className="text-right">Stock</span><span className="text-center">Quantité</span>
                  {kind === 'entree' && <span className="text-right">Coût unitaire</span>}<span />
                </div>
                <ul className="divide-y divide-border">
                  {lines.map((l, i) => {
                    const short = kind === 'sortie' && Number(l.quantity) > available(l.barcode);
                    return (
                      <li key={l.barcode} className={`grid grid-cols-[3rem_minmax(0,1fr)_2.5rem] items-center gap-x-3 gap-y-3 px-4 py-3 sm:px-5 md:gap-x-4 ${kind === 'entree' ? 'md:grid-cols-[3rem_minmax(0,1fr)_6rem_8.5rem_9rem_2.5rem]' : 'md:grid-cols-[3rem_minmax(0,1fr)_6rem_8.5rem_2.5rem]'}`}>
                        <ProductThumb image={byBarcode.get(l.barcode)?.image} />
                        <div className="min-w-0">
                          <p className="font-semibold leading-snug text-foreground">{l.product_name}</p>
                          <p className="truncate font-mono text-xs text-muted-foreground">{l.barcode}</p>
                        </div>
                        {editable ? (
                          <button onClick={() => removeLine(i)} aria-label={`Retirer ${l.product_name}`}
                            className="flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive md:order-last">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        ) : <span className="md:order-last" />}
                        <div className="col-span-3 flex flex-wrap items-center justify-between gap-3 md:contents">
                          <p className="text-sm tabular-nums text-muted-foreground md:text-right"><span className="md:hidden">Stock </span>{available(l.barcode)}</p>
                          {editable ? (
                            <div className={`rounded-lg md:justify-self-center ${short ? 'ring-2 ring-destructive/60' : ''}`}>
                              <QtyStepper label="la quantité" onMinus={() => updateLine(i, { quantity: Math.max(1, Number(l.quantity) - 1) })} onPlus={() => updateLine(i, { quantity: Number(l.quantity) + 1 })} minusDisabled={Number(l.quantity) <= 1}
                                input={<input type="number" min={1} step="any" value={l.quantity} onChange={e => updateLine(i, { quantity: Number(e.target.value) })} aria-label={`Quantité ${l.product_name}`} aria-invalid={short} className={stepperInput} />} />
                            </div>
                          ) : <p className="text-sm font-semibold tabular-nums text-foreground md:text-center"><span className="font-normal text-muted-foreground md:hidden">Quantité </span>{l.quantity}</p>}
                          {kind === 'entree' && (editable ? (
                            <input type="number" min={0} step="0.01" value={l.unit_cost ?? ''} placeholder="—"
                              onChange={e => updateLine(i, { unit_cost: e.target.value === '' ? null : Number(e.target.value) })}
                              aria-label={`Coût unitaire ${l.product_name}`} className={`${opsField} text-right tabular-nums md:w-full`} />
                          ) : <p className="text-sm tabular-nums text-muted-foreground md:text-right">{l.unit_cost != null ? formatMoney(l.unit_cost) : '—'}</p>)}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </OpsSection>

          {editable && kind === 'entree' && (
            <p className="text-sm text-muted-foreground">
              {costUpdatesAverage(kind, reason)
                ? 'Réception sans commande : le coût unitaire mettra à jour le prix d’achat moyen des articles.'
                : 'Le coût unitaire est indicatif ; il ne change le prix d’achat moyen que pour une « Réception sans commande ».'}
            </p>
          )}
          {editable && shortages.length > 0 && (
            <p className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-red-700 dark:text-red-300" role="alert">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
              {shortages.length === 1 ? 'Une quantité dépasse' : `${shortages.length} quantités dépassent`} le stock de {location?.name || 'cet emplacement'} : la validation sera refusée{isAdmin ? ', sauf accord d’un administrateur' : ''}.
            </p>
          )}
        </div>

        <aside className="space-y-4 lg:sticky lg:top-4" aria-label="Récapitulatif">
          <section className={`${opsPanel} p-5`}>
            <h2 className="font-semibold text-foreground">Récapitulatif</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Type</dt><dd className="font-medium text-foreground">{KIND_LABEL[kind]}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Motif</dt><dd className="truncate font-medium text-foreground">{reason ? reasonLabel(kind, reason) : '—'}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Emplacement</dt><dd className="truncate font-medium text-foreground">{location?.name || '—'}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Articles</dt><dd className="font-medium tabular-nums text-foreground">{lines.length}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Unités</dt><dd className="font-medium tabular-nums text-foreground">{kind === 'entree' ? '+' : '−'}{units}</dd></div>
            </dl>
            {editable && (
              <>
                <button onClick={onValidate} disabled={!!busy || problems.length > 0} className={`${opsPrimaryBtn} mt-4 w-full`}>
                  {spinner('validate') || <Check className="h-4 w-4" aria-hidden="true" />} Valider
                </button>
                <button onClick={onSave} disabled={!!busy || problems.length > 0} className={`${opsSecondaryBtn} mt-2 w-full`}>
                  {spinner('save') || <Save className="h-4 w-4" aria-hidden="true" />} Enregistrer le brouillon
                </button>
                {voucher && (
                  <button onClick={onDelete} disabled={!!busy} className={`${opsSecondaryBtn} mt-2 w-full text-red-700 dark:text-red-300`}>
                    {spinner('delete') || <Trash2 className="h-4 w-4" aria-hidden="true" />} Supprimer le brouillon
                  </button>
                )}
                {problems.length > 0 && lines.length > 0 && <p className="mt-2 text-xs text-muted-foreground">{problems[0]}</p>}
              </>
            )}
          </section>
        </aside>

        {editable && (
          <div className={opsPhoneBar}>
            <div className="mx-auto flex max-w-3xl items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs text-muted-foreground">{reasonLabel(kind, reason)} · {location?.name || '—'}</p>
                <p className="whitespace-nowrap text-lg font-bold tabular-nums leading-tight text-foreground">{kind === 'entree' ? '+' : '−'}{units} unité{units !== 1 ? 's' : ''}</p>
              </div>
              <button onClick={onSave} disabled={!!busy || problems.length > 0} aria-label="Enregistrer le brouillon" className={opsSecondaryBtn}><Save className="h-4 w-4" aria-hidden="true" /></button>
              <button onClick={onValidate} disabled={!!busy || problems.length > 0} className={opsPrimaryBtn}>{spinner('validate') || <Check className="h-4 w-4" aria-hidden="true" />} Valider</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
