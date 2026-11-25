import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Download, FileMinus, Printer, RotateCcw, Save, X } from 'lucide-react';
import { SupabaseEmployeesService } from '../../utils/supabaseEmployees';
import { PayrollSettingsService } from '../../utils/supabasePayrollSettings';
import { HrSettingsService } from '../../utils/supabasePayrollHr';
import { StcService, type StcInputs, type StcRecord, type StcResults } from '../../utils/supabaseStc';
import { CompanySettingsService } from '../../utils/companySettings';
import { getCompanyContext } from '../../utils/supabaseCompanyFilter';
import { computeAnciennete } from '../../utils/payrollCalc';
import { hrLimitsFor, officialSettingsFor, smigMonthly, type PayrollSettings } from '../../utils/payrollDefaults';
import {
  computeStc, defaultNoticeMonths, exitMonthSalary, formatServiceLength, referenceSalary, serviceLength, STC_MOTIFS,
  type RefPayslip, type StcMotif,
} from '../../utils/stcCalc';
import type { LeaveYear } from '../../utils/hrLeave';
import { buildStcReceiptPdf, type StcPdfData } from '../../utils/hrPdf';
import type { PayslipLine } from '../../utils/payslipLines';
import type { Employee, Payslip } from '../../types';
import { localDay } from '../../utils/documentLines';
import { fmt, MONTHS } from '../../utils/payrollFormat';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';
import { PageHeader, Panel } from '../../components/PageHeader';
import { StatusPill } from '../../components/lists/StatusPill';
import { PrintPreviewModal } from '../../components/PrintPreviewModal';
import { btnPrimary, btnSecondary, EmptyState, field, fieldLabel, LoadingState, panel, td, tdNum, th, theadRow, thRight } from '../../components/backoffice/BackOfficeUi';
import { Notice } from './payrollUi';

const errMsg = (e: unknown) => (e instanceof Error ? e.message : (e as { message?: string })?.message || 'Échec');
const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')));
const STATUS: Record<StcRecord['status'], { label: string; tone: 'warning' | 'success' | 'neutral' | 'danger' }> = {
  draft: { label: 'Brouillon', tone: 'warning' }, validated: { label: 'Validé', tone: 'success' },
  cancelled: { label: 'Annulé', tone: 'neutral' }, reversed: { label: 'Validation annulée', tone: 'danger' },
};

interface Form {
  employeeId: string; motif: StcMotif; exitDate: string;
  /** '' = the default of the motif / the computed value. */
  notice: string; leave: string; reference: string; monthSalary: string;
  negotiated: string; damages: string; retirement: string; loans: string;
}
const EMPTY: Form = { employeeId: '', motif: 'licenciement', exitDate: localDay(), notice: '', leave: '', reference: '', monthSalary: '', negotiated: '', damages: '', retirement: '', loans: '' };

interface EmployeeData { refs: RefPayslip[]; loans: number; exitSlip: Payslip | null; exitLines: PayslipLine[]; leave: LeaveYear | null }

