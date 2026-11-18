import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Download, Printer, Plus, Trash2, ChevronDown, ChevronRight, Check, Lock } from 'lucide-react';
import { Payslip, PayslipItem } from '../../types';
import { SupabasePayslipsService } from '../../utils/supabasePayslips';
import { CompanySettingsService } from '../../utils/companySettings';
import { RubriquesService, type Rubrique } from '../../utils/supabaseRubriques';
import { PayrollSettingsService } from '../../utils/supabasePayrollSettings';
import { exportPayslipToPdf, generatePayslipPdfBlob } from '../../utils/pdfExport';
import { computeAnciennete, computePayroll, payslipLineTotals, periodEnd } from '../../utils/payrollCalc';
import { LOAN_LINE } from '../../utils/supabasePayrollRun';
import { DEFAULT_PAYROLL_SETTINGS, type PayrollSettings } from '../../utils/payrollDefaults';
import { PrintPreviewModal } from '../../components/PrintPreviewModal';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';
import { useKeyboardSave, useAutoSave } from '../../hooks/useShortcuts';
import { StatusPill } from '../../components/lists/StatusPill';
import { DocPhoneBar } from '../../components/documents/DocParts';
import { btnPrimary, btnSecondary, checkbox, fieldLabel, fieldSm, iconBtn, iconBtnDanger, LoadingState, panel, textArea } from '../../components/backoffice/BackOfficeUi';

function fmt(n: number) { return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2 }).format(n); }
const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

interface Line {
  rubrique_id: string | null; code: string | null; label: string;
  type: 'gain' | 'retenue'; amount: number;
  soumis_cnss: boolean; soumis_ir: boolean; soumis_cimr: boolean; inclus_anciennete: boolean;
}

