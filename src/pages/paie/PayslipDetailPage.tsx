import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Download, Printer, Plus, Trash2, ChevronDown } from 'lucide-react';
import { Payslip, PayslipItem } from '../../types';
import { SupabasePayslipsService } from '../../utils/supabasePayslips';
import { CompanySettingsService } from '../../utils/companySettings';
import { RubriquesService, type Rubrique } from '../../utils/supabaseRubriques';
import { PayrollSettingsService } from '../../utils/supabasePayrollSettings';
import { exportPayslipToPdf, generatePayslipPdfBlob } from '../../utils/pdfExport';
import { computeAnciennete, computePayroll } from '../../utils/payrollCalc';
import { DEFAULT_PAYROLL_SETTINGS, type PayrollSettings } from '../../utils/payrollDefaults';
import { PrintPreviewModal } from '../../components/PrintPreviewModal';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';
import { useKeyboardSave, useAutoSave } from '../../hooks/useShortcuts';

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
        setLines(doc.items.map(it => ({ rubrique_id: null, code: null, label: it.label, type: it.item_type === 'earning' ? 'gain' : 'retenue', amount: it.amount, soumis_cnss: true, soumis_ir: true, soumis_cimr: false, inclus_anciennete: it.included_in_anciennete_base })));
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
    const retenues = lines.filter(l => l.type === 'retenue');
    const ancienneteBase = emp.base_salary + gains.filter(g => g.inclus_anciennete).reduce((s, g) => s + g.amount, 0);
    const anc = computeAnciennete(emp.hire_date, ancienneteBase);
    // "soumis" = enters brut imposable (CNSS+IR); exonéré if neither flag set.
    const primesSoumises = r2(gains.filter(g => g.soumis_cnss || g.soumis_ir).reduce((s, g) => s + g.amount, 0));
    const primesNon = r2(gains.filter(g => !g.soumis_cnss && !g.soumis_ir).reduce((s, g) => s + g.amount, 0));
    const autres = r2(retenues.reduce((s, r) => s + r.amount, 0));
    const res = computePayroll({ base_salary: emp.base_salary, anciennete_amount: anc.amount, primes_soumises: primesSoumises, primes_non_soumises: primesNon, autres_retenues: autres, cimr_rate: emp.cimr_rate ?? 0, dependents_count: emp.dependents_count ?? 0, settings });
    return { anc, res, otherEarnings: r2(primesSoumises + primesNon) };
  }, [payslip, lines, settings]);

  const save = useCallback(async () => {
    if (!payslip || !computed) return;
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

  useKeyboardSave(save, !!payslip && !isLoading);
  useAutoSave(save, !!payslip && !isLoading && dirty);

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
    await save();
    try {
      const settings2 = await getSettings();
      const items = lines.map((l, i) => ({ id: `v${i}`, label: l.label, item_type: l.type === 'gain' ? 'earning' : 'deduction', amount: l.amount, included_in_anciennete_base: l.inclus_anciennete, sort_order: i }));
      await exportPayslipToPdf({ ...payslip, ...computed.res, total_gross: computed.res.brut_global, items } as any, settings2);
    } catch (e) { showToast({ type: 'error', title: 'Erreur PDF', message: (e as any)?.message || String(e) }); }
  };

  const handlePreview = async () => {
    if (!payslip || !computed) return;
    await save();
    try {
      const settings2 = await getSettings();
      const items = lines.map((l, i) => ({ id: `v${i}`, label: l.label, item_type: l.type === 'gain' ? 'earning' : 'deduction', amount: l.amount, included_in_anciennete_base: l.inclus_anciennete, sort_order: i }));
      const { blob, filename } = await generatePayslipPdfBlob({ ...payslip, ...computed.res, total_gross: computed.res.brut_global, items } as any, settings2);
      setPreviewBlob(blob); setPreviewFilename(filename); setShowPrintPreview(true);
    } catch (e) { showToast({ type: 'error', title: 'Erreur aperçu', message: (e as any)?.message || String(e) }); }
  };

  if (!isPaie && !isSuperAdmin) return <div className="text-center py-12 text-muted-foreground">Accès réservé au rôle Paie.</div>;
  if (isLoading) return <div className="flex items-center justify-center min-h-[40vh]"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;
  if (!payslip) return <div className="text-center py-12 text-muted-foreground">Bulletin introuvable.</div>;

  const emp = payslip.employee;
  const res = computed?.res;
  const gains = lines.map((l, i) => ({ l, i })).filter(x => x.l.type === 'gain');
  const retenues = lines.map((l, i) => ({ l, i })).filter(x => x.l.type === 'retenue');
  const inputCls = 'text-xs px-2 py-1 border border-input rounded bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary';
  const locked = (payslip as any).is_locked;

  const RubSelect = ({ line, idx }: { line: Line; idx: number }) => (
    <select value={line.rubrique_id || ''} onChange={e => pickRubrique(idx, e.target.value)} className={`${inputCls} max-w-[150px]`} disabled={locked}>
      <option value="">Personnalisé…</option>
      {rubriques.filter(r => r.type === line.type).map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
    </select>
  );

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => navigate('/paie/bulletins')} className="p-1.5 hover:bg-accent rounded-lg"><ArrowLeft className="h-4 w-4 text-muted-foreground" /></button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold font-mono text-violet-600 dark:text-violet-400">{payslip.payslip_number}</h1>
          <p className="text-xs text-muted-foreground">{emp?.full_name} — {MONTHS[payslip.period_month - 1]} {payslip.period_year}{locked ? ' · verrouillé' : ''}</p>
        </div>
        {dirty && <span className="text-[10px] text-amber-500 font-medium">Non sauvegardé</span>}
        <button onClick={handleExportPdf} className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg"><Download className="h-3.5 w-3.5" /><span>PDF</span></button>
        <button onClick={handlePreview} className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-secondary hover:bg-accent border border-border text-foreground rounded-lg"><Printer className="h-3.5 w-3.5" /><span>Aperçu</span></button>
      </div>

      {emp && (
        <div className="glass rounded-lg p-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          <div><p className="text-[10px] text-muted-foreground mb-0.5">Poste</p><p className="font-medium text-foreground">{emp.position || '—'}</p></div>
          <div><p className="text-[10px] text-muted-foreground mb-0.5">Contrat</p><p className="font-medium text-foreground">{emp.contract_type}</p></div>
          <div><p className="text-[10px] text-muted-foreground mb-0.5">N° CNSS</p><p className="font-mono text-foreground">{emp.cnss_number || '—'}</p></div>
          <div><p className="text-[10px] text-muted-foreground mb-0.5">Heures travaillées</p>
            <input type="number" min={0} max={300} className={`w-24 ${inputCls}`} value={payslip.hours_worked} disabled={locked}
              onChange={e => { setPayslip(p => p ? { ...p, hours_worked: Number(e.target.value) } : p); setDirty(true); }} /></div>
        </div>
      )}

      {/* Rémunération */}
      <div className="glass rounded-lg overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Éléments de rémunération</h2>
          {!locked && <button onClick={() => addLine('gain')} className="flex items-center gap-1 text-xs text-primary hover:underline"><Plus className="h-3.5 w-3.5" /> Ajouter</button>}
        </div>
        <table className="w-full text-xs">
          <thead className="bg-secondary/30"><tr>
            <th className="px-4 py-2 text-left font-medium text-muted-foreground">Rubrique / libellé</th>
            <th className="px-3 py-2 text-center font-medium text-muted-foreground" title="Exonéré de CNSS et IR">Exonéré</th>
            <th className="px-3 py-2 text-center font-medium text-muted-foreground" title="Inclus dans la base ancienneté">Anc.</th>
            <th className="px-4 py-2 text-right font-medium text-muted-foreground">Montant</th>
            <th className="px-4 py-2 w-8" />
          </tr></thead>
          <tbody className="divide-y divide-border">
            <tr className="bg-secondary/10"><td className="px-4 py-2 text-foreground font-medium">Salaire de base</td><td className="px-3 py-2 text-center text-muted-foreground">—</td><td className="px-3 py-2 text-center text-muted-foreground">✓</td><td className="px-4 py-2 text-right font-mono font-semibold">{fmt(emp?.base_salary ?? 0)}</td><td /></tr>
            {computed && computed.anc.amount > 0 && (
              <tr className="bg-secondary/10"><td className="px-4 py-2 text-foreground">Prime d'ancienneté ({Math.round(computed.anc.rate * 100)}%)</td><td /><td /><td className="px-4 py-2 text-right font-mono">{fmt(computed.anc.amount)}</td><td /></tr>
            )}
            {gains.map(({ l, i }) => (
              <tr key={i} className="hover:bg-accent/10">
                <td className="px-4 py-1.5">
                  <div className="flex items-center gap-1.5">
                    <RubSelect line={l} idx={i} />
                    <input className={`flex-1 ${inputCls}`} placeholder="Libellé…" value={l.label} onChange={e => updateLine(i, { label: e.target.value })} disabled={locked} />
                  </div>
                </td>
                <td className="px-3 py-1.5 text-center"><input type="checkbox" checked={!l.soumis_cnss && !l.soumis_ir} onChange={e => updateLine(i, { soumis_cnss: !e.target.checked, soumis_ir: !e.target.checked })} className="w-3.5 h-3.5 accent-primary" disabled={locked} /></td>
                <td className="px-3 py-1.5 text-center"><input type="checkbox" checked={l.inclus_anciennete} onChange={e => updateLine(i, { inclus_anciennete: e.target.checked })} className="w-3.5 h-3.5 accent-primary" disabled={locked} /></td>
                <td className="px-4 py-1.5"><input type="number" min={0} step={0.01} className={`w-full text-right ${inputCls}`} value={l.amount} onChange={e => updateLine(i, { amount: parseFloat(e.target.value) || 0 })} disabled={locked} /></td>
                <td className="px-2 py-1.5">{!locked && <button onClick={() => removeLine(i)} className="p-1 rounded hover:bg-destructive/10"><Trash2 className="h-3.5 w-3.5 text-muted-foreground" /></button>}</td>
              </tr>
            ))}
            {res && <tr className="bg-emerald-500/8 border-t-2 border-emerald-500/20"><td className="px-4 py-2 font-bold text-foreground">SALAIRE BRUT</td><td /><td /><td className="px-4 py-2 text-right font-mono font-bold text-sm">{fmt(res.brut_global)}</td><td /></tr>}
          </tbody>
        </table>
      </div>

      {/* Retenues */}
      <div className="glass rounded-lg overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Retenues et cotisations</h2>
          {!locked && <button onClick={() => addLine('retenue')} className="flex items-center gap-1 text-xs text-primary hover:underline"><Plus className="h-3.5 w-3.5" /> Ajouter</button>}
        </div>
        <table className="w-full text-xs">
          <thead className="bg-secondary/30"><tr><th className="px-4 py-2 text-left font-medium text-muted-foreground">Libellé</th><th className="px-4 py-2 text-right font-medium text-muted-foreground">Montant</th><th className="px-4 py-2 w-8" /></tr></thead>
          <tbody className="divide-y divide-border">
            {res && (<>
              <tr className="bg-secondary/10"><td className="px-4 py-2 text-muted-foreground">CNSS salarié ({(settings.cnss_rate_emp * 100).toFixed(2)}% plaf.)</td><td className="px-4 py-2 text-right font-mono">{fmt(res.cnss_employee)}</td><td /></tr>
              <tr className="bg-secondary/10"><td className="px-4 py-2 text-muted-foreground">AMO salarié ({(settings.amo_rate_emp * 100).toFixed(2)}%)</td><td className="px-4 py-2 text-right font-mono">{fmt(res.amo_employee)}</td><td /></tr>
              {res.cimr_employee > 0 && <tr className="bg-secondary/10"><td className="px-4 py-2 text-muted-foreground">CIMR salarié</td><td className="px-4 py-2 text-right font-mono">{fmt(res.cimr_employee)}</td><td /></tr>}
              <tr className="bg-secondary/10"><td className="px-4 py-2 text-muted-foreground">Frais professionnels (déductible IR)</td><td className="px-4 py-2 text-right font-mono text-muted-foreground">({fmt(res.frais_pro)})</td><td /></tr>
              <tr className="bg-secondary/10"><td className="px-4 py-2 text-muted-foreground">Impôt sur le Revenu (net imposable {fmt(res.net_imposable)})</td><td className="px-4 py-2 text-right font-mono">{fmt(res.ir_amount)}</td><td /></tr>
            </>)}
            {retenues.map(({ l, i }) => (
              <tr key={i} className="hover:bg-accent/10">
                <td className="px-4 py-1.5"><div className="flex items-center gap-1.5"><RubSelect line={l} idx={i} /><input className={`flex-1 ${inputCls}`} placeholder="Libellé…" value={l.label} onChange={e => updateLine(i, { label: e.target.value })} disabled={locked} /></div></td>
                <td className="px-4 py-1.5"><input type="number" min={0} step={0.01} className={`w-full text-right ${inputCls}`} value={l.amount} onChange={e => updateLine(i, { amount: parseFloat(e.target.value) || 0 })} disabled={locked} /></td>
                <td className="px-2 py-1.5">{!locked && <button onClick={() => removeLine(i)} className="p-1 rounded hover:bg-destructive/10"><Trash2 className="h-3.5 w-3.5 text-muted-foreground" /></button>}</td>
              </tr>
            ))}
            {res && <tr className="bg-red-500/8 border-t-2 border-red-500/20"><td className="px-4 py-2 font-bold text-foreground">TOTAL RETENUES</td><td className="px-4 py-2 text-right font-mono font-bold text-red-600 dark:text-red-400 text-sm">{fmt(res.total_deductions)}</td><td /></tr>}
          </tbody>
        </table>
      </div>

      {res && (
        <div className="glass rounded-lg p-4 flex items-center justify-between">
          <div><p className="text-xs text-muted-foreground">Salaire net à payer</p><p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 font-mono">{fmt(res.net_salary)} MAD</p></div>
          <div className="text-right text-xs text-muted-foreground space-y-0.5">
            <p>Brut : <span className="font-semibold text-foreground">{fmt(res.brut_global)} MAD</span></p>
            <p>Retenues : <span className="font-semibold text-red-600 dark:text-red-400">{fmt(res.total_deductions)} MAD</span></p>
          </div>
        </div>
      )}

      {res && (
        <div className="glass rounded-lg overflow-hidden">
          <button onClick={() => setShowEmployerCost(v => !v)} className="w-full px-4 py-2.5 flex items-center justify-between text-sm text-muted-foreground hover:bg-accent/20 transition-colors">
            <span className="font-medium">Charges patronales · coût employeur {fmt(res.employer_cost)} MAD</span>
            <ChevronDown className={`h-4 w-4 transition-transform ${showEmployerCost ? 'rotate-180' : ''}`} />
          </button>
          {showEmployerCost && (
            <div className="border-t border-border px-4 py-3">
              <table className="w-full text-xs"><tbody>
                <tr><td className="py-1 text-muted-foreground">CNSS patronal</td><td className="py-1 text-right font-mono">{fmt(res.cnss_employer)} MAD</td></tr>
                <tr><td className="py-1 text-muted-foreground">AMO patronal</td><td className="py-1 text-right font-mono">{fmt(res.amo_employer)} MAD</td></tr>
                <tr><td className="py-1 text-muted-foreground">Allocations familiales</td><td className="py-1 text-right font-mono">{fmt(res.alloc_familiales)} MAD</td></tr>
                <tr><td className="py-1 text-muted-foreground">Taxe formation pro. (1,6 %)</td><td className="py-1 text-right font-mono">{fmt(res.tfp_employer)} MAD</td></tr>
                <tr className="border-t border-border"><td className="pt-1.5 font-semibold text-foreground">Total charges patronales</td><td className="pt-1.5 text-right font-mono font-bold">{fmt(res.charges_patronales)} MAD</td></tr>
              </tbody></table>
            </div>
          )}
        </div>
      )}

      <div className="glass rounded-lg p-4">
        <label className="block text-[11px] text-muted-foreground mb-1">Notes</label>
        <textarea className="w-full text-xs px-2.5 py-1.5 border border-input rounded-lg bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none" rows={2} value={payslip.notes || ''} disabled={locked}
          onChange={e => { setPayslip(p => p ? { ...p, notes: e.target.value } : p); setDirty(true); }} />
      </div>

      {!locked && <div className="flex justify-end"><button onClick={save} className="px-4 py-2 text-sm bg-primary hover:bg-primary/90 text-white rounded-lg">Enregistrer</button></div>}

      {showPrintPreview && previewBlob && (
        <PrintPreviewModal blob={previewBlob} filename={previewFilename} onClose={() => { setShowPrintPreview(false); setPreviewBlob(null); }} />
      )}
    </div>
  );
}