export default function StcPage() {
  const { isPaie, isSuperAdmin, currentUser } = useAuth();
  const { showToast } = useToast();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [records, setRecords] = useState<StcRecord[]>([]);
  const [migrationMissing, setMigrationMissing] = useState(false);
  const [restDay, setRestDay] = useState(0);
  const [settings, setSettings] = useState<PayrollSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<Form>(EMPTY);
  const [current, setCurrent] = useState<StcRecord | null>(null);
  const [data, setData] = useState<EmployeeData | null>(null);
  const [showRef, setShowRef] = useState(false);
  const [preview, setPreview] = useState<{ blob: Blob; filename: string } | null>(null);

  const exitYear = Number(form.exitDate.slice(0, 4)) || new Date().getFullYear();
  const set = (k: keyof Form, v: string) => setForm(f => ({ ...f, [k]: v }));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [emps, list, hr] = await Promise.all([SupabaseEmployeesService.list(), StcService.list(), HrSettingsService.get().catch(() => ({ weekly_rest_day: 0, migrationMissing: true }))]);
      setEmployees(emps); setRecords(list.records); setMigrationMissing(list.migrationMissing); setRestDay(hr.weekly_rest_day);
    } catch (e) { showToast({ type: 'error', message: errMsg(e) }); }
    finally { setLoading(false); }
  }, [showToast]);
  useEffect(() => { load(); }, [load]);

  // The exit year's parameters (SMIG floor, IR scale) apply.
  useEffect(() => {
    PayrollSettingsService.get(exitYear).then(setSettings).catch(() => setSettings(officialSettingsFor(exitYear)));
  }, [exitYear]);

  const emp = employees.find(e => e.id === form.employeeId);

  useEffect(() => {
    if (!emp || !settings || !/^\d{4}-\d{2}-\d{2}$/.test(form.exitDate)) { setData(null); return; }
    let live = true;
    Promise.all([
      StcService.referencePayslips(emp.id),
      StcService.loansRemaining(emp.id),
      StcService.exitMonthPayslip(emp.id, form.exitDate),
      StcService.leaveAtExit(emp, form.exitDate, settings.conges_days_per_month).catch(() => null),
    ]).then(([refs, loans, slip, leave]) => { if (live) setData({ refs, loans, exitSlip: slip.payslip, exitLines: slip.lines, leave }); })
      .catch(e => showToast({ type: 'error', message: errMsg(e) }));
    return () => { live = false; };
  }, [emp, form.exitDate, settings, showToast]);

  const readOnly = !!current && current.status !== 'draft';

  const calc = useMemo(() => {
    if (!emp || !settings || !data) return null;
    const length = serviceLength(emp.hire_date, form.exitDate);
    const [ey, em, ed] = form.exitDate.split('-').map(Number);
    const seniority = computeAnciennete(emp.hire_date, emp.base_salary, new Date(ey, em - 1, ed)).amount;
    const ref = referenceSalary(data.refs, form.exitDate, smigMonthly(settings), emp.base_salary + seniority);
    const reference = num(form.reference) ?? ref.value;
    const month = exitMonthSalary(emp.base_salary, emp.hire_date, form.exitDate, { restDay });
    const monthSalary = num(form.monthSalary) ?? month.amount;
    const noticeDefault = defaultNoticeMonths(form.motif, length);
    const leaveDefault = Math.max(0, data.leave?.balance ?? 0);
    const otherLines = data.exitSlip && !data.exitSlip.is_locked ? data.exitLines : [];
    const base = { motif: form.motif, hire_date: emp.hire_date, exit_date: form.exitDate, reference, monthSalary, employee: emp, settings, limits: hrLimitsFor(exitYear), otherLines };
    // The legal amount is the suggested agreed indemnity.
    const legal = computeStc({ ...base, noticeMonths: 0, leaveDays: 0, loans: 0 }).severance;
    const negotiatedDefault = legal.due ? legal.amount : 0;
    const inputs: StcInputs = {
      motif: form.motif, exit_date: form.exitDate, reference_override: num(form.reference), reference, month_salary: monthSalary,
      notice_months: num(form.notice) ?? noticeDefault, leave_days: num(form.leave) ?? leaveDefault,
      negotiated: num(form.negotiated) ?? negotiatedDefault, damages: num(form.damages) ?? 0, retirement: num(form.retirement) ?? 0,
      loans: num(form.loans) ?? data.loans,
    };
    const res = computeStc({ ...base, noticeMonths: inputs.notice_months, leaveDays: inputs.leave_days, negotiated: inputs.negotiated, damages: inputs.damages, retirement: inputs.retirement, loans: inputs.loans });
    const p = res.payslip;
    const results: StcResults = {
      elements: res.elements, lines: res.lines, service: formatServiceLength(res.length),
      gross: p.brut_global, cnss: p.cnss_employee, amo: p.amo_employee, cimr: p.cimr_employee, ir: p.ir_amount,
      loans: inputs.loans, net_to_pay: p.net_salary, exempt_ir: res.exemptIr, taxed_excess: res.taxedExcess,
    };
    return { res, ref, month, inputs, results, noticeDefault, leaveDefault, negotiatedDefault };
  }, [emp, settings, data, form, restDay, exitYear]);

  // A saved settlement other than a draft shows what was stored.
  const shown: StcResults | null = readOnly ? current!.results : calc?.results ?? null;
  const rules = STC_MOTIFS[form.motif];

  const open = (r: StcRecord) => {
    const i = r.inputs;
    const s = (n: number | null | undefined) => (n == null ? '' : String(n));
    setCurrent(r);
    setForm({
      employeeId: r.employee_id, motif: i.motif, exitDate: i.exit_date, notice: s(i.notice_months), leave: s(i.leave_days),
      reference: s(i.reference_override), monthSalary: s(i.month_salary), negotiated: s(i.negotiated), damages: s(i.damages),
      retirement: s(i.retirement), loans: s(i.loans),
    });
  };
  const startNew = () => { setCurrent(null); setForm(EMPTY); };

  const saveDraft = async (): Promise<StcRecord | null> => {
    if (!emp || !calc) return null;
    const saved = await StcService.saveDraft({ id: current?.id, employee_id: emp.id, inputs: calc.inputs, results: calc.results, created_by: currentUser?.username || null });
    setCurrent(saved);
    return saved;
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } catch (e) { showToast({ type: 'error', title: 'Erreur', message: errMsg(e) }); }
    finally { setBusy(false); }
  };

  const onSave = () => run(async () => { const s = await saveDraft(); if (s) showToast({ type: 'success', message: `Brouillon ${s.number} enregistré` }); await load(); });
  const onValidate = () => run(async () => {
    if (!emp || !calc) return;
    if (!confirm(`Valider le solde de ${emp.full_name} ? Le bulletin final de ${MONTHS[Number(form.exitDate.slice(5, 7)) - 1].toLowerCase()} est créé ou complété, les prêts sont soldés et l'employé est désactivé au ${form.exitDate.split('-').reverse().join('/')}.`)) return;
    const s = await saveDraft();
    if (!s) return;
    const v = await StcService.validate(s.id, currentUser?.username || null);
    setCurrent(v);
    showToast({ type: 'success', title: 'Solde validé', message: `${v.number} : bulletin final créé, employé sorti.` });
    await load();
  });
  const onCancel = () => run(async () => {
    if (!current || !confirm(`Annuler le brouillon ${current.number} ?`)) return;
    await StcService.cancel(current.id);
    showToast({ type: 'success', message: 'Brouillon annulé' });
    startNew(); await load();
  });
  const onReverse = () => run(async () => {
    if (!current || !confirm(`Annuler la validation de ${current.number} ? Le bulletin final est retiré (ou rétabli), les remboursements de prêts sont rendus et l'employé redevient actif.`)) return;
    const { warnings } = await StcService.reverse(current.id);
    warnings.forEach(w => showToast({ type: 'warning', message: w }));
    showToast({ type: 'success', message: 'Validation annulée : employé rétabli' });
    startNew(); await load();
  });

  const pdf = async (): Promise<{ blob: Blob; filename: string } | null> => {
    if (!emp || !shown) return null;
    const { companyId } = getCompanyContext();
    const company = companyId ? await CompanySettingsService.getSettings(companyId).catch(() => null) : null;
    const d: StcPdfData = {
      number: current?.number || 'STC (non enregistré)', provisional: !current || current.status !== 'validated',
      motifLabel: rules.label, exitDate: form.exitDate, service: shown.service,
      elements: shown.elements.map(e => ({ label: e.label, amount: e.amount, due: e.due, detail: e.detail })),
      deductions: [
        { label: 'CNSS', amount: shown.cnss }, { label: 'AMO', amount: shown.amo }, { label: 'CIMR', amount: shown.cimr },
        { label: 'Impôt sur le revenu', amount: shown.ir }, { label: 'Avances et prêts', amount: shown.loans },
      ],
      gross: shown.gross, netToPay: shown.net_to_pay, issuedOn: localDay(),
    };
    const { doc, filename } = buildStcReceiptPdf(emp, company, d);
    return { blob: doc.output('blob'), filename };
  };
  const onPreview = () => run(async () => { const p = await pdf(); if (p) setPreview(p); });
  const onDownload = () => run(async () => {
    const p = await pdf();
    if (!p) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(p.blob); a.download = p.filename; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  if (!isPaie && !isSuperAdmin) return <div className="py-12 text-center text-muted-foreground">Accès réservé au rôle Paie.</div>;
  if (loading) return <LoadingState />;

  const exitMonth = Number(form.exitDate.slice(5, 7));
  // Notices about the exit month only matter before validation.
  const lockedSlip = !readOnly && data?.exitSlip?.is_locked ? data.exitSlip : null;
  const noticeEditable = rules.notice === 'employer' || rules.notice === 'optional';
  const inputCls = `${field} tabular-nums`;
  const numField = (id: string, label: string, key: keyof Form, placeholder: string, disabled = false) => (
    <div><label className={fieldLabel} htmlFor={id}>{label}</label>
      <input id={id} type="number" step="0.01" min={0} value={form[key]} placeholder={placeholder} disabled={readOnly || disabled}
        onChange={e => set(key, e.target.value)} className={inputCls} /></div>
  );

  return (
    <div className="mx-auto max-w-[110rem]">
      <PageHeader
        title="Solde de tout compte"
        subtitle={current ? `${current.number} · ${STATUS[current.status].label}` : 'Indemnités de fin de contrat'}
        actions={<>
          {current && <button onClick={startNew} className={btnSecondary}>Nouveau</button>}
          {shown && <button onClick={onPreview} disabled={busy} className={btnSecondary}><Printer className="h-4 w-4" /> Aperçu</button>}
          {shown && <button onClick={onDownload} disabled={busy} className={btnSecondary}><Download className="h-4 w-4" /> PDF</button>}
        </>}
      />

      {migrationMissing && (
        <Notice className="mb-4">La base n'est pas à jour (migration 20261126150000_hr.sql) : le calcul et le reçu provisoire fonctionnent, l'enregistrement et la validation non.</Notice>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-4">
          <section className={`${panel} grid grid-cols-2 items-end gap-3 p-4 sm:grid-cols-3 lg:grid-cols-4`} aria-label="Données du solde">
            <div className="col-span-2"><label className={fieldLabel} htmlFor="stc-employee">Employé</label>
              <select id="stc-employee" value={form.employeeId} disabled={!!current} onChange={e => setForm({ ...EMPTY, employeeId: e.target.value, motif: form.motif, exitDate: form.exitDate })} className={field}>
                <option value="">—</option>{employees.filter(e => e.is_active || e.id === form.employeeId).map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
              </select></div>
            <div><label className={fieldLabel} htmlFor="stc-motif">Motif</label>
              <select id="stc-motif" value={form.motif} disabled={readOnly} onChange={e => setForm(f => ({ ...f, motif: e.target.value as StcMotif, notice: '', negotiated: '' }))} className={field}>
                {(Object.keys(STC_MOTIFS) as StcMotif[]).map(k => <option key={k} value={k}>{STC_MOTIFS[k].label}</option>)}
              </select></div>
            <div><label className={fieldLabel} htmlFor="stc-sortie">Date de sortie (dernier jour)</label>
              <input id="stc-sortie" type="date" value={form.exitDate} disabled={readOnly} onChange={e => set('exitDate', e.target.value)} className={field} /></div>
            {numField('stc-preavis', 'Préavis payé (mois)', 'notice', calc ? String(calc.noticeDefault) : '', !noticeEditable)}
            {numField('stc-conges', 'Congés non pris (jours)', 'leave', calc ? String(calc.leaveDefault) : '')}
            {numField('stc-ref', 'Salaire de référence', 'reference', calc ? String(calc.ref.value) : '')}
            {numField('stc-mois', 'Salaire du mois de sortie', 'monthSalary', calc ? String(calc.month.amount) : '')}
            {rules.severance === 'negotiated' && numField('stc-negocie', 'Indemnité convenue', 'negotiated', calc ? String(calc.negotiatedDefault) : '')}
            {rules.damages && numField('stc-dommages', 'Dommages-intérêts (jugement)', 'damages', '0')}
            {rules.retirement && numField('stc-retraite', 'Indemnité de retraite (convention)', 'retirement', '0')}
            {numField('stc-prets', 'Avances / prêts retenus', 'loans', data ? String(data.loans) : '')}
          </section>

          {!emp && <div className={panel}><EmptyState icon={FileMinus} title="Choisissez un employé pour calculer son solde de tout compte." /></div>}

          {emp && calc && shown && (<>
            <div className="space-y-2">
              {lockedSlip && <Notice tone="error">Le bulletin de {MONTHS[exitMonth - 1].toLowerCase()} {exitYear} ({lockedSlip.payslip_number}) est déjà validé : dévalidez-le (ou son lot) pour y ajouter le solde.</Notice>}
              {!readOnly && data?.exitSlip && !lockedSlip && <Notice tone="info">Un bulletin existe pour {MONTHS[exitMonth - 1].toLowerCase()} ({data.exitSlip.payslip_number}{data.exitSlip.run_id ? ', dans le lot du mois' : ''}) : le solde y sera ajouté{data.exitSlip.run_id ? ' et validé avec le lot' : ''}.</Notice>}
              {!calc.res.severance.due && rules.severance === 'legal' && <Notice>Indemnité de licenciement non due : {calc.res.severance.reason}.</Notice>}
              {calc.res.loanCheck.error && <Notice tone="error">{calc.res.loanCheck.error}</Notice>}
              {calc.res.loanCheck.warning && <Notice>{calc.res.loanCheck.warning} La limite de retenue s'applique peut-être aussi au solde de tout compte : à vérifier ; réduisez la retenue si besoin.</Notice>}
              {calc.ref.floored && !form.reference && <Notice tone="info">Salaire moyen sous le SMIG {exitYear} : le minimum légal ({fmt(calc.ref.floor)} MAD) est retenu.</Notice>}
              {calc.ref.source === 'fallback' && !form.reference && <Notice tone="info">Aucun bulletin validé : le salaire de référence est le salaire actuel (base + ancienneté).</Notice>}
            </div>

            <section className={`${panel} overflow-hidden`} aria-label="Éléments du solde">
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-4 py-3 sm:px-5">
                <h2 className="font-semibold text-foreground">{emp.full_name} · {rules.label}</h2>
                <p className="text-sm text-muted-foreground">Ancienneté {shown.service} · référence {fmt(readOnly ? current!.inputs.reference : calc.inputs.reference)} MAD</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className={theadRow}><th className={th}>Élément</th><th className={th}>Calcul</th><th className={th}>IR</th><th className={th}>CNSS / AMO</th><th className={thRight}>Montant</th></tr></thead>
                  <tbody className="divide-y divide-border">
                    {shown.elements.map(el => (
                      <tr key={el.code} className={el.due ? '' : 'text-muted-foreground'}>
                        <td className={`${td} font-medium`}>{el.label}</td>
                        <td className={`${td} text-xs`}>{el.detail}</td>
                        <td className={`${td} text-xs`}>{el.ir}</td>
                        <td className={`${td} text-xs`}>{el.cnss}</td>
                        <td className={`${tdNum} font-semibold`}>{el.due || el.amount ? fmt(el.amount) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <dl className="space-y-1.5 border-t border-border px-4 py-3 text-sm sm:px-5">
                <Row label="Brut du bulletin final" value={shown.gross} bold />
                {shown.exempt_ir > 0 && <Row label="dont indemnités exonérées d'IR" value={shown.exempt_ir} muted />}
                {shown.taxed_excess > 0 && <Row label="dont excédent imposable (au-delà du plafond)" value={shown.taxed_excess} muted />}
                <Row label="CNSS salarié" value={-shown.cnss} />
                <Row label="AMO salarié" value={-shown.amo} />
                {shown.cimr > 0 && <Row label="CIMR salarié" value={-shown.cimr} />}
                <Row label="Impôt sur le revenu" value={-shown.ir} />
                {shown.loans > 0 && <Row label="Avances et prêts soldés" value={-shown.loans} />}
                <div className="flex justify-between gap-4 border-t border-border pt-2 text-base font-bold text-foreground"><dt>Net à payer</dt><dd className="tabular-nums">{fmt(shown.net_to_pay)} MAD</dd></div>
              </dl>
              <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground sm:px-5">
                Calculé comme un bulletin final séparé du mois de sortie : le préavis et les congés s'ajoutent au salaire du mois et l'IR est calculé comme pour tout bulletin (montant du mois × 12). Les indemnités de rupture sont exonérées d'IR dans la limite de {fmt(hrLimitsFor(exitYear).severance_ir_ceiling)} MAD au total (CGI art. 57-7°). Traitement CNSS des indemnités : à confirmer avec la CNSS.
              </p>
            </section>

            {!readOnly && (
              <section className={`${panel} overflow-hidden`}>
                <button onClick={() => setShowRef(v => !v)} aria-expanded={showRef} className="w-full px-4 py-3 text-left text-sm font-semibold text-foreground hover:bg-secondary/40 sm:px-5">
                  Salaire de référence : {calc.ref.months.length ? `moyenne de ${calc.ref.months.length} bulletin(s) validé(s)` : 'salaire actuel'} = {fmt(calc.ref.source === 'payslips' ? calc.ref.average : calc.ref.value)} MAD {showRef ? '▲' : '▼'}
                </button>
                {showRef && calc.ref.months.length > 0 && (
                  <div className="overflow-x-auto border-t border-border">
                    <table className="w-full text-sm">
                      <thead><tr className={theadRow}><th className={th}>Mois</th><th className={thRight}>Base</th><th className={thRight}>Ancienneté</th><th className={thRight}>Primes</th><th className={thRight}>Absences</th><th className={thRight}>Total</th></tr></thead>
                      <tbody className="divide-y divide-border">
                        {calc.ref.months.map(m => (
                          <tr key={m.id}><td className={td}>{MONTHS[m.month - 1]} {m.year}</td><td className={tdNum}>{fmt(m.base)}</td><td className={tdNum}>{fmt(m.seniority)}</td><td className={tdNum}>{fmt(m.gains)}</td><td className={tdNum}>{m.absences ? `−${fmt(m.absences)}` : '—'}</td><td className={`${tdNum} font-semibold`}>{fmt(m.total)}</td></tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="px-4 py-2 text-xs text-muted-foreground sm:px-5">Base + ancienneté + primes soumises (remboursements de frais exonérés exclus) − absences. Jamais sous le SMIG × 191 ({fmt(calc.ref.floor)} MAD).</p>
                  </div>
                )}
              </section>
            )}

            <div className="flex flex-wrap justify-end gap-2">
              {(!current || current.status === 'draft') && <button onClick={onSave} disabled={busy || migrationMissing} className={btnSecondary}><Save className="h-4 w-4" /> Enregistrer le brouillon</button>}
              {current?.status === 'draft' && <button onClick={onCancel} disabled={busy} className={btnSecondary}><X className="h-4 w-4" /> Annuler le brouillon</button>}
              {(!current || current.status === 'draft') && <button onClick={onValidate} disabled={busy || migrationMissing || !!lockedSlip || !!calc.res.loanCheck.error} className={btnPrimary}><Check className="h-4 w-4" /> Valider le solde</button>}
              {current?.status === 'validated' && <button onClick={onReverse} disabled={busy} className={btnSecondary}><RotateCcw className="h-4 w-4" /> Annuler la validation</button>}
            </div>
          </>)}
        </div>

        <Panel title="Soldes enregistrés">
          {records.length === 0 ? <EmptyState title={migrationMissing ? 'Base non à jour' : 'Aucun solde'} /> : (
            <ul className="divide-y divide-border">
              {records.map(r => (
                <li key={r.id}>
                  <button onClick={() => open(r)} className={`flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-secondary/40 ${current?.id === r.id ? 'bg-secondary/60' : ''}`}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">{r.employee?.full_name || employees.find(e => e.id === r.employee_id)?.full_name || '—'}</span>
                      <span className="block text-xs text-muted-foreground">{r.number} · {STC_MOTIFS[r.motif]?.label}</span>
                    </span>
                    <StatusPill tone={STATUS[r.status].tone}>{STATUS[r.status].label}</StatusPill>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {preview && <PrintPreviewModal blob={preview.blob} filename={preview.filename} onClose={() => setPreview(null)} />}
    </div>
  );
}

function Row({ label, value, bold, muted }: { label: string; value: number; bold?: boolean; muted?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 ${bold ? 'font-semibold text-foreground' : muted ? 'pl-3 text-xs text-muted-foreground' : 'text-muted-foreground'}`}>
      <dt>{label}</dt><dd className="tabular-nums text-foreground">{fmt(value)}</dd>
    </div>
  );
}
