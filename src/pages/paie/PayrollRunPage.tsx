import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarClock, Loader, Plus, ArrowLeft, Check, BookOpen, Lock, ChevronRight, Scale, Banknote, Unlock } from 'lucide-react';
import { PayrollRunService, runTotals, type PayrollRun } from '../../utils/supabasePayrollRun';
import { PayrollSettingsService } from '../../utils/supabasePayrollSettings';
import { officialSettingsFor, type PayrollSettings } from '../../utils/payrollDefaults';
import { smigWarning } from '../../utils/payrollCalc';
import { planRegularisation, type IrRegularisation, type RegularisationPlan } from '../../utils/payrollRegularisation';
import type { Employee, Payslip } from '../../types';
import { Notice } from './payrollUi';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';
import { PageHeader, Panel } from '../../components/PageHeader';
import { StatusPill } from '../../components/lists/StatusPill';
import { btnPrimary, btnSecondary, EmptyState, field, fieldLabel, KpiTile, LoadingState, panel, PhoneActionBar, td, tdNum, tfootRow, th, theadRow, thRight } from '../../components/backoffice/BackOfficeUi';

function fmt(n: number) { return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2 }).format(n); }
const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const errMsg = (e: unknown) => (e instanceof Error ? e.message : (e as { message?: string })?.message || 'Échec');

interface RegulRow { payslip: Payslip; regul: IrRegularisation; plan: RegularisationPlan }

/** "janv.–nov. (11 mois)" for the validated months a regularisation covers. */
function coveredLabel(r: IrRegularisation): string {
  const months = r.months.filter(m => m.diff !== 0).map(m => m.month);
  if (months.length === 0) return '—';
  const short = (m: number) => MONTHS[m - 1].slice(0, 4).toLowerCase() + '.';
  return months.length === 1 ? MONTHS[months[0] - 1] : `${short(months[0])}–${short(months[months.length - 1])} (${months.length} mois)`;
}
const currentYear = new Date().getFullYear();
const STATUS_LABELS: Record<PayrollRun['status'], string> = { draft: 'brouillon', validated: 'validé', paid: 'payé' };
const PAYMENT_MODES: Record<string, string> = { virement: 'Virement', cheque: 'Chèque', especes: 'Espèces' };
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const YEARS = Array.from({ length: 4 }, (_, i) => currentYear - i);

