import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Building, Plus, Trash2, Check, X, Zap } from 'lucide-react';
import { AssetsService, type FixedAsset } from '../../utils/supabaseAssets';
import { AccountingService } from '../../utils/supabaseAccounting';
import type { FiscalYear, Journal } from '../../types';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';
import { localDay } from '../../utils/documentLines';
import { PageHeader } from '../../components/PageHeader';
import { StatusPill } from '../../components/lists/StatusPill';
import { btnPrimary, btnSecondary, btnSoft, EmptyState, field, fieldLabel, iconBtnDanger, LoadingState, MobileField, panel, td, tdNum, th, theadRow, thRight } from '../../components/backoffice/BackOfficeUi';

function fmt(n: number) { return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2 }).format(n); }

export default function ImmobilisationsPage() {
  const { currentUser } = useAuth();
  const { showToast } = useToast();
  const [assets, setAssets] = useState<FixedAsset[]>([]);
  const [fy, setFy] = useState<FiscalYear | null>(null);
  const [journals, setJournals] = useState<Journal[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ label: '', account_code: '2340', acquisition_date: localDay(), amount: '', duration_years: '5', depreciation_account_code: '2834', expense_account_code: '6191' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [a, year, j] = await Promise.all([AssetsService.list(), AccountingService.ensureCurrentFiscalYear(), AccountingService.listJournals()]);
      setAssets(a); setFy(year); setJournals(j);
    } catch (e: any) { showToast({ type: 'error', message: e?.message || 'Erreur' }); }
    finally { setLoading(false); }
  }, [showToast]);
  useEffect(() => { load(); }, [load]);

  const year = fy ? Number(fy.label) : new Date().getFullYear();

  const save = async () => {
    if (!form.label.trim() || !Number(form.amount)) { showToast({ type: 'error', message: 'Libellé et montant requis' }); return; }
    setBusy(true);
    try {
      await AssetsService.create({
        label: form.label.trim(), account_code: form.account_code, acquisition_date: form.acquisition_date,
        amount: Number(form.amount), duration_years: Number(form.duration_years) || 5,
        depreciation_account_code: form.depreciation_account_code, expense_account_code: form.expense_account_code,
        created_by: currentUser?.username || null,
      });
      showToast({ type: 'success', message: 'Immobilisation ajoutée' });
      setAdding(false); setForm({ ...form, label: '', amount: '' });
      await load();
    } catch (e: any) { showToast({ type: 'error', message: e?.message || 'Échec' }); }
    finally { setBusy(false); }
  };

  const dotation = async (a: FixedAsset) => {
    if (!fy) return;
    setBusy(true);
    try {
      await AssetsService.generateDotation(a, year, journals, currentUser?.username || null);
      showToast({ type: 'success', title: 'Dotation générée', message: `Amortissement ${year} comptabilisé` });
      await load();
    } catch (e: any) { showToast({ type: 'error', title: 'Erreur', message: e?.message || 'Échec' }); }
    finally { setBusy(false); }
  };

  const remove = async (a: FixedAsset) => {
    if (!confirm(`Supprimer l'immobilisation « ${a.label} » ? (les écritures d'amortissement restent)`)) return;
    try { await AssetsService.remove(a.id); await load(); }
    catch (e: any) { showToast({ type: 'error', message: e?.message || 'Échec' }); }
  };

  if (loading) return <LoadingState />;

  const rowsData = assets.map(a => {
    const annual = AssetsService.dotationForYear(a, year) || AssetsService.annualAmount(a);
    const cum = AssetsService.cumulative(a);
    const vnc = Math.max(0, Number(a.amount) - cum);
    const doneThisYear = (a.depreciations || []).some(d => d.year === year);
    const fullyAmortized = vnc <= (Number(a.salvage) || 0) + 0.005;
    return { a, annual, cum, vnc, doneThisYear, fullyAmortized };
  });
  const yearState = ({ a, doneThisYear, fullyAmortized }: typeof rowsData[number]) => doneThisYear
    ? <StatusPill tone="success" icon={<Check className="h-3 w-3" />}>Dotation faite</StatusPill>
    : fullyAmortized ? <StatusPill tone="neutral">Amorti</StatusPill>
    : <button onClick={() => dotation(a)} disabled={busy} className={btnSoft}><Zap className="h-3.5 w-3.5" /> Générer</button>;
  const deleteButton = (a: FixedAsset) => (
    <button onClick={() => remove(a)} aria-label={`Supprimer ${a.label}`} title="Supprimer" className={iconBtnDanger}><Trash2 className="h-4 w-4" /></button>
  );

  return (
    <div className="mx-auto max-w-[110rem]">
      <PageHeader
        title="Immobilisations"
        subtitle={`Amortissement linéaire · exercice ${fy?.label ?? ''}`}
        actions={<button onClick={() => setAdding(v => !v)} aria-expanded={adding} className={btnPrimary}><Plus className="h-4 w-4" /> Immobilisation</button>}
      />

      {adding && (
        <div className={`${panel} mb-4 border-primary/40 p-4`}>
          <h2 className="mb-3 text-sm font-semibold text-foreground">Nouvelle immobilisation</h2>
          <div className="grid grid-cols-2 items-end gap-3 sm:grid-cols-4 xl:grid-cols-[minmax(0,2fr)_repeat(5,minmax(0,1fr))_auto]">
            <div className="col-span-2 xl:col-span-1"><label className={fieldLabel} htmlFor="immo-label">Libellé</label>
              <input id="immo-label" value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} className={field} /></div>
            <div><label className={fieldLabel} htmlFor="immo-amount">Montant HT</label>
              <input id="immo-amount" type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} className={`${field} tabular-nums`} /></div>
            <div><label className={fieldLabel} htmlFor="immo-duration">Durée (ans)</label>
              <input id="immo-duration" type="number" value={form.duration_years} onChange={e => setForm(f => ({ ...f, duration_years: e.target.value }))} className={`${field} tabular-nums`} /></div>
            <div><label className={fieldLabel} htmlFor="immo-date">Acquisition</label>
              <input id="immo-date" type="date" value={form.acquisition_date} onChange={e => setForm(f => ({ ...f, acquisition_date: e.target.value }))} className={field} /></div>
            <div><label className={fieldLabel} htmlFor="immo-account">Cpte immo</label>
              <input id="immo-account" value={form.account_code} onChange={e => setForm(f => ({ ...f, account_code: e.target.value }))} className={`${field} font-mono`} /></div>
            <div><label className={fieldLabel} htmlFor="immo-dep-account">Cpte amort.</label>
              <input id="immo-dep-account" value={form.depreciation_account_code} onChange={e => setForm(f => ({ ...f, depreciation_account_code: e.target.value }))} className={`${field} font-mono`} /></div>
            <div className="col-span-2 flex gap-2 sm:col-span-1">
              <button onClick={() => setAdding(false)} aria-label="Annuler" className={`${btnSecondary} flex-1`}><X className="h-4 w-4" /><span className="sm:hidden">Annuler</span></button>
              <button onClick={save} disabled={busy} aria-label="Enregistrer l'immobilisation" className={`${btnPrimary} flex-1`}>{busy ? '…' : <Check className="h-4 w-4" />}<span className="sm:hidden">Enregistrer</span></button>
            </div>
          </div>
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
                      <p className="truncate font-mono text-xs text-muted-foreground">{r.a.account_code} · {r.a.duration_years} ans · dep. {new Date(r.a.acquisition_date).toLocaleDateString('fr-FR')}</p>
                    </div>
                    {deleteButton(r.a)}
                  </div>
                  <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5">
                    <MobileField label="Montant">{fmt(Number(r.a.amount))}</MobileField>
                    <MobileField label="VNC"><span className="font-semibold">{fmt(r.vnc)}</span></MobileField>
                    <MobileField label="Dotation/an">{fmt(r.annual)}</MobileField>
                    <MobileField label="Amort. cumulé">{fmt(r.cum)}</MobileField>
                  </dl>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">Exercice {year}</span>
                    {yearState(r)}
                  </div>
                </li>
              ))}
            </ul>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className={theadRow}>
                    <th className={th}>Immobilisation</th>
                    <th className={thRight}>Montant</th>
                    <th className={thRight}>Dotation/an</th>
                    <th className={thRight}>Amort. cumulé</th>
                    <th className={thRight}>VNC</th>
                    <th className={`${thRight} w-40`}>Exercice {year}</th>
                    <th className={`${th} w-12`}><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rowsData.map(r => (
                    <tr key={r.a.id} className="hover:bg-secondary/40">
                      <td className={td}>
                        <div className="font-medium text-foreground">{r.a.label}</div>
                        <div className="font-mono text-xs text-muted-foreground">{r.a.account_code} · {r.a.duration_years} ans · dep. {new Date(r.a.acquisition_date).toLocaleDateString('fr-FR')}</div>
                      </td>
                      <td className={`${tdNum} text-foreground`}>{fmt(Number(r.a.amount))}</td>
                      <td className={`${tdNum} text-muted-foreground`}>{fmt(r.annual)}</td>
                      <td className={`${tdNum} text-muted-foreground`}>{fmt(r.cum)}</td>
                      <td className={`${tdNum} font-semibold text-foreground`}>{fmt(r.vnc)}</td>
                      <td className={`${td} text-right`}>{yearState(r)}</td>
                      <td className={`${td} py-1.5 text-center`}>{deleteButton(r.a)}</td>
                    </tr>
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
