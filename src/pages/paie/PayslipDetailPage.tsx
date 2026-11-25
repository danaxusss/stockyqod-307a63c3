import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Download, Printer, Plus, Trash2, ChevronDown, ChevronRight, Check, Lock, RefreshCw, Scale } from 'lucide-react';
import type { Employee, Payslip } from '../../types';
import { SupabasePayslipsService } from '../../utils/supabasePayslips';
import { CompanySettingsService } from '../../utils/companySettings';
import { RubriquesService, type Rubrique } from '../../utils/supabaseRubriques';
import { PayrollSettingsService } from '../../utils/supabasePayrollSettings';
import { PayrollRunService } from '../../utils/supabasePayrollRun';
import { exportPayslipToPdf, generatePayslipPdfBlob } from '../../utils/pdfExport';
import { checkNetPay, isGrossDeduction, smigWarning } from '../../utils/payrollCalc';
import { officialSettingsFor, type PayrollSettings } from '../../utils/payrollDefaults';
import { computeForPayslip, storedResult } from '../../utils/payslipCompute';
import { blankLine, LOAN_LINE, payslipLines, ruleAmount, type PayslipLine } from '../../utils/payslipLines';
import { planRegularisation, type IrRegularisation } from '../../utils/payrollRegularisation';
import { fmt, MONTHS, pct } from '../../utils/payrollFormat';
import { PrintPreviewModal } from '../../components/PrintPreviewModal';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';
import { useKeyboardSave, useAutoSave } from '../../hooks/useShortcuts';
import { StatusPill } from '../../components/lists/StatusPill';
import { DocPhoneBar } from '../../components/documents/DocParts';
import { btnPrimary, btnSecondary, btnSoft, fieldLabel, fieldSm, iconBtn, iconBtnDanger, LoadingState, panel, textArea } from '../../components/backoffice/BackOfficeUi';
import { Notice } from './payrollUi';

