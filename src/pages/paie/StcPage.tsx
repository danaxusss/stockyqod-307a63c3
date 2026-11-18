import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { FileMinus, Printer } from 'lucide-react';
import { SupabaseEmployeesService } from '../../utils/supabaseEmployees';
import { LeaveService } from '../../utils/supabasePayrollHr';
import { PayrollSettingsService } from '../../utils/supabasePayrollSettings';
import type { Employee } from '../../types';
import { computePayroll } from '../../utils/payrollCalc';
import type { PayrollSettings } from '../../utils/payrollDefaults';
import { localDay } from '../../utils/documentLines';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';
import { PageHeader } from '../../components/PageHeader';
import { btnSecondary, EmptyState, field, fieldLabel, LoadingState, panel } from '../../components/backoffice/BackOfficeUi';

function fmt(n: number) { return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2 }).format(n); }

/** Indemnité légale de licenciement (Code du travail marocain, art. 53) :
 *  96 h/an (1-5), 144 h (6-10), 192 h (11-15), 240 h (>15), salaire horaire = brut/191. */
function indemniteLicenciement(monthlySalary: number, years: number): number {
  const hourly = monthlySalary / 191;
  let total = 0;
  let remaining = years;
  const brackets: [number, number][] = [[5, 96], [5, 144], [5, 192], [Infinity, 240]];
  for (const [span, hoursPerYear] of brackets) {
    if (remaining <= 0) break;
    const y = Math.min(remaining, span);
    total += y * hoursPerYear * hourly;
    remaining -= y;
  }
  return Math.round(total * 100) / 100;
}

