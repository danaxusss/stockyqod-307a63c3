import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Download, Printer, Plus, Trash2, ChevronDown } from 'lucide-react';
import { Payslip, PayslipItem, Employee } from '../../types';
import { SupabasePayslipsService } from '../../utils/supabasePayslips';
import { SupabaseEmployeesService } from '../../utils/supabaseEmployees';
import { CompanySettingsService } from '../../utils/companySettings';
import { exportPayslipToPdf, generatePayslipPdfBlob } from '../../utils/pdfExport';
import { buildPayslipTotals } from '../../utils/payrollCalc';
import { PrintPreviewModal } from '../../components/PrintPreviewModal';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';
import { useKeyboardSave, useAutoSave } from '../../hooks/useShortcuts';

function fmt(n: number) {
  return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2 }).format(n);
}

const MONTHS = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];

const currentYear = new Date().getFullYear();
const YEARS = Array.from({ length: 5 }, (_, i) => currentYear - i);

export default function PayslipDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isSuperAdmin, isPaie, companyId: ctxCompanyId } = useAuth();
  const { showToast } = useToast();

  const [payslip, setPayslip] = useState<Payslip | null>(null);
  const [items, setItems] = useState<Omit<PayslipItem, 'id' | 'payslip_id'>[]>([]);
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
      setItems(doc.items.map(i => ({
        label: i.label,
        item_type: i.item_type,
        amount: i.amount,
        included_in_anciennete_base: i.included_in_anciennete_base,
        sort_order: i.sort_order,
      })));
    } catch (e) {
      showToast({ type: 'error', title: 'Erreur', message: (e as any)?.message || String(e) });
    } finally {
      setIsLoading(false);
    }
  }, [id, showToast]);

  useEffect(() => { load(); }, [load]);

  // Recompute totals whenever items or payslip employee change
  const computed = payslip?.employee
    ? buildPayslipTotals(payslip.employee as Employee, items as PayslipItem[])
    : null;

  const save = useCallback(async () => {
    if (!payslip || !computed) return;
    try {
      await Promise.all([
        SupabasePayslipsService.update(payslip.id, {
          hours_worked: payslip.hours_worked,
          period_month: payslip.period_month,
          period_year: payslip.period_year,
          notes: payslip.notes,
          ...computed,
        }),
        SupabasePayslipsService.upsertItems(payslip.id, items as Omit<PayslipItem, 'id' | 'payslip_id'>[]),
      ]);
      setDirty(false);
    } catch (e) {
      showToast({ type: 'error', title: 'Erreur sauvegarde', message: (e as any)?.message || String(e) });
    }
  }, [payslip, computed, items, showToast]);

  useKeyboardSave(save, !!payslip && !isLoading);
  useAutoSave(save, !!payslip && !isLoading && dirty);

  const addItem = (type: 'earning' | 'deduction') => {
    setItems(prev => [...prev, { label: '', item_type: type, amount: 0, included_in_anciennete_base: false, sort_order: prev.length }]);
    setDirty(true);
  };

  const removeItem = (idx: number) => {
    setItems(prev => prev.filter((_, i) => i !== idx));
    setDirty(true);
  };

  const updateItem = (idx: number, field: keyof typeof items[0], value: unknown) => {
    setItems(prev => prev.map((item, i) => i === idx ? { ...item, [field]: value } : item));
    setDirty(true);
  };

  const getSettings = async () => {
    if (!payslip) return null;
    const compId = payslip.company_id || ctxCompanyId;
    if (!compId) return null;
    try { return await CompanySettingsService.getSettings(compId); } catch { return null; }
  };

  const handleExportPdf = async () => {
    if (!payslip || !computed) return;
    await save(); // persist first
    try {
      const settings = await getSettings();
      const mergedPayslip = { ...payslip, ...computed, items };
      await exportPayslipToPdf(mergedPayslip, settings);
    } catch (e) {
      showToast({ type: 'error', title: 'Erreur PDF', message: (e as any)?.message || String(e) });
    }
  };

  const handlePreview = async () => {
    if (!payslip || !computed) return;
    await save();
    try {
      const settings = await getSettings();
      const mergedPayslip = { ...payslip, ...computed, items };
      const { blob, filename } = await generatePayslipPdfBlob(mergedPayslip, settings);
      setPreviewBlob(blob);
      setPreviewFilename(filename);
      setShowPrintPreview(true);
    } catch (e) {
      showToast({ type: 'error', title: 'Erreur aperçu', message: (e as any)?.message || String(e) });
    }
  };

  if (!isPaie && !isSuperAdmin) return <div className="text-center py-12 text-muted-foreground">Accès réservé au rôle Paie.</div>;
  if (isLoading) return <div className="flex items-center justify-center min-h-[40vh]"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;
  if (!payslip) return <div className="text-center py-12 text-muted-foreground">Bulletin introuvable.</div>;

  const emp = payslip.employee;
  const earningItems = items.filter(i => i.item_type === 'earning');
  const deductionItems = items.filter(i => i.item_type === 'deduction');

  const inputCls = 'text-xs px-2 py-1 border border-input rounded bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary';

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      {/* Header toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => navigate('/paie/bulletins')} className="p-1.5 hover:bg-accent rounded-lg">
          <ArrowLeft className="h-4 w-4 text-muted-foreground" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold font-mono text-violet-600 dark:text-violet-400">{payslip.payslip_number}</h1>
          <p className="text-xs text-muted-foreground">{emp?.full_name} — {MONTHS[payslip.period_month - 1]} {payslip.period_year}</p>
        </div>
        {dirty && <span className="text-[10px] text-amber-500 font-medium">Non sauvegardé</span>}
        <button onClick={handleExportPdf} className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg">
          <Download className="h-3.5 w-3.5" /><span>PDF</span>
        </button>
        <button onClick={handlePreview} className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-secondary hover:bg-accent border border-border text-foreground rounded-lg">
          <Printer className="h-3.5 w-3.5" /><span>Aperçu</span>
        </button>
      </div>

      {/* Employee info */}
      {emp && (
        <div className="glass rounded-lg p-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          <div><p className="text-[10px] text-muted-foreground mb-0.5">Poste</p><p className="font-medium text-foreground">{emp.position || '—'}</p></div>
          <div><p className="text-[10px] text-muted-foreground mb-0.5">Contrat</p><p className="font-medium text-foreground">{emp.contract_type}</p></div>
          <div><p className="text-[10px] text-muted-foreground mb-0.5">N° CNSS</p><p className="font-mono text-foreground">{emp.cnss_number || '—'}</p></div>
          <div>
            <p className="text-[10px] text-muted-foreground mb-0.5">Heures travaillées</p>
            <input
              type="number" min={0} max={300}
              className={`w-24 ${inputCls}`}
              value={payslip.hours_worked}
              onChange={e => { setPayslip(p => p ? { ...p, hours_worked: Number(e.target.value) } : p); setDirty(true); }}
            />
          </div>
        </div>
      )}

      {/* Earnings */}
      <div className="glass rounded-lg overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Éléments de rémunération</h2>
          <button onClick={() => addItem('earning')} className="flex items-center gap-1 text-xs text-primary hover:underline">
            <Plus className="h-3.5 w-3.5" /> Ajouter
          </button>
        </div>
        <table className="w-full text-xs">
          <thead className="bg-secondary/30">
            <tr>
              <th className="px-4 py-2 text-left font-medium text-muted-foreground">Libellé</th>
              <th className="px-4 py-2 text-center font-medium text-muted-foreground" title="Inclure dans la base ancienneté">Base anc.</th>
              <th className="px-4 py-2 text-right font-medium text-muted-foreground">Montant (MAD)</th>
              <th className="px-4 py-2 w-8" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {/* Base salary — read-only */}
            <tr className="bg-secondary/10">
              <td className="px-4 py-2 text-foreground font-medium">Salaire de base</td>
              <td className="px-4 py-2 text-center text-muted-foreground">✓</td>
              <td className="px-4 py-2 text-right font-mono font-semibold text-foreground">{fmt(payslip.employee?.base_salary ?? 0)}</td>
              <td />
            </tr>
            {/* Prime d'ancienneté — computed */}
            {computed && computed.anciennete_amount > 0 && (
              <tr className="bg-secondary/10">
                <td className="px-4 py-2 text-foreground">Prime d'ancienneté ({Math.round(computed.anciennete_rate * 100)}%)</td>
                <td className="px-4 py-2 text-center text-muted-foreground">—</td>
                <td className="px-4 py-2 text-right font-mono text-foreground">{fmt(computed.anciennete_amount)}</td>
                <td />
              </tr>
            )}
            {/* Manual earning items */}
            {earningItems.map((item, idx) => {
              const globalIdx = items.indexOf(item);
              return (
                <tr key={idx} className="hover:bg-accent/10">
                  <td className="px-4 py-1.5">
                    <input className={`w-full ${inputCls}`} placeholder="Libellé…" value={item.label} onChange={e => updateItem(globalIdx, 'label', e.target.value)} />
                  </td>
                  <td className="px-4 py-1.5 text-center">
                    <input type="checkbox" checked={item.included_in_anciennete_base} onChange={e => updateItem(globalIdx, 'included_in_anciennete_base', e.target.checked)} className="w-3.5 h-3.5 accent-primary" />
                  </td>
                  <td className="px-4 py-1.5">
                    <input type="number" min={0} step={0.01} className={`w-full text-right ${inputCls}`} value={item.amount} onChange={e => updateItem(globalIdx, 'amount', parseFloat(e.target.value) || 0)} />
                  </td>
                  <td className="px-2 py-1.5">
                    <button onClick={() => removeItem(globalIdx)} className="p-1 rounded hover:bg-destructive/10">
                      <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                  </td>
                </tr>
              );
            })}
            {/* Gross total */}
            {computed && (
              <tr className="bg-emerald-500/8 border-t-2 border-emerald-500/20">
                <td className="px-4 py-2 font-bold text-foreground">SALAIRE BRUT</td>
                <td />
                <td className="px-4 py-2 text-right font-mono font-bold text-foreground text-sm">{fmt(computed.total_gross)}</td>
                <td />
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Deductions */}
      <div className="glass rounded-lg overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Retenues et cotisations</h2>
          <button onClick={() => addItem('deduction')} className="flex items-center gap-1 text-xs text-primary hover:underline">
            <Plus className="h-3.5 w-3.5" /> Ajouter
          </button>
        </div>
        <table className="w-full text-xs">
          <thead className="bg-secondary/30">
            <tr>
              <th className="px-4 py-2 text-left font-medium text-muted-foreground">Libellé</th>
              <th className="px-4 py-2 text-right font-medium text-muted-foreground">Montant (MAD)</th>
              <th className="px-4 py-2 w-8" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {/* Statutory deductions — read-only computed */}
            {computed && (
              <>
                <tr className="bg-secondary/10">
                  <td className="px-4 py-2 text-muted-foreground">CNSS salarié (4,48% — plafonné 268,80 MAD)</td>
                  <td className="px-4 py-2 text-right font-mono text-foreground">{fmt(computed.cnss_employee)}</td>
                  <td />
                </tr>
                <tr className="bg-secondary/10">
                  <td className="px-4 py-2 text-muted-foreground">AMO salarié (2,26%)</td>
                  <td className="px-4 py-2 text-right font-mono text-foreground">{fmt(computed.amo_employee)}</td>
                  <td />
                </tr>
                {computed.cimr_employee > 0 && (
                  <tr className="bg-secondary/10">
                    <td className="px-4 py-2 text-muted-foreground">CIMR salarié</td>
                    <td className="px-4 py-2 text-right font-mono text-foreground">{fmt(computed.cimr_employee)}</td>
                    <td />
                  </tr>
                )}
                <tr className="bg-secondary/10">
                  <td className="px-4 py-2 text-muted-foreground">Frais professionnels (20% — déductible IR)</td>
                  <td className="px-4 py-2 text-right font-mono text-muted-foreground">({fmt(computed.frais_pro)})</td>
                  <td />
                </tr>
                <tr className="bg-secondary/10">
                  <td className="px-4 py-2 text-muted-foreground">Impôt sur le Revenu (IR — barème progressif 2026)</td>
                  <td className="px-4 py-2 text-right font-mono text-foreground">{fmt(computed.ir_amount)}</td>
                  <td />
                </tr>
              </>
            )}
            {/* Manual deduction items */}
            {deductionItems.map((item, idx) => {
              const globalIdx = items.indexOf(item);
              return (
                <tr key={idx} className="hover:bg-accent/10">
                  <td className="px-4 py-1.5">
                    <input className={`w-full ${inputCls}`} placeholder="Libellé…" value={item.label} onChange={e => updateItem(globalIdx, 'label', e.target.value)} />
                  </td>
                  <td className="px-4 py-1.5">
                    <input type="number" min={0} step={0.01} className={`w-full text-right ${inputCls}`} value={item.amount} onChange={e => updateItem(globalIdx, 'amount', parseFloat(e.target.value) || 0)} />
                  </td>
                  <td className="px-2 py-1.5">
                    <button onClick={() => removeItem(globalIdx)} className="p-1 rounded hover:bg-destructive/10">
                      <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                  </td>
                </tr>
              );
            })}
            {/* Total deductions */}
            {computed && (
              <tr className="bg-red-500/8 border-t-2 border-red-500/20">
                <td className="px-4 py-2 font-bold text-foreground">TOTAL RETENUES</td>
                <td className="px-4 py-2 text-right font-mono font-bold text-red-600 dark:text-red-400 text-sm">{fmt(computed.total_deductions)}</td>
                <td />
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Net salary summary */}
      {computed && (
        <div className="glass rounded-lg p-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground">Salaire net à payer</p>
            <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 font-mono">{fmt(computed.net_salary)} MAD</p>
          </div>
          <div className="text-right text-xs text-muted-foreground space-y-0.5">
            <p>Brut : <span className="font-semibold text-foreground">{fmt(computed.total_gross)} MAD</span></p>
            <p>Retenues : <span className="font-semibold text-red-600 dark:text-red-400">{fmt(computed.total_deductions)} MAD</span></p>
          </div>
        </div>
      )}

      {/* Employer cost (collapsible) */}
      {computed && (
        <div className="glass rounded-lg overflow-hidden">
          <button
            onClick={() => setShowEmployerCost(v => !v)}
            className="w-full px-4 py-2.5 flex items-center justify-between text-sm text-muted-foreground hover:bg-accent/20 transition-colors"
          >
            <span className="font-medium">Charges patronales (informatif)</span>
            <ChevronDown className={`h-4 w-4 transition-transform ${showEmployerCost ? 'rotate-180' : ''}`} />
          </button>
          {showEmployerCost && (
            <div className="border-t border-border px-4 py-3">
              <table className="w-full text-xs">
                <tbody className="space-y-1">
                  <tr>
                    <td className="py-1 text-muted-foreground">CNSS patronal (8,98% — plafonné 6 000 MAD)</td>
                    <td className="py-1 text-right font-mono text-foreground">{fmt(computed.cnss_employer)} MAD</td>
                  </tr>
                  <tr>
                    <td className="py-1 text-muted-foreground">AMO patronal (4,11%)</td>
                    <td className="py-1 text-right font-mono text-foreground">{fmt(computed.amo_employer)} MAD</td>
                  </tr>
                  <tr>
                    <td className="py-1 text-muted-foreground">Allocations familiales (6,40%)</td>
                    <td className="py-1 text-right font-mono text-foreground">{fmt(computed.alloc_familiales)} MAD</td>
                  </tr>
                  <tr className="border-t border-border">
                    <td className="pt-1.5 font-semibold text-foreground">Total charges patronales</td>
                    <td className="pt-1.5 text-right font-mono font-bold text-foreground">{fmt(computed.cnss_employer + computed.amo_employer + computed.alloc_familiales)} MAD</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Notes */}
      <div className="glass rounded-lg p-4">
        <label className="block text-[11px] text-muted-foreground mb-1">Notes</label>
        <textarea
          className="w-full text-xs px-2.5 py-1.5 border border-input rounded-lg bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none"
          rows={2}
          value={payslip.notes || ''}
          onChange={e => { setPayslip(p => p ? { ...p, notes: e.target.value } : p); setDirty(true); }}
        />
      </div>

      {/* Save button */}
      <div className="flex justify-end">
        <button
          onClick={save}
          className="px-4 py-2 text-sm bg-primary hover:bg-primary/90 text-white rounded-lg"
        >
          Enregistrer
        </button>
      </div>

      {showPrintPreview && previewBlob && (
        <PrintPreviewModal blob={previewBlob} filename={previewFilename} onClose={() => { setShowPrintPreview(false); setPreviewBlob(null); }} />
      )}
    </div>
  );
}