const errMsg = (e: unknown) => (e instanceof Error ? e.message : (e as { message?: string })?.message || String(e));
const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export default function PayslipDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isSuperAdmin, isPaie, companyId: ctxCompanyId } = useAuth();
  const { showToast } = useToast();

  const [payslip, setPayslip] = useState<Payslip | null>(null);
  const [lines, setLines] = useState<PayslipLine[]>([]);
  const [rubriques, setRubriques] = useState<Rubrique[]>([]);
  const [settings, setSettings] = useState<PayrollSettings>(officialSettingsFor(new Date().getFullYear()));
  const [isLoading, setIsLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showPrintPreview, setShowPrintPreview] = useState(false);
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
  const [previewFilename, setPreviewFilename] = useState('');
  const [showEmployerCost, setShowEmployerCost] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [regul, setRegul] = useState<IrRegularisation | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setIsLoading(true);
    try {
      const doc = await SupabasePayslipsService.getById(id);
      if (!doc) throw new Error('Bulletin introuvable');
      setPayslip(doc);
      const [vars, rubs, s] = await Promise.all([
        SupabasePayslipsService.getVariables(id),
        RubriquesService.list().catch(() => [] as Rubrique[]),
        PayrollSettingsService.get(doc.period_year).catch(() => officialSettingsFor(doc.period_year)),
      ]);
      setRubriques(rubs); setSettings(s);
      setLines(payslipLines(doc, vars));
      setDirty(false);
      setRegul(null);
    } catch (e) {
      showToast({ type: 'error', title: 'Erreur', message: errMsg(e) });
    } finally { setIsLoading(false); }
  }, [id, showToast]);

  useEffect(() => { load(); }, [load]);

  const emp = payslip?.employee as Employee | undefined;
  const locked = payslip?.is_locked === true;

  // Computed from the payslip's own base salary, never the employee's current
  // one; a validated payslip shows what was paid, not a recomputation.
  const res = useMemo(() => {
    if (!payslip) return null;
    const live = computeForPayslip(payslip, emp, lines, settings);
    return payslip.is_locked ? storedResult(payslip, live) : live;
  }, [payslip, emp, lines, settings]);

  const loanWithheld = r2(lines.filter(l => l.type === 'retenue' && l.code === LOAN_LINE.code).reduce((s, l) => s + l.amount, 0));
  const netCheck = res ? checkNetPay(res.net_salary, loanWithheld) : { error: null, warning: null };
  const smig = payslip ? smigWarning(payslip.base_salary, settings, payslip.hours_worked) : null;
  const salaryChanged = !!payslip && !!emp && !locked && r2(emp.base_salary) !== r2(payslip.base_salary);

  const save = useCallback(async () => {
    // A validated payslip is final: its cumuls, loan repayments and entries are booked.
    if (!payslip || payslip.is_locked) return;
    try {
      // The screen keeps what was typed meanwhile: it computes live from the same rules.
      await PayrollRunService.savePayslip(payslip, lines, { settings, employee: emp ?? null, companyId: ctxCompanyId || null });
      setDirty(false);
    } catch (e) {
      showToast({ type: 'error', title: 'Erreur sauvegarde', message: errMsg(e) });
    }
  }, [payslip, lines, settings, emp, ctxCompanyId, showToast]);

  useKeyboardSave(save, !!payslip && !isLoading && !locked);
  useAutoSave(save, !!payslip && !isLoading && dirty && !locked);

  // What the PDF shows: the stored figures of a locked payslip, else the live calculation.
  const pdfPayslip = () => {
    if (!payslip || !res) return null;
    const figures = locked ? {} : {
      ...res, total_gross: res.brut_global, other_deductions: res.autres_retenues,
      ir_taxable_gross: res.brut_imposable, net_taxable: res.net_imposable,
    };
    return { ...payslip, ...figures, lines, rates: settings };
  };

  const updateLine = (idx: number, patch: Partial<PayslipLine>) => { setLines(prev => prev.map((l, i) => i === idx ? { ...l, ...patch } : l)); setDirty(true); };
  const removeLine = (idx: number) => { setLines(prev => prev.filter((_, i) => i !== idx)); setDirty(true); };
  const addLine = (kind: 'gain' | 'absence' | 'retenue') => {
    const l = kind === 'gain' ? blankLine('gain')
      : kind === 'absence' ? { ...blankLine('retenue'), label: 'Absence', soumis_cnss: true, soumis_amo: true, soumis_ir: true, soumis_cimr: true }
        : blankLine('retenue');
    setLines(prev => [...prev, l]);
    setDirty(true);
  };
  /** A line taken from a rubrique inherits its flags, ceilings and rule. */
  const pickRubrique = (idx: number, rubId: string) => {
    const r = rubriques.find(x => x.id === rubId);
    if (!r) { updateLine(idx, { rubrique_id: null, code: null, base: 'fixe' }); return; }
    const base = r.base || 'fixe';
    const quantity = base === 'heures' ? (lines[idx].base === 'heures' ? lines[idx].quantity : 0) : 1;
    const rule = payslip ? ruleAmount({ base, quantity, rate: r.rate }, payslip.base_salary) : null;
    updateLine(idx, {
      rubrique_id: r.id, code: r.code, label: r.label, base, quantity, rate: r.rate,
      soumis_cnss: r.soumis_cnss, soumis_amo: r.soumis_amo, soumis_ir: r.soumis_ir, soumis_cimr: r.soumis_cimr,
      inclus_anciennete: r.inclus_anciennete, ir_ceiling: r.ir_ceiling, cnss_ceiling: r.cnss_ceiling,
      ...(rule != null ? { amount: rule } : {}),
    });
  };
  const setHours = (idx: number, hours: number) => {
    const l = lines[idx];
    updateLine(idx, { quantity: hours, amount: ruleAmount({ ...l, quantity: hours }, payslip?.base_salary || 0) ?? l.amount });
  };

  /** Explicit: an unlocked payslip keeps its own salary until asked to take the current one. */
  const takeCurrentSalary = () => {
    if (!payslip || !emp) return;
    const old = payslip.base_salary;
    const base = emp.base_salary;
    setPayslip({ ...payslip, base_salary: base });
    // Lines computed from the salary follow it, unless their amount was typed over.
    setLines(prev => prev.map(l => {
      const before = ruleAmount(l, old);
      return before != null && r2(before) === r2(l.amount) ? { ...l, amount: ruleAmount(l, base) ?? l.amount } : l;
    }));
    setDirty(true);
  };

  const getCompany = async () => {
    if (!payslip) return null;
    const compId = payslip.company_id || ctxCompanyId;
    if (!compId) return null;
    try { return await CompanySettingsService.getSettings(compId); } catch { return null; }
  };

  const handleExportPdf = async () => {
    if (!payslip || !res) return;
    if (dirty) await save();
    try { await exportPayslipToPdf(pdfPayslip(), await getCompany()); }
    catch (e) { showToast({ type: 'error', title: 'Erreur PDF', message: errMsg(e) }); }
  };

  const handlePreview = async () => {
    if (!payslip || !res) return;
    if (dirty) await save();
    try {
      const { blob, filename } = await generatePayslipPdfBlob(pdfPayslip(), await getCompany());
      setPreviewBlob(blob); setPreviewFilename(filename); setShowPrintPreview(true);
    } catch (e) { showToast({ type: 'error', title: 'Erreur aperçu', message: errMsg(e) }); }
  };

  const validate = async () => {
    if (!payslip || !res) return;
    if (netCheck.error) { showToast({ type: 'error', title: 'Validation impossible', message: netCheck.error }); return; }
    if (!confirm('Valider ce bulletin ? Il ne pourra plus être modifié (cumuls et remboursements enregistrés).')) return;
    setBusy(true);
    try {
      if (dirty) await save();
      await PayrollRunService.validatePayslip(payslip.id);
      showToast({ type: 'success', message: 'Bulletin validé' });
      await load();
    } catch (e) { showToast({ type: 'error', title: 'Erreur', message: errMsg(e) }); }
    finally { setBusy(false); }
  };

  const previewRegularisation = async () => {
    if (!payslip) return;
    setBusy(true);
    try { setRegul(await PayrollRunService.regularisationFor(payslip, emp ?? null, settings)); }
    catch (e) { showToast({ type: 'error', title: 'Erreur', message: errMsg(e) }); }
    finally { setBusy(false); }
  };

  const applyRegularisation = async (collect: boolean) => {
    if (!payslip) return;
    setBusy(true);
    try {
      if (dirty) await save();
      const { plan } = await PayrollRunService.applyRegularisation(payslip.id, { collect });
      showToast({
        type: 'success', title: 'Régularisation enregistrée',
        message: plan.remainder > 0 ? `${fmt(plan.apply)} MAD rendus ce mois, ${fmt(plan.remainder)} MAD restent dus au salarié.` : `${fmt(Math.abs(plan.apply))} MAD ${plan.apply >= 0 ? 'rendus' : 'retenus'} sur l'IR du mois.`,
      });
      await load();
    } catch (e) { showToast({ type: 'error', title: 'Erreur', message: errMsg(e) }); }
    finally { setBusy(false); }
  };

  const cancelRegularisation = () => {
    if (!payslip) return;
    setPayslip({ ...payslip, ir_regularisation: 0, ir_regularisation_ids: [] });
    setDirty(true);
  };

  if (!isPaie && !isSuperAdmin) return <div className="py-12 text-center text-muted-foreground">Accès réservé au rôle Paie.</div>;
  if (isLoading) return <LoadingState />;
  if (!payslip) return <div className="py-12 text-center text-muted-foreground">Bulletin introuvable.</div>;

  const indexed = lines.map((l, i) => ({ l, i }));
  const gains = indexed.filter(x => x.l.type === 'gain');
  const absences = indexed.filter(x => isGrossDeduction(x.l));
  const afterTax = indexed.filter(x => x.l.type === 'retenue' && !isGrossDeduction(x.l));
  const inputCls = fieldSm;
  const regLabel = `Régularisation IR ${payslip.period_year}`;
  const appliedReg = res?.ir_regularisation || 0;
  const cimrRate = Number(emp?.cimr_rate) || 0;
  const cimrErRate = emp?.cimr_employer_rate == null ? cimrRate : Number(emp.cimr_employer_rate) || 0;

  const rubSelect = (line: PayslipLine, idx: number) => (
    <select value={line.rubrique_id || ''} onChange={e => pickRubrique(idx, e.target.value)} className={`${inputCls} sm:max-w-[12rem]`} disabled={locked} aria-label="Rubrique">
      <option value="">Personnalisé…</option>
      {rubriques.filter(r => r.type === line.type).map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
    </select>
  );

  // Compact "subject to" toggles; a line from a rubrique starts with the rubrique's.
  const flag = (l: PayslipLine, i: number, key: 'soumis_cnss' | 'soumis_amo' | 'soumis_ir' | 'soumis_cimr' | 'inclus_anciennete', label: string, title: string) => (
    <button type="button" key={key} disabled={locked} aria-pressed={l[key]} title={title}
      onClick={() => updateLine(i, { [key]: !l[key] } as Partial<PayslipLine>)}
      className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${l[key] ? 'bg-primary/15 text-primary' : 'bg-secondary text-muted-foreground/70'} disabled:cursor-default`}>
      {label}
    </button>
  );
  const flags = (l: PayslipLine, i: number) => (
    <span className="flex flex-wrap gap-1" aria-label="Soumis à">
      {flag(l, i, 'soumis_cnss', 'CNSS', 'Soumis à la CNSS')}
      {flag(l, i, 'soumis_amo', 'AMO', 'Soumis à l\'AMO')}
      {flag(l, i, 'soumis_ir', 'IR', 'Soumis à l\'IR')}
      {flag(l, i, 'soumis_cimr', 'CIMR', 'Soumis à la CIMR')}
      {l.type === 'gain' && flag(l, i, 'inclus_anciennete', 'Anc.', 'Inclus dans la base de la prime d\'ancienneté')}
    </span>
  );
  const ceilingNote = (l: PayslipLine) => {
    const parts: string[] = [];
    const txt = (c: PayslipLine['ir_ceiling']) => (c ? (c.type === 'percent' ? `${c.value} % du salaire de base` : `${fmt(c.value)} MAD`) : '');
    if (!l.soumis_ir && l.ir_ceiling) parts.push(`exonéré IR jusqu'à ${txt(l.ir_ceiling)}`);
    if (!l.soumis_cnss && l.cnss_ceiling) parts.push(`exonéré CNSS jusqu'à ${txt(l.cnss_ceiling)}`);
    return parts.length ? <span className="block text-xs text-muted-foreground">{parts.join(' · ')}</span> : null;
  };
  const hoursEditor = (l: PayslipLine, i: number) => {
    if (l.base !== 'heures') return null;
    const rule = ruleAmount(l, payslip.base_salary) ?? 0;
    return (
      <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <input type="number" min={0} step={0.5} aria-label="Nombre d'heures" className={`${inputCls} w-20 text-right tabular-nums`} value={l.quantity} disabled={locked}
          onChange={e => setHours(i, parseFloat(e.target.value) || 0)} />
        <span>h × {fmt(payslip.base_salary / 191)} × {String(l.rate).replace('.', ',')} = {fmt(rule)}{r2(rule) !== r2(l.amount) && ' (montant modifié)'}</span>
      </span>
    );
  };

  const lineGrid = 'md:grid-cols-[minmax(0,1fr)_10.5rem_8rem_2.75rem]';
  const retGrid = 'md:grid-cols-[minmax(0,1fr)_9rem_2.75rem]';
  const headCls = 'hidden gap-2 border-b border-border bg-secondary/40 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:px-5 md:grid';
  const fixedRow = 'flex items-center justify-between gap-3 bg-secondary/20 px-4 py-2.5 text-sm sm:px-5';
  const addButton = (kind: 'gain' | 'absence' | 'retenue', label = 'Ajouter') => (
    <button onClick={() => addLine(kind)} className="inline-flex min-h-9 items-center gap-1 rounded-md px-2 text-sm font-semibold text-primary hover:bg-primary/10"><Plus className="h-4 w-4" /> {label}</button>
  );
  const removeButton = (i: number) => !locked && (
    <button onClick={() => removeLine(i)} aria-label="Supprimer la ligne" title="Supprimer la ligne" className={iconBtnDanger}><Trash2 className="h-4 w-4" /></button>
  );
  const saveButton = !locked && <button onClick={save} className={btnPrimary}><Check className="h-4 w-4" />Enregistrer</button>;

  const editableRow = (l: PayslipLine, i: number, negative: boolean) => (
    <li key={i} className={`grid grid-cols-2 items-center gap-2 px-4 py-3 sm:px-5 md:py-2 ${lineGrid}`}>
      <div className="col-span-2 flex flex-col gap-1.5 md:col-span-1">
        <div className="flex flex-col gap-2 sm:flex-row">
          {rubSelect(l, i)}
          <input className={`min-w-0 flex-1 ${inputCls}`} placeholder="Libellé…" aria-label="Libellé" value={l.label} onChange={e => updateLine(i, { label: e.target.value })} disabled={locked} />
        </div>
        {hoursEditor(l, i)}
        {ceilingNote(l)}
      </div>
      {flags(l, i)}
      <div className="flex items-center gap-1">
        {negative && <span className="text-sm text-muted-foreground" aria-hidden="true">−</span>}
        <input type="number" min={0} step={0.01} aria-label={negative ? 'Montant déduit du brut' : 'Montant'} className={`w-full text-right tabular-nums ${inputCls}`} value={l.amount}
          onChange={e => updateLine(i, { amount: parseFloat(e.target.value) || 0 })} disabled={locked} />
      </div>
      <div className="flex justify-end">{removeButton(i)}</div>
    </li>
  );

  return (
    <div className="mx-auto max-w-[110rem] pb-28 md:pb-0">
      {/* Title */}
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-1 basis-full items-center gap-2 sm:basis-0">
          <button onClick={() => navigate('/paie/bulletins')} aria-label="Retour aux bulletins" className={iconBtn}><ArrowLeft className="h-4 w-4" /></button>
          <div className="min-w-0 flex-1">
            <nav aria-label="Fil d’Ariane" className="hidden items-center gap-1.5 text-sm text-muted-foreground sm:flex">
              <Link to="/paie/bulletins" className="hover:text-foreground">Bulletins de paie</Link>
              <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="text-foreground">{payslip.payslip_number}</span>
            </nav>
            <h1 className="truncate font-mono text-xl font-bold tracking-tight text-foreground sm:text-2xl">{payslip.payslip_number}</h1>
            <p className="text-sm text-muted-foreground">{emp?.full_name} — {MONTHS[payslip.period_month - 1]} {payslip.period_year}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {locked && <StatusPill tone="warning" icon={<Lock className="h-3 w-3" />}>verrouillé</StatusPill>}
          {dirty && <StatusPill tone="warning">Non sauvegardé</StatusPill>}
          <button onClick={handlePreview} className={btnSecondary}><Printer className="h-4 w-4" /><span>Aperçu</span></button>
          <button onClick={handleExportPdf} className={btnSecondary}><Download className="h-4 w-4" /><span>PDF</span></button>
        </div>
      </div>

      <div className="mb-4 space-y-2">
        {netCheck.error && <Notice tone="error">{netCheck.error}</Notice>}
        {netCheck.warning && <Notice>{netCheck.warning}</Notice>}
        {smig && <Notice>{smig}</Notice>}
        {salaryChanged && (
          <Notice tone="info">
            <span>Ce bulletin est calculé sur {fmt(payslip.base_salary)} MAD ; le salaire actuel de l'employé est {fmt(emp!.base_salary)} MAD. </span>
            <button onClick={takeCurrentSalary} className="font-semibold underline">Reprendre le salaire actuel de l'employé</button>
          </Notice>
        )}
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-4">
          {emp && (
            <section className={`${panel} grid grid-cols-2 gap-4 p-4 sm:p-5 md:grid-cols-5`} aria-label="Salarié">
              <div><p className="text-xs text-muted-foreground">Poste</p><p className="mt-0.5 text-sm font-medium text-foreground">{emp.position || '—'}</p></div>
              <div><p className="text-xs text-muted-foreground">Contrat</p><p className="mt-0.5 text-sm font-medium text-foreground">{emp.contract_type}</p></div>
              <div><p className="text-xs text-muted-foreground">N° CNSS</p><p className="mt-0.5 font-mono text-sm text-foreground">{emp.cnss_number || '—'}</p></div>
              <div><label className="text-xs text-muted-foreground" htmlFor="ps-hours">Heures travaillées</label>
                <input id="ps-hours" type="number" min={0} max={300} className={`mt-0.5 w-28 ${inputCls} tabular-nums`} value={payslip.hours_worked} disabled={locked}
                  onChange={e => { setPayslip(p => p ? { ...p, hours_worked: Number(e.target.value) } : p); setDirty(true); }} /></div>
              <div><label className="text-xs text-muted-foreground" htmlFor="ps-days">Jours déclarés CNSS</label>
                <input id="ps-days" type="number" min={0} max={31} className={`mt-0.5 w-28 ${inputCls} tabular-nums`} value={payslip.cnss_days ?? 26} disabled={locked}
                  onChange={e => { setPayslip(p => p ? { ...p, cnss_days: Math.max(0, Math.min(31, Math.round(Number(e.target.value) || 0))) } : p); setDirty(true); }} /></div>
            </section>
          )}

          {/* Rémunération: every row adds up to the gross (absences negative). */}
          <section className={`${panel} overflow-hidden`}>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3 sm:px-5">
              <h2 className="font-semibold text-foreground">Éléments de rémunération</h2>
              {!locked && <span className="flex gap-1">{addButton('gain', 'Gain')}{addButton('absence', 'Absence')}</span>}
            </div>
            <div className={`${headCls} ${lineGrid}`}>
              <span>Rubrique / libellé</span>
              <span>Soumis à</span>
              <span className="text-right">Montant</span>
              <span />
            </div>
            <ul className="divide-y divide-border">
              <li className={fixedRow}>
                <span className="font-medium text-foreground">Salaire de base</span>
                <span className="font-semibold tabular-nums text-foreground">{fmt(payslip.base_salary)}</span>
              </li>
              {res && res.anciennete_amount > 0 && (
                <li className={fixedRow}>
                  <span className="text-foreground">Prime d'ancienneté ({Math.round(res.anciennete_rate * 100)} %)</span>
                  <span className="tabular-nums text-foreground">{fmt(res.anciennete_amount)}</span>
                </li>
              )}
              {gains.map(({ l, i }) => editableRow(l, i, false))}
              {absences.map(({ l, i }) => editableRow(l, i, true))}
              {res && (
                <li className="flex items-center justify-between gap-3 bg-emerald-500/10 px-4 py-3 sm:px-5">
                  <span className="text-sm font-bold uppercase tracking-wide text-foreground">Salaire brut</span>
                  <span className="text-base font-bold tabular-nums text-foreground">{fmt(res.brut_global)}</span>
                </li>
              )}
            </ul>
          </section>

          {/* Retenues: every row adds up to "Total retenues". */}
          <section className={`${panel} overflow-hidden`}>
            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
              <h2 className="font-semibold text-foreground">Retenues et cotisations</h2>
              {!locked && addButton('retenue')}
            </div>
            <div className={`${headCls} ${retGrid}`}><span>Libellé</span><span className="text-right">Montant</span><span /></div>
            <ul className="divide-y divide-border">
              {res && (<>
                <li className={fixedRow}><span className="text-muted-foreground">CNSS salarié ({pct(settings.cnss_rate_emp)} plafonné à {fmt(settings.cnss_cap)})</span><span className="tabular-nums text-foreground">{fmt(res.cnss_employee)}</span></li>
                <li className={fixedRow}><span className="text-muted-foreground">AMO salarié ({pct(settings.amo_rate_emp)})</span><span className="tabular-nums text-foreground">{fmt(res.amo_employee)}</span></li>
                {res.cimr_employee > 0 && <li className={fixedRow}><span className="text-muted-foreground">CIMR salarié ({pct(cimrRate / 100)})</span><span className="tabular-nums text-foreground">{fmt(res.cimr_employee)}</span></li>}
                <li className={fixedRow}><span className="text-muted-foreground">Impôt sur le revenu</span><span className="tabular-nums text-foreground">{fmt(res.ir_brut)}</span></li>
                {appliedReg !== 0 && (
                  <li className={fixedRow}>
                    <span className="text-muted-foreground">{regLabel}{appliedReg < 0 && ' (complément retenu)'}</span>
                    <span className="flex items-center gap-2">
                      {!locked && <button onClick={cancelRegularisation} className="text-xs font-semibold text-primary hover:underline">Annuler</button>}
                      <span className="tabular-nums text-foreground">{appliedReg > 0 ? '−' : ''}{fmt(Math.abs(appliedReg))}</span>
                    </span>
                  </li>
                )}
              </>)}
              {afterTax.map(({ l, i }) => (
                <li key={i} className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-4 py-3 sm:px-5 md:py-2 ${retGrid}`}>
                  <div className="col-span-2 flex flex-col gap-2 sm:flex-row md:col-span-1">
                    {rubSelect(l, i)}
                    <input className={`min-w-0 flex-1 ${inputCls}`} placeholder="Libellé…" aria-label="Libellé" value={l.label} onChange={e => updateLine(i, { label: e.target.value })} disabled={locked} />
                  </div>
                  <input type="number" min={0} step={0.01} aria-label="Montant" className={`w-full text-right tabular-nums ${inputCls}`} value={l.amount} onChange={e => updateLine(i, { amount: parseFloat(e.target.value) || 0 })} disabled={locked} />
                  <div className="flex justify-end">{removeButton(i)}</div>
                </li>
              ))}
              {res && (
                <li className="flex items-center justify-between gap-3 bg-red-500/10 px-4 py-3 sm:px-5">
                  <span className="text-sm font-bold uppercase tracking-wide text-foreground">Total retenues</span>
                  <span className="text-base font-bold tabular-nums text-red-700 dark:text-red-300">{fmt(res.total_deductions)}</span>
                </li>
              )}
            </ul>
          </section>

          {/* IR regularisation of the year: explicit, previewed, confirmed. */}
          {!locked && (
            <section className={`${panel} p-4 sm:p-5`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="font-semibold text-foreground">Régulariser l'IR de l'année</h2>
                  <p className="text-xs text-muted-foreground">Recalcule les bulletins validés de {payslip.period_year} avec les paramètres actuels et rend l'IR retenu en trop.</p>
                </div>
                <button onClick={previewRegularisation} disabled={busy} className={btnSecondary}><Scale className="h-4 w-4" /> Calculer</button>
              </div>
              {regul && res && (() => {
                const plan = planRegularisation(regul.owed, res.ir_brut);
                return (
                  <div className="mt-3 space-y-2 text-sm">
                    {regul.months.length === 0 ? <p className="text-muted-foreground">Aucun bulletin validé en {regul.year}.</p> : (
                      <ul className="divide-y divide-border rounded-lg border border-border">
                        {regul.months.map(m => (
                          <li key={m.id} className="flex justify-between gap-3 px-3 py-1.5 tabular-nums">
                            <span className="text-muted-foreground">{MONTHS[m.month - 1]} : retenu {fmt(m.withheld)}, dû {fmt(m.recomputed)}</span>
                            <span className="text-foreground">{fmt(m.diff)}</span>
                          </li>
                        ))}
                        {regul.alreadyApplied !== 0 && <li className="flex justify-between gap-3 px-3 py-1.5 tabular-nums"><span className="text-muted-foreground">Déjà régularisé</span><span>−{fmt(regul.alreadyApplied)}</span></li>}
                      </ul>
                    )}
                    {regul.owed > 0 && (
                      <>
                        <p className="text-foreground">IR retenu en trop : <b className="tabular-nums">{fmt(regul.owed)} MAD</b>. Rendu sur ce bulletin : <b className="tabular-nums">{fmt(plan.apply)} MAD</b>{plan.remainder > 0 && <> ; reste dû au salarié : <b className="tabular-nums">{fmt(plan.remainder)} MAD</b> (repris le mois suivant)</>}.</p>
                        <button onClick={() => applyRegularisation(false)} disabled={busy || plan.apply === 0} className={btnPrimary}><Check className="h-4 w-4" /> Appliquer {fmt(plan.apply)} MAD</button>
                      </>
                    )}
                    {regul.owed < 0 && (
                      <>
                        <Notice>IR retenu en moins sur l'année : {fmt(-regul.owed)} MAD. Rien n'est retenu sans votre accord.</Notice>
                        <button onClick={() => { if (confirm(`Retenir ${fmt(-regul.owed)} MAD d'IR en plus sur ce bulletin ?`)) applyRegularisation(true); }} disabled={busy} className={btnSecondary}>Retenir le complément de {fmt(-regul.owed)} MAD</button>
                      </>
                    )}
                    {regul.owed === 0 && <p className="text-muted-foreground">Rien à régulariser.</p>}
                  </div>
                );
              })()}
            </section>
          )}
        </div>

        {/* Totals and actions: stays in view while the lines scroll */}
        <aside className="space-y-4 lg:sticky lg:top-4" aria-label="Net à payer et actions">
          {res && (
            <section className={`${panel} p-5`}>
              <p className="text-sm font-semibold text-foreground">Salaire net à payer</p>
              <p className={`text-2xl font-bold tabular-nums tracking-tight ${res.net_salary < 0 ? 'text-red-700 dark:text-red-300' : 'text-emerald-700 dark:text-emerald-300'}`}>{fmt(res.net_salary)} MAD</p>
              <dl className="mt-3 space-y-2 border-t border-border pt-3 text-sm">
                <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Brut</dt><dd className="font-medium tabular-nums text-foreground">{fmt(res.brut_global)} MAD</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Retenues</dt><dd className="font-medium tabular-nums text-red-700 dark:text-red-300">{fmt(res.total_deductions)} MAD</dd></div>
              </dl>
              {!locked && <button onClick={save} className={`${btnPrimary} mt-4 hidden w-full md:flex`}><Check className="h-4 w-4" />Enregistrer</button>}
              {!locked && !payslip.run_id && <button onClick={validate} disabled={busy || !!netCheck.error} className={`${btnSoft} mt-2 w-full`}><Lock className="h-3.5 w-3.5" />Valider le bulletin</button>}
              {!locked && payslip.run_id && <p className="mt-2 text-xs text-muted-foreground">Validé avec son lot (Journée de paie).</p>}
            </section>
          )}

          {res && (
            <section className={`${panel} p-5 text-sm`} aria-label="Bases de calcul">
              <h2 className="mb-2 font-semibold text-foreground">Bases de calcul</h2>
              <dl className="space-y-1.5">
                <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Brut imposable IR</dt><dd className="tabular-nums text-foreground">{fmt(res.brut_imposable)}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Frais professionnels</dt><dd className="tabular-nums text-foreground">{fmt(res.frais_pro)}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Net imposable</dt><dd className="tabular-nums text-foreground">{fmt(res.net_imposable)}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Base CNSS{res.cnss_base > settings.cnss_cap && ` (plafonnée ${fmt(settings.cnss_cap)})`}</dt><dd className="tabular-nums text-foreground">{fmt(res.cnss_base)}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Base AMO</dt><dd className="tabular-nums text-foreground">{fmt(res.amo_base)}</dd></div>
                {cimrRate > 0 && <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Base CIMR</dt><dd className="tabular-nums text-foreground">{fmt(res.cimr_base)}</dd></div>}
              </dl>
            </section>
          )}

          {res && (
            <section className={`${panel} overflow-hidden`}>
              <button onClick={() => setShowEmployerCost(v => !v)} aria-expanded={showEmployerCost} className="flex w-full items-center justify-between gap-2 px-5 py-3 text-left text-sm hover:bg-secondary/40">
                <span><span className="block font-semibold text-foreground">Charges patronales</span><span className="block text-xs text-muted-foreground">coût employeur {fmt(res.employer_cost)} MAD</span></span>
                <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${showEmployerCost ? 'rotate-180' : ''}`} />
              </button>
              {showEmployerCost && (
                <dl className="space-y-1.5 border-t border-border px-5 py-3 text-sm">
                  <div className="flex justify-between gap-2"><dt className="text-muted-foreground">CNSS patronal ({pct(settings.cnss_rate_er)} plaf.)</dt><dd className="tabular-nums text-foreground">{fmt(res.cnss_employer)} MAD</dd></div>
                  <div className="flex justify-between gap-2"><dt className="text-muted-foreground">AMO patronal ({pct(settings.amo_rate_er)})</dt><dd className="tabular-nums text-foreground">{fmt(res.amo_employer)} MAD</dd></div>
                  <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Allocations familiales ({pct(settings.af_rate)})</dt><dd className="tabular-nums text-foreground">{fmt(res.alloc_familiales)} MAD</dd></div>
                  <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Taxe formation pro. ({pct(settings.tfp_rate)})</dt><dd className="tabular-nums text-foreground">{fmt(res.tfp_employer)} MAD</dd></div>
                  {res.cimr_employer > 0 && <div className="flex justify-between gap-2"><dt className="text-muted-foreground">CIMR patronal ({pct(cimrErRate / 100)})</dt><dd className="tabular-nums text-foreground">{fmt(res.cimr_employer)} MAD</dd></div>}
                  <div className="flex justify-between gap-2 border-t border-border pt-1.5 font-semibold"><dt className="text-foreground">Total charges patronales</dt><dd className="tabular-nums text-foreground">{fmt(res.charges_patronales)} MAD</dd></div>
                </dl>
              )}
            </section>
          )}

          <section className={`${panel} p-5`}>
            <label className={fieldLabel} htmlFor="ps-notes">Notes</label>
            <textarea id="ps-notes" className={`${textArea} resize-none`} rows={3} value={payslip.notes || ''} disabled={locked}
              onChange={e => { setPayslip(p => p ? { ...p, notes: e.target.value } : p); setDirty(true); }} />
          </section>
          {!locked && salaryChanged && (
            <button onClick={takeCurrentSalary} className={`${btnSecondary} w-full`}><RefreshCw className="h-4 w-4" />Reprendre le salaire actuel de l'employé</button>
          )}
        </aside>
      </div>

      {res && (
        <DocPhoneBar label="Net à payer" value={`${fmt(res.net_salary)} MAD`}>
          {saveButton || <button onClick={handleExportPdf} className={btnPrimary}><Download className="h-4 w-4" />PDF</button>}
        </DocPhoneBar>
      )}

      {showPrintPreview && previewBlob && (
        <PrintPreviewModal blob={previewBlob} filename={previewFilename} onClose={() => { setShowPrintPreview(false); setPreviewBlob(null); }} />
      )}
    </div>
  );
}