export default function PayslipDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isSuperAdmin, isPaie, companyId: ctxCompanyId } = useAuth();
  const { showToast } = useToast();

  const [payslip, setPayslip] = useState<Payslip | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [rubriques, setRubriques] = useState<Rubrique[]>([]);
  const [settings, setSettings] = useState<PayrollSettings>(DEFAULT_PAYROLL_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);
  const [showPrintPreview, setShowPrintPreview] = useState(false);
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
  const [previewFilename, setPreviewFilename] = useState('');
  const [showEmployerCost, setShowEmployerCost] = useState(false);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setIsLoading(true);
    try {
      const doc = await SupabasePayslipsService.getById(id);
      if (!doc) throw new Error('Bulletin introuvable');
      setPayslip(doc);
      const [vars, rubs, s] = await Promise.all([
        SupabasePayslipsService.getVariables(id),
        RubriquesService.list().catch(() => []),
        PayrollSettingsService.get(doc.period_year).catch(() => DEFAULT_PAYROLL_SETTINGS),
      ]);
      setRubriques(rubs); setSettings(s);
      if (vars.length > 0) {
        setLines(vars.map((v: any) => ({ rubrique_id: v.rubrique_id, code: v.code, label: v.label, type: v.type, amount: Number(v.amount), soumis_cnss: v.soumis_cnss, soumis_ir: v.soumis_ir, soumis_cimr: v.soumis_cimr, inclus_anciennete: v.inclus_anciennete })));
      } else {
        // migrate legacy free-text items → variables (soumis by default)
        // Legacy deductions were always taken after tax: keep them that way.
        const legacy: Line[] = doc.items.map(it => {
          const gain = it.item_type === 'earning';
          return { rubrique_id: null, code: null, label: it.label, type: gain ? 'gain' : 'retenue', amount: it.amount, soumis_cnss: gain, soumis_ir: gain, soumis_cimr: false, inclus_anciennete: it.included_in_anciennete_base };
        });
        // Older run payslips held the loan repayment only in other_deductions:
        // show it as a line so a save does not drop it.
        const listed = legacy.filter(l => l.type === 'retenue').reduce((s, l) => s + l.amount, 0);
        const missing = r2(doc.other_deductions - listed);
        if (missing > 0) legacy.push({ rubrique_id: null, code: LOAN_LINE.code, label: LOAN_LINE.label, type: 'retenue', amount: missing, soumis_cnss: false, soumis_ir: false, soumis_cimr: false, inclus_anciennete: false });
        setLines(legacy);
      }
    } catch (e) {
      showToast({ type: 'error', title: 'Erreur', message: (e as any)?.message || String(e) });
    } finally { setIsLoading(false); }
  }, [id, showToast]);

  useEffect(() => { load(); }, [load]);

  const computed = useMemo(() => {
    if (!payslip?.employee) return null;
    const emp = payslip.employee;
    const gains = lines.filter(l => l.type === 'gain');
    const ancienneteBase = emp.base_salary + gains.filter(g => g.inclus_anciennete).reduce((s, g) => s + g.amount, 0);
    // Seniority as at the end of the pay month, not today.
    const anc = computeAnciennete(emp.hire_date, ancienneteBase, periodEnd(payslip.period_month, payslip.period_year));
    // "soumis" lines enter brut imposable (CNSS+IR), retenues negatively; the rest is exonéré / after tax.
    const t = payslipLineTotals(lines);
    const res = computePayroll({ base_salary: emp.base_salary, anciennete_amount: anc.amount, primes_soumises: t.primesSoumises, primes_non_soumises: t.primesNon, autres_retenues: t.autres, cimr_rate: emp.cimr_rate ?? 0, dependents_count: emp.dependents_count ?? 0, settings });
    return { anc, res, otherEarnings: t.gains };
  }, [payslip, lines, settings]);

  const locked = payslip?.is_locked === true;

  const save = useCallback(async () => {
    // A validated payslip is final: its cumuls, loan repayments and entries are booked.
    if (!payslip || !computed || payslip.is_locked) return;
    const { anc, res, otherEarnings } = computed;
    const companyId = payslip.company_id || ctxCompanyId || null;
    try {
      await Promise.all([
        SupabasePayslipsService.update(payslip.id, {
          hours_worked: payslip.hours_worked, period_month: payslip.period_month, period_year: payslip.period_year, notes: payslip.notes,
          anciennete_rate: anc.rate, anciennete_amount: anc.amount, other_earnings: otherEarnings, total_gross: res.brut_global,
          cnss_employee: res.cnss_employee, amo_employee: res.amo_employee, cimr_employee: res.cimr_employee,
          frais_pro: res.frais_pro, ir_amount: res.ir_amount, other_deductions: res.autres_retenues,
          total_deductions: res.total_deductions, net_salary: res.net_salary,
          cnss_employer: res.cnss_employer, amo_employer: res.amo_employer, alloc_familiales: res.alloc_familiales,
          tfp_employer: res.tfp_employer,
        } as any),
        SupabasePayslipsService.replaceVariables(payslip.id, companyId, lines),
        // keep payslip_items in sync for the PDF renderer
        SupabasePayslipsService.upsertItems(payslip.id, lines.map((l, i) => ({ label: l.label, item_type: l.type === 'gain' ? 'earning' : 'deduction', amount: l.amount, included_in_anciennete_base: l.inclus_anciennete, sort_order: i } as Omit<PayslipItem, 'id' | 'payslip_id'>))),
      ]);
      setDirty(false);
    } catch (e) {
      showToast({ type: 'error', title: 'Erreur sauvegarde', message: (e as any)?.message || String(e) });
    }
  }, [payslip, computed, lines, ctxCompanyId, showToast]);

  useKeyboardSave(save, !!payslip && !isLoading && !locked);
  useAutoSave(save, !!payslip && !isLoading && dirty && !locked);

  // What the PDF shows: the stored figures of a locked payslip, else the live calculation.
  const pdfPayslip = () => {
    if (!payslip || !computed) return null;
    const items = lines.map((l, i) => ({ id: `v${i}`, label: l.label, item_type: l.type === 'gain' ? 'earning' : 'deduction', amount: l.amount, included_in_anciennete_base: l.inclus_anciennete, sort_order: i }));
    if (locked) return { ...payslip, items } as any;
    return { ...payslip, ...computed.res, total_gross: computed.res.brut_global, items } as any;
  };

  const addLine = (type: 'gain' | 'retenue') => {
    setLines(prev => [...prev, { rubrique_id: null, code: null, label: '', type, amount: 0, soumis_cnss: type === 'gain', soumis_ir: type === 'gain', soumis_cimr: false, inclus_anciennete: false }]);
    setDirty(true);
  };
  const removeLine = (idx: number) => { setLines(prev => prev.filter((_, i) => i !== idx)); setDirty(true); };
  const updateLine = (idx: number, patch: Partial<Line>) => { setLines(prev => prev.map((l, i) => i === idx ? { ...l, ...patch } : l)); setDirty(true); };
  const pickRubrique = (idx: number, rubId: string) => {
    const r = rubriques.find(x => x.id === rubId);
    if (!r) { updateLine(idx, { rubrique_id: null, code: null }); return; }
    updateLine(idx, { rubrique_id: r.id, code: r.code, label: r.label, soumis_cnss: r.soumis_cnss, soumis_ir: r.soumis_ir, soumis_cimr: r.soumis_cimr, inclus_anciennete: r.inclus_anciennete });
  };

  const getSettings = async () => {
    if (!payslip) return null;
    const compId = payslip.company_id || ctxCompanyId;
    if (!compId) return null;
    try { return await CompanySettingsService.getSettings(compId); } catch { return null; }
  };

  const handleExportPdf = async () => {
    if (!payslip || !computed) return;
    if (dirty) await save();
    try {
      const settings2 = await getSettings();
      await exportPayslipToPdf(pdfPayslip(), settings2);
    } catch (e) { showToast({ type: 'error', title: 'Erreur PDF', message: (e as any)?.message || String(e) }); }
  };

  const handlePreview = async () => {
    if (!payslip || !computed) return;
    if (dirty) await save();
    try {
      const settings2 = await getSettings();
      const { blob, filename } = await generatePayslipPdfBlob(pdfPayslip(), settings2);
      setPreviewBlob(blob); setPreviewFilename(filename); setShowPrintPreview(true);
    } catch (e) { showToast({ type: 'error', title: 'Erreur aperçu', message: (e as any)?.message || String(e) }); }
  };

  if (!isPaie && !isSuperAdmin) return <div className="py-12 text-center text-muted-foreground">Accès réservé au rôle Paie.</div>;
  if (isLoading) return <LoadingState />;
  if (!payslip) return <div className="py-12 text-center text-muted-foreground">Bulletin introuvable.</div>;

  const emp = payslip.employee;
  const res = computed?.res;
  const gains = lines.map((l, i) => ({ l, i })).filter(x => x.l.type === 'gain');
  const retenues = lines.map((l, i) => ({ l, i })).filter(x => x.l.type === 'retenue');
  const inputCls = fieldSm;

  const RubSelect = ({ line, idx }: { line: Line; idx: number }) => (
    <select value={line.rubrique_id || ''} onChange={e => pickRubrique(idx, e.target.value)} className={`${inputCls} sm:max-w-[12rem]`} disabled={locked} aria-label="Rubrique">
      <option value="">Personnalisé…</option>
      {rubriques.filter(r => r.type === line.type).map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
    </select>
  );

  const gainGrid = 'md:grid-cols-[minmax(0,1fr)_5.5rem_4.5rem_9rem_2.75rem]';
  const retGrid = 'md:grid-cols-[minmax(0,1fr)_9rem_2.75rem]';
  const headCls = 'hidden gap-2 border-b border-border bg-secondary/40 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:px-5 md:grid';
  const fixedRow = 'flex items-center justify-between gap-3 bg-secondary/20 px-4 py-2.5 text-sm sm:px-5';
  const addButton = (type: 'gain' | 'retenue') => (
    <button onClick={() => addLine(type)} className="inline-flex min-h-9 items-center gap-1 rounded-md px-2 text-sm font-semibold text-primary hover:bg-primary/10"><Plus className="h-4 w-4" /> Ajouter</button>
  );
  const removeButton = (i: number) => !locked && (
    <button onClick={() => removeLine(i)} aria-label="Supprimer la ligne" title="Supprimer la ligne" className={iconBtnDanger}><Trash2 className="h-4 w-4" /></button>
  );
  const saveButton = !locked && <button onClick={save} className={btnPrimary}><Check className="h-4 w-4" />Enregistrer</button>;

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

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-4">
          {emp && (
            <section className={`${panel} grid grid-cols-2 gap-4 p-4 sm:p-5 md:grid-cols-4`} aria-label="Salarié">
              <div><p className="text-xs text-muted-foreground">Poste</p><p className="mt-0.5 text-sm font-medium text-foreground">{emp.position || '—'}</p></div>
              <div><p className="text-xs text-muted-foreground">Contrat</p><p className="mt-0.5 text-sm font-medium text-foreground">{emp.contract_type}</p></div>
              <div><p className="text-xs text-muted-foreground">N° CNSS</p><p className="mt-0.5 font-mono text-sm text-foreground">{emp.cnss_number || '—'}</p></div>
              <div><label className="text-xs text-muted-foreground" htmlFor="ps-hours">Heures travaillées</label>
                <input id="ps-hours" type="number" min={0} max={300} className={`mt-0.5 w-28 ${inputCls} tabular-nums`} value={payslip.hours_worked} disabled={locked}
                  onChange={e => { setPayslip(p => p ? { ...p, hours_worked: Number(e.target.value) } : p); setDirty(true); }} /></div>
            </section>
          )}

          {/* Rémunération */}
          <section className={`${panel} overflow-hidden`}>
            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
              <h2 className="font-semibold text-foreground">Éléments de rémunération</h2>
              {!locked && addButton('gain')}
            </div>
            <div className={`${headCls} ${gainGrid}`}>
              <span>Rubrique / libellé</span>
              <span className="text-center" title="Exonéré de CNSS et IR">Exonéré</span>
              <span className="text-center" title="Inclus dans la base ancienneté">Anc.</span>
              <span className="text-right">Montant</span>
              <span />
            </div>
            <ul className="divide-y divide-border">
              <li className={fixedRow}>
                <span className="font-medium text-foreground">Salaire de base</span>
                <span className="flex items-center gap-3"><span className="hidden text-xs text-muted-foreground sm:inline">base ancienneté</span><span className="font-semibold tabular-nums text-foreground">{fmt(emp?.base_salary ?? 0)}</span></span>
              </li>
              {computed && computed.anc.amount > 0 && (
                <li className={fixedRow}>
                  <span className="text-foreground">Prime d'ancienneté ({Math.round(computed.anc.rate * 100)}%)</span>
                  <span className="tabular-nums text-foreground">{fmt(computed.anc.amount)}</span>
                </li>
              )}
              {gains.map(({ l, i }) => (
                <li key={i} className={`grid grid-cols-2 items-center gap-2 px-4 py-3 sm:px-5 md:py-2 ${gainGrid}`}>
                  <div className="col-span-2 flex flex-col gap-2 sm:flex-row md:col-span-1">
                    <RubSelect line={l} idx={i} />
                    <input className={`min-w-0 flex-1 ${inputCls}`} placeholder="Libellé…" aria-label="Libellé" value={l.label} onChange={e => updateLine(i, { label: e.target.value })} disabled={locked} />
                  </div>
                  <label className="flex items-center gap-2 md:justify-center">
                    <input type="checkbox" checked={!l.soumis_cnss && !l.soumis_ir} onChange={e => updateLine(i, { soumis_cnss: !e.target.checked, soumis_ir: !e.target.checked })} className={checkbox} disabled={locked} />
                    <span className="text-xs text-muted-foreground md:sr-only">Exonéré</span>
                  </label>
                  <label className="flex items-center gap-2 md:justify-center">
                    <input type="checkbox" checked={l.inclus_anciennete} onChange={e => updateLine(i, { inclus_anciennete: e.target.checked })} className={checkbox} disabled={locked} />
                    <span className="text-xs text-muted-foreground md:sr-only">Base ancienneté</span>
                  </label>
                  <input type="number" min={0} step={0.01} aria-label="Montant" className={`w-full text-right tabular-nums ${inputCls}`} value={l.amount} onChange={e => updateLine(i, { amount: parseFloat(e.target.value) || 0 })} disabled={locked} />
                  <div className="flex justify-end">{removeButton(i)}</div>
                </li>
              ))}
              {res && (
                <li className="flex items-center justify-between gap-3 bg-emerald-500/10 px-4 py-3 sm:px-5">
                  <span className="text-sm font-bold uppercase tracking-wide text-foreground">Salaire brut</span>
                  <span className="text-base font-bold tabular-nums text-foreground">{fmt(res.brut_global)}</span>
                </li>
              )}
            </ul>
          </section>

          {/* Retenues */}
          <section className={`${panel} overflow-hidden`}>
            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
              <h2 className="font-semibold text-foreground">Retenues et cotisations</h2>
              {!locked && addButton('retenue')}
            </div>
            <div className={`${headCls} ${retGrid}`}><span>Libellé</span><span className="text-right">Montant</span><span /></div>
            <ul className="divide-y divide-border">
              {res && (<>
                <li className={fixedRow}><span className="text-muted-foreground">CNSS salarié ({(settings.cnss_rate_emp * 100).toFixed(2)}% plaf.)</span><span className="tabular-nums text-foreground">{fmt(res.cnss_employee)}</span></li>
                <li className={fixedRow}><span className="text-muted-foreground">AMO salarié ({(settings.amo_rate_emp * 100).toFixed(2)}%)</span><span className="tabular-nums text-foreground">{fmt(res.amo_employee)}</span></li>
                {res.cimr_employee > 0 && <li className={fixedRow}><span className="text-muted-foreground">CIMR salarié</span><span className="tabular-nums text-foreground">{fmt(res.cimr_employee)}</span></li>}
                <li className={fixedRow}><span className="text-muted-foreground">Frais professionnels (déductible IR)</span><span className="tabular-nums text-muted-foreground">({fmt(res.frais_pro)})</span></li>
                <li className={fixedRow}><span className="text-muted-foreground">Impôt sur le Revenu (net imposable {fmt(res.net_imposable)})</span><span className="tabular-nums text-foreground">{fmt(res.ir_amount)}</span></li>
              </>)}
              {retenues.map(({ l, i }) => (
                <li key={i} className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-4 py-3 sm:px-5 md:py-2 ${retGrid}`}>
                  <div className="col-span-2 flex flex-col gap-2 sm:flex-row md:col-span-1">
                    <RubSelect line={l} idx={i} />
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
        </div>

        {/* Totals and actions: stays in view while the lines scroll */}
        <aside className="space-y-4 lg:sticky lg:top-4" aria-label="Net à payer et actions">
          {res && (
            <section className={`${panel} p-5`}>
              <p className="text-sm font-semibold text-foreground">Salaire net à payer</p>
              <p className="text-2xl font-bold tabular-nums tracking-tight text-emerald-700 dark:text-emerald-300">{fmt(res.net_salary)} MAD</p>
              <dl className="mt-3 space-y-2 border-t border-border pt-3 text-sm">
                <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Brut</dt><dd className="font-medium tabular-nums text-foreground">{fmt(res.brut_global)} MAD</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Retenues</dt><dd className="font-medium tabular-nums text-red-700 dark:text-red-300">{fmt(res.total_deductions)} MAD</dd></div>
              </dl>
              {!locked && <button onClick={save} className={`${btnPrimary} mt-4 hidden w-full md:flex`}><Check className="h-4 w-4" />Enregistrer</button>}
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
                  <div className="flex justify-between gap-2"><dt className="text-muted-foreground">CNSS patronal</dt><dd className="tabular-nums text-foreground">{fmt(res.cnss_employer)} MAD</dd></div>
                  <div className="flex justify-between gap-2"><dt className="text-muted-foreground">AMO patronal</dt><dd className="tabular-nums text-foreground">{fmt(res.amo_employer)} MAD</dd></div>
                  <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Allocations familiales</dt><dd className="tabular-nums text-foreground">{fmt(res.alloc_familiales)} MAD</dd></div>
                  <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Taxe formation pro. (1,6 %)</dt><dd className="tabular-nums text-foreground">{fmt(res.tfp_employer)} MAD</dd></div>
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