export default function StcPage() {
  const { isPaie, isSuperAdmin } = useAuth();
  const { showToast } = useToast();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [leaveDays, setLeaveDays] = useState<Map<string, number>>(new Map());
  const [daysPerMonth, setDaysPerMonth] = useState(1.5);
  const [settings, setSettings] = useState<PayrollSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [employeeId, setEmployeeId] = useState('');
  const [motif, setMotif] = useState('licenciement');
  const [sortieDate, setSortieDate] = useState(localDay());
  const [preavisMonths, setPreavisMonths] = useState('1');
  const [congesNonPris, setCongesNonPris] = useState('0');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [emps, leaves, s] = await Promise.all([SupabaseEmployeesService.list(), LeaveService.list(), PayrollSettingsService.get(new Date().getFullYear()).catch(() => null)]);
      setEmployees(emps);
      if (s) { setDaysPerMonth(s.conges_days_per_month); setSettings(s); }
      const map = new Map<string, number>();
      const year = new Date().getFullYear();
      leaves.filter(l => l.type === 'paye' && l.status === 'approved' && new Date(l.start_date).getFullYear() === year).forEach(l => map.set(l.employee_id, (map.get(l.employee_id) || 0) + Number(l.days)));
      setLeaveDays(map);
    } catch (e: any) { showToast({ type: 'error', message: e?.message || 'Erreur' }); }
    finally { setLoading(false); }
  }, [showToast]);
  useEffect(() => { load(); }, [load]);

  const emp = employees.find(e => e.id === employeeId);

  const years = useMemo(() => {
    if (!emp?.hire_date) return 0;
    return Math.max(0, (new Date(sortieDate).getTime() - new Date(emp.hire_date).getTime()) / (365.25 * 864e5));
  }, [emp, sortieDate]);

  // suggested congés non pris = acquis - pris
  useEffect(() => {
    if (!emp) return;
    const hire = emp.hire_date ? new Date(emp.hire_date) : null;
    const year = new Date(sortieDate).getFullYear();
    const startMonth = hire && hire.getFullYear() === year ? hire.getMonth() : 0;
    const monthsWorked = new Date(sortieDate).getMonth() - startMonth + 1;
    const acquired = Math.max(0, monthsWorked) * daysPerMonth;
    const taken = leaveDays.get(emp.id) || 0;
    setCongesNonPris(String(Math.max(0, Math.round((acquired - taken) * 10) / 10)));
    // Notice pay is owed by the employer only on dismissal (when the notice is
    // not worked). A resignation or the end of a fixed-term contract has none.
    setPreavisMonths(motif === 'licenciement' ? (years >= 5 ? '2' : '1') : '0');
  }, [employeeId, sortieDate, daysPerMonth, leaveDays, emp, years, motif]);

  const calc = useMemo(() => {
    if (!emp) return null;
    const monthly = emp.base_salary;
    const daily = monthly / 26;
    const indemnite = motif === 'licenciement' ? indemniteLicenciement(monthly, years) : 0;
    const preavis = Math.round(Number(preavisMonths) * monthly * 100) / 100;
    const conges = Math.round(Number(congesNonPris) * daily * 100) / 100;
    // Notice and leave pay are salary: CNSS, AMO and IR apply (estimated here
    // as one month's pay). The legal dismissal indemnity is exempt.
    const taxable = preavis + conges;
    const ded = taxable > 0
      ? computePayroll({ base_salary: taxable, anciennete_amount: 0, cimr_rate: emp.cimr_rate ?? 0, dependents_count: emp.dependents_count ?? 0, settings: settings || undefined })
      : null;
    const retenues = ded ? Math.round((ded.cnss_employee + ded.amo_employee + ded.cimr_employee + ded.ir_amount) * 100) / 100 : 0;
    const brut = Math.round((indemnite + taxable) * 100) / 100;
    const total = Math.round((brut - retenues) * 100) / 100;
    return { monthly, daily: Math.round(daily * 100) / 100, indemnite, preavis, conges, brut, retenues, total };
  }, [emp, motif, years, preavisMonths, congesNonPris, settings]);

  if (!isPaie && !isSuperAdmin) return <div className="py-12 text-center text-muted-foreground">Accès réservé au rôle Paie.</div>;
  if (loading) return <LoadingState />;

  return (
    <div className="mx-auto max-w-[110rem]">
      <div className="print:hidden">
        <PageHeader
          title="Solde de tout compte"
          subtitle="Indemnités de fin de contrat"
          actions={calc && <button onClick={() => window.print()} className={btnSecondary}><Printer className="h-4 w-4" /> Imprimer</button>}
        />
      </div>

      <div className={`${panel} mb-4 grid grid-cols-2 items-end gap-3 p-4 sm:grid-cols-3 lg:grid-cols-5 print:hidden`}>
        <div className="col-span-2 sm:col-span-1"><label className={fieldLabel} htmlFor="stc-employee">Employé</label>
          <select id="stc-employee" value={employeeId} onChange={e => setEmployeeId(e.target.value)} className={field}><option value="">—</option>{employees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}</select></div>
        <div className="col-span-2 sm:col-span-1"><label className={fieldLabel} htmlFor="stc-motif">Motif</label>
          <select id="stc-motif" value={motif} onChange={e => setMotif(e.target.value)} className={field}><option value="licenciement">Licenciement</option><option value="demission">Démission</option><option value="fin_cdd">Fin de CDD</option></select></div>
        <div className="col-span-2 sm:col-span-1"><label className={fieldLabel} htmlFor="stc-sortie">Date de sortie</label><input id="stc-sortie" type="date" value={sortieDate} onChange={e => setSortieDate(e.target.value)} className={field} /></div>
        <div><label className={fieldLabel} htmlFor="stc-preavis">Préavis (mois)</label><input id="stc-preavis" type="number" value={preavisMonths} onChange={e => setPreavisMonths(e.target.value)} className={`${field} tabular-nums`} /></div>
        <div><label className={fieldLabel} htmlFor="stc-conges">Congés non pris (jours)</label><input id="stc-conges" type="number" value={congesNonPris} onChange={e => setCongesNonPris(e.target.value)} className={`${field} tabular-nums`} /></div>
      </div>

      {calc && emp ? (
        <div id="print-area" className={`${panel} mx-auto max-w-2xl p-5 sm:p-8`}>
          <div className="mb-5 text-center">
            <h2 className="text-lg font-bold text-foreground">Reçu pour solde de tout compte</h2>
            <p className="mt-1 text-sm text-muted-foreground">{emp.full_name} · ancienneté {years.toFixed(2)} ans · sortie {new Date(sortieDate).toLocaleDateString('fr-FR')}</p>
          </div>
          <div className="divide-y divide-border text-sm">
            <Row label="Salaire mensuel de référence" value={calc.monthly} />
            {motif === 'licenciement' && <Row label={`Indemnité de licenciement (${years.toFixed(1)} ans)`} value={calc.indemnite} />}
            {calc.preavis > 0 && <Row label={`Indemnité compensatrice de préavis (${preavisMonths} mois)`} value={calc.preavis} />}
            <Row label={`Congés payés non pris (${congesNonPris} j)`} value={calc.conges} />
            <div className="flex justify-between gap-4 py-2.5 font-semibold text-foreground"><span>Total brut</span><span className="tabular-nums">{fmt(calc.brut)}</span></div>
            {calc.retenues > 0 && <Row label="Retenues CNSS, AMO, IR (estimation)" value={-calc.retenues} />}
            <div className="-mx-5 mt-1 flex justify-between gap-4 bg-secondary/40 px-5 py-3 text-base font-bold text-foreground sm:-mx-8 sm:px-8"><span>Net à percevoir</span><span className="tabular-nums">{fmt(calc.total)} MAD</span></div>
          </div>
          <p className="mt-4 text-center text-xs text-muted-foreground print:mt-16">Barème indicatif (art. 52-53 Code du travail) — à faire valider par votre conseil.</p>
        </div>
      ) : (
        <div className={`${panel} print:hidden`}>
          <EmptyState icon={FileMinus} title="Choisissez un employé pour calculer son solde de tout compte." />
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return <div className="flex justify-between gap-4 py-2.5"><span className="text-muted-foreground">{label}</span><span className="whitespace-nowrap tabular-nums text-foreground">{fmt(value)}</span></div>;
}
