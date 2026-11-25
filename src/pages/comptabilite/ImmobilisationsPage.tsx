import React, { useEffect, useState, useCallback } from 'react';
import { Building, Plus, Trash2, Check, X, Zap, AlertTriangle, ListTree } from 'lucide-react';
import { AssetsService, type FixedAsset } from '../../utils/supabaseAssets';
import { AccountingService } from '../../utils/supabaseAccounting';
import type { FiscalYear, Journal } from '../../types';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';
import { localDay } from '../../utils/documentLines';
import { PageHeader } from '../../components/PageHeader';
import { StatusPill } from '../../components/lists/StatusPill';
import { btnPrimary, btnSecondary, btnSoft, checkbox, EmptyState, field, fieldLabel, iconBtn, iconBtnDanger, LoadingState, MobileField, panel, td, tdNum, th, theadRow, thRight } from '../../components/backoffice/BackOfficeUi';
import {
  ASSET_PRESETS, defaultAccountsFor, degressiveCoefficient, degressiveRefusal, expenseAccountHint, isFullyDepreciated,
  nonDeductibleDepreciation, passengerCarCap, type DepreciationMethod,
} from '../../accounting/depreciation';
import { errorText } from '../../accounting/errors';

function fmt(n: number) { return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n); }

const presetOf = (key: string) => ASSET_PRESETS.find(p => p.key === key);
const initialPreset = presetOf('transport')!;
const blankForm = () => ({
  preset: initialPreset.key, label: '', account_code: initialPreset.account_code, acquisition_date: localDay(), amount: '', salvage: '',
  duration_years: String(initialPreset.duration_years), method: 'lineaire' as DepreciationMethod,
  depreciation_account_code: initialPreset.depreciation_account_code, expense_account_code: initialPreset.expense_account_code,
  passenger_car: false,
});