export default function PayrollRunPage() {
  const navigate = useNavigate();
  const { isPaie, isSuperAdmin, currentUser } = useAuth();
  const { showToast } = useToast();
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [detail, setDetail] = useState<PayrollRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(currentYear);
  const [runSettings, setRunSettings] = useState<PayrollSettings | null>(null);
  const [reguls, setReguls] = useState<RegulRow[] | null>(null);
  const [paying, setPaying] = useState<{ date: string; mode: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRuns(await PayrollRunService.list()); }
    catch (e: any) { showToast({ type: 'error', message: e?.message || 'Erreur' }); }
    finally { setLoading(false); }
  }, [showToast]);
  useEffect(() => { load(); }, [load]);

  const generate = async () => {
    setBusy(true);
    try {
      const run = await PayrollRunService.generate(month, year, currentUser?.username || null);
      showToast({ type: 'success', title: 'Lot généré', message: `Paie ${MONTHS[month - 1]} ${year}` });
      await open(run.id);
      await load();
    } catch (e: any) { showToast({ type: 'error', title: 'Erreur', message: e?.message || 'Échec' }); }
    finally { setBusy(false); }
  };

  const open = async (id: string) => {
    const r = await PayrollRunService.getRun(id);
    setDetail(r); setReguls(null);
    if (!r) return;
    setRunSettings(await PayrollSettingsService.get(r.period_year).catch(() => officialSettingsFor(r.period_year)));
    // Older runs stored the employee CNSS alone, or totals not updated after
    // a payslip edit: bring the stored totals in line with the payslips.
    const t = runTotals(r.payslips || []);
    if (t.total_gross !== r.total_gross || t.total_net !== r.total_net || t.total_cnss !== r.total_cnss || t.total_ir !== r.total_ir || t.employer_cost !== r.employer_cost) {
      PayrollRunService.recomputeTotals(r.id).then(load).catch(() => { /* the screen reads the payslips anyway */ });
    }
  };

  const previewRegularisations = async () => {
    if (!detail) return;
    setBusy(true);
    try {
      const settings = runSettings || await PayrollSettingsService.get(detail.period_year);
      const rows: RegulRow[] = [];
      for (const p of (detail.payslips || []).filter(x => !x.is_locked)) {
        const regul = await PayrollRunService.regularisationFor(p, (p.employee as Employee | undefined) ?? undefined, settings);
        if (regul.owed === 0) continue;
        // IR of the month before any regularisation already on it.
        const irBrut = Math.round((p.ir_amount + (p.ir_regularisation || 0)) * 100) / 100;
        rows.push({ payslip: p, regul, plan: planRegularisation(regul.owed, irBrut) });
      }
      setReguls(rows);
      if (rows.length === 0) showToast({ type: 'info', message: 'Rien à régulariser pour ce lot.' });
    } catch (e) { showToast({ type: 'error', message: errMsg(e) }); }
    finally { setBusy(false); }
  };

  const applyRegularisations = async (rows: RegulRow[], collect: boolean) => {
    if (!detail || rows.length === 0) return;
    setBusy(true);
    try {
      for (const r of rows) await PayrollRunService.applyRegularisation(r.payslip.id, { collect });
      showToast({ type: 'success', title: 'Régularisation enregistrée', message: `${rows.length} bulletin(s) mis à jour` });
      await open(detail.id); await load();
    } catch (e) { showToast({ type: 'error', message: errMsg(e) }); }
    finally { setBusy(false); }
  };

  const validate = async () => {
    if (!detail) return;
    setBusy(true);
    try { await PayrollRunService.validate(detail.id); showToast({ type: 'success', message: 'Lot validé (cumuls mis à jour)' }); await open(detail.id); await load(); }
    catch (e) { showToast({ type: 'error', message: errMsg(e) }); }
    finally { setBusy(false); }
  };

  const markPaid = async () => {
    if (!detail || !paying) return;
    setBusy(true);
    try {
      await PayrollRunService.markPaid(detail.id, paying.date, paying.mode);
      showToast({ type: 'success', message: `Lot marqué payé le ${paying.date.split('-').reverse().join('/')}` });
      setPaying(null); await open(detail.id); await load();
    } catch (e) { showToast({ type: 'error', message: errMsg(e) }); }
    finally { setBusy(false); }
  };

  const unvalidate = async () => {
    if (!detail) return;
    if (!confirm(`Dévalider la paie de ${MONTHS[detail.period_month - 1]} ${detail.period_year} ? Les bulletins redeviennent modifiables, les cumuls de l'année et les remboursements de prêts de ce mois sont annulés.`)) return;
    setBusy(true);
    try {
      const { warnings } = await PayrollRunService.unvalidate(detail.id);
      warnings.forEach(w => showToast({ type: 'warning', message: w }));
      showToast({ type: 'success', message: 'Lot dévalidé : bulletins de nouveau modifiables' });
      await open(detail.id); await load();
    } catch (e) { showToast({ type: 'error', message: errMsg(e) }); }
    finally { setBusy(false); }
  };

  const comptabiliser = async () => {
    if (!detail) return;
    setBusy(true);
    try { await PayrollRunService.postToAccounting(detail.id, currentUser?.username || null); showToast({ type: 'success', title: 'Comptabilisé', message: 'Écriture de paie en brouillon (À valider dans la Compta)' }); await open(detail.id); }
    catch (e: any) { showToast({ type: 'error', title: 'Erreur', message: e?.message || 'Échec' }); }
    finally { setBusy(false); }
  };

  if (!isPaie && !isSuperAdmin) return <div className="py-12 text-center text-muted-foreground">Accès réservé au rôle Paie.</div>;
  if (loading) return <LoadingState />;

  if (detail) {
    const validateButton = detail.status === 'draft' && <button onClick={validate} disabled={busy} className={btnPrimary}><Check className="h-4 w-4" /> Valider</button>;
    const bookButton = !detail.journal_entry_id && <button onClick={comptabiliser} disabled={busy} className={btnSecondary}><BookOpen className="h-4 w-4" /> Comptabiliser</button>;
    const regulButton = detail.status === 'draft' && <button onClick={previewRegularisations} disabled={busy} className={btnSecondary}><Scale className="h-4 w-4" /> Régulariser l'IR de l'année</button>;
    const payButton = detail.status === 'validated' && <button onClick={() => setPaying(p => (p ? null : { date: today(), mode: 'virement' }))} aria-expanded={!!paying} disabled={busy} className={btnSecondary}><Banknote className="h-4 w-4" /> Marquer comme payé</button>;
    // Only a validated run that is neither paid nor booked can be reopened.
    const unvalidateButton = detail.status === 'validated' && !detail.journal_entry_id && <button onClick={unvalidate} disabled={busy} className={btnSecondary}><Unlock className="h-4 w-4" /> Dévalider</button>;
    // Rows, footer and tiles all read the payslips: they always agree.
    const totals = runTotals(detail.payslips || []);
    const smigIssues = runSettings ? (detail.payslips || []).map(p => ({ p, w: smigWarning(p.base_salary, runSettings, p.hours_worked, (p.employee as Employee | undefined)?.contract_type) })).filter(x => x.w) : [];
    const negatives = (detail.payslips || []).filter(p => p.net_salary < 0);
    const refunds = (reguls || []).filter(r => r.regul.owed > 0);
    const shortfalls = (reguls || []).filter(r => r.regul.owed < 0);
    return (
      <div className="mx-auto max-w-[110rem]">
        <button onClick={() => setDetail(null)} aria-label="Retour aux lots de paie"
          className="mb-3 inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />Journée de paie
        </button>
        <PageHeader
          title={`Livre de paie — ${MONTHS[detail.period_month - 1]} ${detail.period_year}`}
          subtitle={`${detail.payslips?.length || 0} bulletin(s) · statut ${STATUS_LABELS[detail.status] || detail.status}${detail.status === 'paid' && detail.paid_at ? ` le ${detail.paid_at.slice(0, 10).split('-').reverse().join('/')}${detail.payment_mode ? ` (${(PAYMENT_MODES[detail.payment_mode] || detail.payment_mode).toLowerCase()})` : ''}` : ''}`}
          actions={<>
            {detail.journal_entry_id && <StatusPill tone="success" icon={<Check className="h-3 w-3" />}>Comptabilisé</StatusPill>}
            {detail.status === 'paid' && <StatusPill tone="info">Payé</StatusPill>}
            <span className="hidden gap-2 md:flex">{regulButton}{unvalidateButton}{payButton}{bookButton}{validateButton}</span>
          </>}
        />

        {paying && (
          <section className={`${panel} mb-4 grid grid-cols-2 items-end gap-3 p-4 sm:flex`} aria-label="Paiement du lot">
            <div><label className={fieldLabel} htmlFor="run-paid-at">Date de paiement</label>
              <input id="run-paid-at" type="date" value={paying.date} onChange={e => setPaying(p => p && { ...p, date: e.target.value })} className={field} /></div>
            <div><label className={fieldLabel} htmlFor="run-paid-mode">Mode</label>
              <select id="run-paid-mode" value={paying.mode} onChange={e => setPaying(p => p && { ...p, mode: e.target.value })} className={field}>
                {Object.entries(PAYMENT_MODES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select></div>
            <button onClick={markPaid} disabled={busy || !paying.date} className={`${btnPrimary} col-span-2`}><Check className="h-4 w-4" /> Confirmer le paiement</button>
          </section>
        )}

        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiTile label="Brut" value={fmt(totals.total_gross)} />
          <KpiTile label="CNSS + AMO salarié" value={fmt(totals.total_cnss)} />
          <KpiTile label="Net à payer" value={fmt(totals.total_net)} valueClassName="text-emerald-700 dark:text-emerald-300" />
          <KpiTile label="Coût total employeur" value={`${fmt(totals.employer_cost)} MAD`} />
        </div>

        <div className="mb-4 space-y-2">
          {negatives.length > 0 && <Notice tone="error">Net à payer négatif pour {negatives.map(p => p.employee?.full_name || p.payslip_number).join(', ')} : corrigez ces bulletins, la validation est bloquée.</Notice>}
          {smigIssues.map(({ p, w }) => <Notice key={p.id}>{p.employee?.full_name || p.payslip_number} — {w}</Notice>)}
        </div>

        {reguls && reguls.length > 0 && (
          <section className={`${panel} mb-4 overflow-hidden`} aria-label="Régularisation IR">
            <div className="border-b border-border px-4 py-3 sm:px-5">
              <h2 className="font-semibold text-foreground">Régularisation IR {detail.period_year}</h2>
              <p className="text-xs text-muted-foreground">Bulletins validés de l'année recalculés avec les paramètres actuels. L'IR du mois ne descend jamais sous 0 : le reste est repris le mois suivant.</p>
            </div>
            {refunds.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className={theadRow}><th className={th}>Employé</th><th className={th}>Mois couverts</th><th className={thRight}>Retenu en trop</th><th className={thRight}>Rendu ce mois</th><th className={thRight}>Reste dû</th></tr></thead>
                  <tbody className="divide-y divide-border">
                    {refunds.map(r => (
                      <tr key={r.payslip.id}>
                        <td className={`${td} font-medium text-foreground`}>{r.payslip.employee?.full_name || r.payslip.payslip_number}</td>
                        <td className={`${td} text-muted-foreground`}>{coveredLabel(r.regul)}</td>
                        <td className={`${tdNum} text-foreground`}>{fmt(r.regul.owed)}</td>
                        <td className={`${tdNum} font-semibold text-emerald-700 dark:text-emerald-300`}>{fmt(r.plan.apply)}</td>
                        <td className={`${tdNum} text-muted-foreground`}>{fmt(r.plan.remainder)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {shortfalls.length > 0 && (
              <div className="space-y-2 border-t border-border px-4 py-3 sm:px-5">
                <Notice>IR retenu en moins : {shortfalls.map(r => `${r.payslip.employee?.full_name || r.payslip.payslip_number} ${fmt(-r.regul.owed)} MAD`).join(', ')}. Rien n'est retenu sans confirmation séparée.</Notice>
                <button onClick={() => { if (confirm(`Retenir le complément d'IR sur ${shortfalls.length} bulletin(s) ?`)) applyRegularisations(shortfalls, true); }} disabled={busy} className={btnSecondary}>Retenir le complément</button>
              </div>
            )}
            <div className="flex flex-wrap justify-end gap-2 border-t border-border px-4 py-3 sm:px-5">
              <button onClick={() => setReguls(null)} className={btnSecondary}>Fermer</button>
              {refunds.length > 0 && <button onClick={() => applyRegularisations(refunds, false)} disabled={busy} className={btnPrimary}><Check className="h-4 w-4" /> Appliquer {fmt(refunds.reduce((t, r) => t + r.plan.apply, 0))} MAD</button>}
            </div>
          </section>
        )}

        <div className={`${panel} overflow-hidden`}>
          <ul className="divide-y divide-border md:hidden">
            {(detail.payslips || []).map(p => (
              <li key={p.id}>
                <button onClick={() => navigate(`/paie/bulletins/${p.id}`)} className="flex w-full items-start gap-3 px-4 py-3 text-left active:bg-secondary">
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 truncate font-medium text-foreground">{p.employee?.full_name || '—'}{p.is_locked && <Lock className="h-3 w-3 shrink-0 text-muted-foreground" aria-label="Verrouillé" />}</span>
                    <span className="block text-xs tabular-nums text-muted-foreground">Brut {fmt(p.total_gross)} · CNSS+AMO {fmt(p.cnss_employee + p.amo_employee)} · IR {fmt(p.ir_amount)}</span>
                  </span>
                  <span className="shrink-0 text-right font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">{fmt(p.net_salary)}</span>
                </button>
              </li>
            ))}
            <li className="flex items-center justify-between bg-secondary/40 px-4 py-3 text-sm font-semibold">
              <span className="text-muted-foreground">Totaux · IR {fmt(totals.total_ir)}</span>
              <span className="tabular-nums text-emerald-700 dark:text-emerald-300">{fmt(totals.total_net)}</span>
            </li>
          </ul>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead><tr className={theadRow}>
                <th className={th}>Employé</th>
                <th className={thRight}>Brut</th>
                <th className={thRight}>CNSS + AMO sal.</th>
                <th className={thRight}>IR retenu</th>
                <th className={thRight}>Net à payer</th>
                <th className={`${th} w-10`}><span className="sr-only">Verrou</span></th>
              </tr></thead>
              <tbody className="divide-y divide-border">
                {(detail.payslips || []).map(p => (
                  <tr key={p.id} onClick={() => navigate(`/paie/bulletins/${p.id}`)} className="cursor-pointer hover:bg-secondary/40">
                    <td className={`${td} font-medium text-foreground`}>{p.employee?.full_name || '—'}</td>
                    <td className={`${tdNum} text-foreground`}>{fmt(p.total_gross)}</td>
                    <td className={`${tdNum} text-muted-foreground`}>{fmt(p.cnss_employee + p.amo_employee)}</td>
                    <td className={`${tdNum} text-muted-foreground`}>{fmt(p.ir_amount)}</td>
                    <td className={`${tdNum} font-semibold text-emerald-700 dark:text-emerald-300`}>{fmt(p.net_salary)}</td>
                    <td className={`${td} text-center`}>{p.is_locked && <Lock className="inline h-3.5 w-3.5 text-muted-foreground" aria-label="Verrouillé" />}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr className={tfootRow}>
                <td className={`${td} text-right text-xs uppercase tracking-wide text-muted-foreground`}>Totaux</td>
                <td className={`${tdNum} text-foreground`}>{fmt(totals.total_gross)}</td>
                <td className={`${tdNum} text-foreground`}>{fmt(totals.total_cnss)}</td>
                <td className={`${tdNum} text-foreground`}>{fmt(totals.total_ir)}</td>
                <td className={`${tdNum} text-emerald-700 dark:text-emerald-300`}>{fmt(totals.total_net)}</td>
                <td></td>
              </tr></tfoot>
            </table>
          </div>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">Coût total employeur (brut + charges patronales) : <span className="font-semibold tabular-nums text-foreground">{fmt(totals.employer_cost)} MAD</span></p>

        {(validateButton || bookButton || regulButton || payButton || unvalidateButton) && <PhoneActionBar>{regulButton}{unvalidateButton}{payButton}{bookButton}{validateButton}</PhoneActionBar>}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[110rem]">
      <PageHeader title="Journée de paie" subtitle="Génération des bulletins en lot">
        <div className={`${panel} grid grid-cols-2 items-end gap-3 p-3 sm:flex sm:flex-wrap`}>
          <div className="sm:w-44"><label className={fieldLabel} htmlFor="run-month">Mois</label>
            <select id="run-month" value={month} onChange={e => setMonth(Number(e.target.value))} className={field}>{MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}</select></div>
          <div className="sm:w-32"><label className={fieldLabel} htmlFor="run-year">Année</label>
            <select id="run-year" value={year} onChange={e => setYear(Number(e.target.value))} className={field}>{YEARS.map(y => <option key={y} value={y}>{y}</option>)}</select></div>
          <button onClick={generate} disabled={busy} className={`${btnPrimary} col-span-2 sm:ml-auto`}>
            {busy ? <Loader className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Générer la paie du mois
          </button>
        </div>
      </PageHeader>

      <Panel title="Lots de paie">
        {runs.length === 0 ? <EmptyState icon={CalendarClock} title="Aucun lot de paie" /> : (
          <ul className="divide-y divide-border">
            {runs.map(r => (
              <li key={r.id}>
                <button onClick={() => open(r.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-secondary/40 sm:px-5">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10"><CalendarClock className="h-5 w-5 text-primary" aria-hidden="true" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-foreground">{MONTHS[r.period_month - 1]} {r.period_year}</span>
                    <span className="block truncate text-xs tabular-nums text-muted-foreground">Net {fmt(r.total_net)} MAD · coût {fmt(r.employer_cost)} MAD</span>
                  </span>
                  {r.status === 'validated' ? <StatusPill tone="success">Validé</StatusPill> : r.status === 'paid' ? <StatusPill tone="info">Payé</StatusPill> : <StatusPill tone="warning">Brouillon</StatusPill>}
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