export default function ImmobilisationsPage() {
  const { currentUser } = useAuth();
  const { showToast } = useToast();
  const [assets, setAssets] = useState<FixedAsset[]>([]);
  const [fy, setFy] = useState<FiscalYear | null>(null);
  const [journals, setJournals] = useState<Journal[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState(blankForm);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [a, year, j] = await Promise.all([AssetsService.list(), AccountingService.ensureCurrentFiscalYear(), AccountingService.listJournals()]);
      setAssets(a); setFy(year); setJournals(j);
    } catch (e) { showToast({ type: 'error', message: errorText(e, 'Erreur') }); }
    finally { setLoading(false); }
  }, [showToast]);
  useEffect(() => { load(); }, [load]);

  const year = fy ? Number(fy.label) : new Date().getFullYear();

  // A category fills the accounts and the usual duration; every field stays editable.
  const applyPreset = (key: string) => {
    const p = presetOf(key);
    if (!p) { setForm(f => ({ ...f, preset: key })); return; }
    setForm(f => ({
      ...f, preset: key, account_code: p.account_code, depreciation_account_code: p.depreciation_account_code,
      expense_account_code: p.expense_account_code, duration_years: String(p.duration_years), passenger_car: !!p.passenger_car,
      method: p.noDegressive ? 'lineaire' : f.method,
    }));
  };
  // The depreciation and expense accounts follow the asset account (21x → 6191, 22x → 6192, 23x → 6193).
  const setAssetAccount = (code: string) => {
    const d = defaultAccountsFor(code);
    setForm(f => ({ ...f, account_code: code, depreciation_account_code: d.depreciation || f.depreciation_account_code, expense_account_code: d.expense }));
  };

  const duration = Number(form.duration_years) || 0;
  const refusal = degressiveRefusal({ account_code: form.account_code, passenger_car: form.passenger_car, duration_years: duration });
  const coef = degressiveCoefficient(duration);
  const preset = presetOf(form.preset);

  const save = async () => {
    const amount = Number(form.amount);
    if (!form.label.trim() || !(amount > 0)) { showToast({ type: 'error', message: 'Libellé et montant requis' }); return; }
    if (!(duration > 0)) { showToast({ type: 'error', message: 'Durée invalide' }); return; }
    if (!/^2\d{3,7}$/.test(form.account_code.trim())) { showToast({ type: 'error', message: 'Le compte d\'immobilisation est un compte de classe 2' }); return; }
    setBusy(true);
    try {
      await AssetsService.create({
        label: form.label.trim(), account_code: form.account_code.trim(), acquisition_date: form.acquisition_date,
        amount, salvage: Number(form.salvage) || 0, duration_years: duration, method: form.method,
        depreciation_account_code: form.depreciation_account_code.trim(), expense_account_code: form.expense_account_code.trim(),
        passenger_car: form.passenger_car, created_by: currentUser?.username || null,
      });
      showToast({ type: 'success', message: 'Immobilisation ajoutée' });
      setAdding(false); setForm(blankForm());
      await load();
    } catch (e) { showToast({ type: 'error', message: errorText(e, 'Échec') }); }
    finally { setBusy(false); }
  };

  const dotation = async (a: FixedAsset) => {
    if (!fy) return;
    setBusy(true);
    try {
      await AssetsService.generateDotation(a, year, journals, currentUser?.username || null);
      showToast({ type: 'success', title: 'Dotation générée', message: `Amortissement ${year} comptabilisé` });
      await load();
    } catch (e) { showToast({ type: 'error', title: 'Erreur', message: errorText(e, 'Échec') }); }
    finally { setBusy(false); }
  };

  const remove = async (a: FixedAsset) => {
    if ((a.depreciations || []).length > 0) {
      showToast({ type: 'error', title: 'Suppression impossible', message: 'Des dotations ont été comptabilisées pour cette immobilisation. Pour une cession ou une mise au rebut, passez l\'écriture de sortie dans Saisie / Journaux.' });
      return;
    }
    if (!confirm(`Supprimer l'immobilisation « ${a.label} » ?`)) return;
    try { await AssetsService.remove(a); await load(); }
    catch (e) { showToast({ type: 'error', title: 'Suppression impossible', message: errorText(e, 'Échec') }); }
  };

  if (loading) return <LoadingState />;

  const rowsData = assets.map(a => {
    const annual = AssetsService.dotationForYear(a, year) || AssetsService.annualAmount(a);
    const cum = AssetsService.cumulative(a);
    const vnc = AssetsService.netBookValue(a);
    const doneThisYear = (a.depreciations || []).some(d => d.year === year);
    const thisYear = (a.depreciations || []).find(d => d.year === year)?.amount ?? AssetsService.dotationForYear(a, year);
    const nonDeductible = nonDeductibleDepreciation(a, Number(thisYear) || 0);
    const hint = expenseAccountHint(a);
    return { a, annual, cum, vnc, doneThisYear, fullyAmortized: isFullyDepreciated(a), nonDeductible, hint };
  });
  const wrongExpense = rowsData.filter(r => r.hint).length;

  const yearState = ({ a, doneThisYear, fullyAmortized }: typeof rowsData[number]) => doneThisYear
    ? <StatusPill tone="success" icon={<Check className="h-3 w-3" />}>Dotation faite</StatusPill>
    : fullyAmortized ? <StatusPill tone="neutral">Amorti</StatusPill>
    : <button onClick={() => dotation(a)} disabled={busy} className={btnSoft}><Zap className="h-3.5 w-3.5" /> Générer</button>;
  const actions = (a: FixedAsset) => (
    <span className="inline-flex">
      <button onClick={() => setOpen(o => o === a.id ? null : a.id)} aria-expanded={open === a.id} aria-label={`Plan d'amortissement de ${a.label}`} title="Plan d'amortissement" className={iconBtn}><ListTree className="h-4 w-4" /></button>
      <button onClick={() => remove(a)} aria-label={`Supprimer ${a.label}`} title="Supprimer" className={iconBtnDanger}><Trash2 className="h-4 w-4" /></button>
    </span>
  );
  const meta = (r: typeof rowsData[number]) => (
    <>
      <div className="font-mono text-xs text-muted-foreground">
        {r.a.account_code} · {r.a.duration_years} ans · {r.a.method === 'degressif' ? `dégressif × ${degressiveCoefficient(r.a.duration_years) ?? '?'}` : 'linéaire'} · dep. {new Date(r.a.acquisition_date).toLocaleDateString('fr-FR')}
        {Number(r.a.salvage) > 0 ? ` · résiduelle ${fmt(Number(r.a.salvage))}` : ''}
      </div>
      {r.a.passenger_car && (
        <div className="text-xs text-muted-foreground">
          Voiture de tourisme · plafond fiscal {fmt(passengerCarCap(r.a.acquisition_date))} TTC
          {r.nonDeductible > 0 && <> · <span className="font-medium text-amber-700 dark:text-amber-300">non déductible {year} : {fmt(r.nonDeductible)} (à réintégrer)</span></>}
        </div>
      )}
      {r.hint && (
        <div className="text-xs text-amber-700 dark:text-amber-300">Dotation au {r.a.expense_account_code} : le compte usuel pour ce type d'immobilisation est le {r.hint}.</div>
      )}
    </>
  );
  const schedule = (a: FixedAsset) => {
    const rows = AssetsService.schedule(a);
    return (
      <div className="overflow-x-auto bg-secondary/30 px-3 py-2">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted-foreground">
              <th className="px-2 py-1 text-left font-semibold">Exercice</th>
              <th className="px-2 py-1 text-right font-semibold">Mois</th>
              <th className="px-2 py-1 text-right font-semibold">Dotation</th>
              <th className="px-2 py-1 text-right font-semibold">Cumul</th>
              <th className="px-2 py-1 text-right font-semibold">VNC fin</th>
              {a.passenger_car && <th className="px-2 py-1 text-right font-semibold">Non déductible</th>}
              <th className="px-2 py-1 text-left font-semibold">État</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.year} className="border-t border-border/60">
                <td className="px-2 py-1 text-foreground">{r.year}</td>
                <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">{r.months}</td>
                <td className="px-2 py-1 text-right tabular-nums text-foreground">{fmt(r.amount)}</td>
                <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">{fmt(r.cumulative)}</td>
                <td className="px-2 py-1 text-right tabular-nums text-foreground">{fmt(r.netBookValue)}</td>
                {a.passenger_car && <td className="px-2 py-1 text-right tabular-nums text-amber-700 dark:text-amber-300">{fmt(nonDeductibleDepreciation(a, r.amount))}</td>}
                <td className="px-2 py-1 text-muted-foreground">{r.booked ? 'comptabilisée' : 'prévue'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="mx-auto max-w-[110rem]">
      <PageHeader
        title="Immobilisations"
        subtitle={`Amortissement linéaire ou dégressif · exercice ${fy?.label ?? ''}`}
        actions={<button onClick={() => setAdding(v => !v)} aria-expanded={adding} className={btnPrimary}><Plus className="h-4 w-4" /> Immobilisation</button>}
      />

      {wrongExpense > 0 && (
        <p className="mb-4 flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-800 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{wrongExpense} immobilisation{wrongExpense > 1 ? 's' : ''} {wrongExpense > 1 ? 'ont' : 'a'} un compte de dotation qui ne correspond pas à son type (corporelles : 6193, incorporelles : 6192, non-valeurs : 6191). Les écritures déjà passées ne sont pas modifiées.</span>
        </p>
      )}

      {adding && (
        <div className={`${panel} mb-4 border-primary/40 p-4`}>
          <h2 className="mb-3 text-sm font-semibold text-foreground">Nouvelle immobilisation</h2>
          <div className="grid grid-cols-2 items-end gap-3 sm:grid-cols-4 xl:grid-cols-6">
            <div className="col-span-2"><label className={fieldLabel} htmlFor="immo-preset">Catégorie</label>
              <select id="immo-preset" value={form.preset} onChange={e => applyPreset(e.target.value)} className={field}>
                {ASSET_PRESETS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
                <option value="autre">Autre (saisie libre)</option>
              </select></div>
            <div className="col-span-2"><label className={fieldLabel} htmlFor="immo-label">Libellé</label>
              <input id="immo-label" value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} className={field} /></div>
            <div><label className={fieldLabel} htmlFor="immo-amount">{form.passenger_car ? 'Coût TTC' : 'Montant HT'}</label>
              <input id="immo-amount" type="number" min={0} value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} className={`${field} tabular-nums`} /></div>
            <div><label className={fieldLabel} htmlFor="immo-salvage">Valeur résiduelle</label>
              <input id="immo-salvage" type="number" min={0} value={form.salvage} placeholder="0" onChange={e => setForm(f => ({ ...f, salvage: e.target.value }))} className={`${field} tabular-nums`} /></div>
            <div><label className={fieldLabel} htmlFor="immo-date">Acquisition</label>
              <input id="immo-date" type="date" value={form.acquisition_date} onChange={e => setForm(f => ({ ...f, acquisition_date: e.target.value }))} className={field} /></div>
            <div><label className={fieldLabel} htmlFor="immo-duration">Durée (ans)</label>
              <input id="immo-duration" type="number" min={1} value={form.duration_years} onChange={e => setForm(f => ({ ...f, duration_years: e.target.value }))} className={`${field} tabular-nums`} /></div>
            <div className="col-span-2"><label className={fieldLabel} htmlFor="immo-method">Méthode</label>
              <select id="immo-method" value={form.method} onChange={e => setForm(f => ({ ...f, method: e.target.value as DepreciationMethod }))} className={field}>
                <option value="lineaire">Linéaire</option>
                <option value="degressif" disabled={!!refusal}>Dégressif{coef && !refusal ? ` (coefficient ${String(coef).replace('.', ',')})` : ''}</option>
              </select></div>
            <div><label className={fieldLabel} htmlFor="immo-account">Cpte immo</label>
              <input id="immo-account" value={form.account_code} onChange={e => setAssetAccount(e.target.value.trim())} className={`${field} font-mono`} /></div>
            <div><label className={fieldLabel} htmlFor="immo-dep-account">Cpte amort.</label>
              <input id="immo-dep-account" value={form.depreciation_account_code} onChange={e => setForm(f => ({ ...f, depreciation_account_code: e.target.value }))} className={`${field} font-mono`} /></div>
            <div><label className={fieldLabel} htmlFor="immo-exp-account">Cpte dotation</label>
              <input id="immo-exp-account" value={form.expense_account_code} onChange={e => setForm(f => ({ ...f, expense_account_code: e.target.value }))} className={`${field} font-mono`} /></div>
            <label className="col-span-2 flex min-h-10 items-center gap-2 text-sm text-foreground sm:col-span-1">
              <input type="checkbox" checked={form.passenger_car} onChange={e => setForm(f => ({ ...f, passenger_car: e.target.checked, method: e.target.checked ? 'lineaire' : f.method }))} className={checkbox} />
              Voiture de tourisme
            </label>
            <div className="col-span-2 flex gap-2 sm:col-span-4 xl:col-span-6 xl:justify-end">
              <button onClick={() => setAdding(false)} className={`${btnSecondary} flex-1 xl:flex-none`}><X className="h-4 w-4" />Annuler</button>
              <button onClick={save} disabled={busy} className={`${btnPrimary} flex-1 xl:flex-none`}>{busy ? '…' : <Check className="h-4 w-4" />}Enregistrer</button>
            </div>
          </div>
          <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
            {preset && <li>Durée usuelle admise : {preset.usual}.</li>}
            {form.method === 'degressif' && coef && <li>Dégressif : taux linéaire × {String(coef).replace('.', ',')} appliqué à la valeur restante ; passage au linéaire du reste quand il devient plus élevé.</li>}
            {refusal && <li>{refusal}</li>}
            {form.passenger_car && (
              <li>Voiture de tourisme : amortissement fiscalement déductible plafonné à {fmt(passengerCarCap(form.acquisition_date))} MAD TTC (20 % par an sur 5 ans) ; au-delà, la part non déductible est indiquée chaque année. {duration > 5 ? 'La durée ne peut pas dépasser 5 ans (taux d\'au moins 20 %).' : ''}</li>
            )}
          </ul>
        </div>
      )}

      <div className={`${panel} overflow-hidden`}>
        {assets.length === 0 ? (
          <EmptyState icon={Building} title="Aucune immobilisation" />
        ) : (
          <>
            <ul className="divide-y divide-border md:hidden">
              {rowsData.map(r => (
                <li key={r.a.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">{r.a.label}</p>
                      {meta(r)}
                    </div>
                    {actions(r.a)}
                  </div>
                  <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5">
                    <MobileField label="Montant">{fmt(Number(r.a.amount))}</MobileField>
                    <MobileField label="VNC"><span className="font-semibold">{fmt(r.vnc)}</span></MobileField>
                    <MobileField label={`Dotation ${year}`}>{fmt(r.annual)}</MobileField>
                    <MobileField label="Amort. cumulé">{fmt(r.cum)}</MobileField>
                  </dl>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">Exercice {year}</span>
                    {yearState(r)}
                  </div>
                  {open === r.a.id && <div className="mt-2 overflow-hidden rounded-lg border border-border">{schedule(r.a)}</div>}
                </li>
              ))}
            </ul>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className={theadRow}>
                    <th className={th}>Immobilisation</th>
                    <th className={thRight}>Montant</th>
                    <th className={thRight}>Dotation {year}</th>
                    <th className={thRight}>Amort. cumulé</th>
                    <th className={thRight}>VNC</th>
                    <th className={`${thRight} w-40`}>Exercice {year}</th>
                    <th className={`${th} w-24`}><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rowsData.map(r => (
                    <React.Fragment key={r.a.id}>
                      <tr className="hover:bg-secondary/40">
                        <td className={td}>
                          <div className="font-medium text-foreground">{r.a.label}</div>
                          {meta(r)}
                        </td>
                        <td className={`${tdNum} text-foreground`}>{fmt(Number(r.a.amount))}</td>
                        <td className={`${tdNum} text-muted-foreground`}>{fmt(r.annual)}</td>
                        <td className={`${tdNum} text-muted-foreground`}>{fmt(r.cum)}</td>
                        <td className={`${tdNum} font-semibold text-foreground`}>{fmt(r.vnc)}</td>
                        <td className={`${td} text-right`}>{yearState(r)}</td>
                        <td className={`${td} py-1.5 text-right`}>{actions(r.a)}</td>
                      </tr>
                      {open === r.a.id && (
                        <tr><td colSpan={7} className="p-0">{schedule(r.a)}</td></tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
