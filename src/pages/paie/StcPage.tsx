import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { FileMinus, Loader, Printer } from 'lucide-react';
import { SupabaseEmployeesService } from '../../utils/supabaseEmployees';
import { LeaveService } from '../../utils/supabasePayrollHr';
import { PayrollSettingsService } from '../../utils/supabasePayrollSettings';
import type { Employee } from '../../types';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';

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
  const [loading, setLoading] = useState(true);
  const [employeeId, setEmployeeId] = useState('');
  const [motif, setMotif] = useState('licenciement');
  const [sortieDate, setSortieDate] = useState(new Date().toISOString().slice(0, 10));
  const [preavisMonths, setPreavisMonths] = useState('1');
  const [congesNonPris, setCongesNonPris] = useState('0');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [emps, leaves, s] = await Promise.all([SupabaseEmployeesService.list(), LeaveService.list(), PayrollSettingsService.get(new Date().getFullYear()).catch(() => null)]);
      setEmployees(emps);
      if (s) setDaysPerMonth(s.conges_days_per_month);
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
    setPreavisMonths(years >= 5 ? '2' : '1');
  }, [employeeId, sortieDate, daysPerMonth, leaveDays, emp, years]);

  const calc = useMemo(() => {
    if (!emp) return null;
    const monthly = emp.base_salary;
    const daily = monthly / 26;
    const indemnite = motif === 'licenciement' ? indemniteLicenciement(monthly, years) : 0;
    const preavis = Number(preavisMonths) * monthly;
    const conges = Number(congesNonPris) * daily;
    const total = Math.round((indemnite + preavis + conges) * 100) / 100;
    return { monthly, daily: Math.round(daily * 100) / 100, indemnite, preavis, conges: Math.round(conges * 100) / 100, total };
  }, [emp, motif, years, preavisMonths, congesNonPris]);

  if (!isPaie && !isSuperAdmin) return <div className="text-center py-12 text-muted-foreground">Accès réservé au rôle Paie.</div>;
  if (loading) return <div className="flex items-center justify-center py-24 text-muted-foreground"><Loader className="h-5 w-5 animate-spin mr-2" />Chargement…</div>;

  return (
    <div className="max-w-3xl mx-auto py-6 px-3">
      <div className="flex items-center justify-between mb-4 print:hidden">
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-primary/10"><FileMinus className="h-5 w-5 text-primary" /></div>
          <div><h1 className="text-lg font-bold text-foreground leading-tight">Solde de tout compte</h1><p className="text-xs text-muted-foreground">Indemnités de fin de contrat</p></div>
        </div>
        {calc && <button onClick={() => window.print()} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-secondary border border-border text-sm"><Printer className="h-3.5 w-3.5" /> Imprimer</button>}
      </div>

      <div className="bg-card border border-border/60 rounded-xl p-4 mb-4 grid grid-cols-2 sm:grid-cols-4 gap-2 items-end print:hidden">
        <div className="col-span-2 sm:col-span-1"><label className="block text-[11px] text-muted-foreground mb-1">Employé</label>
          <select value={employeeId} onChange={e => setEmployeeId(e.target.value)} className="w-full px-2 py-1.5 text-sm rounded bg-secondary border border-border"><option value="">—</option>{employees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}</select></div>
        <div><label className="block text-[11px] text-muted-foreground mb-1">Motif</label>
          <select value={motif} onChange={e => setMotif(e.target.value)} className="w-full px-2 py-1.5 text-sm rounded bg-secondary border border-border"><option value="licenciement">Licenciement</option><option value="demission">Démission</option><option value="fin_cdd">Fin de CDD</option></select></div>
        <div><label className="block text-[11px] text-muted-foreground mb-1">Date de sortie</label><input type="date" value={sortieDate} onChange={e => setSortieDate(e.target.value)} className="w-full px-2 py-1.5 text-sm rounded bg-secondary border border-border" /></div>
        <div><label className="block text-[11px] text-muted-foreground mb-1">Préavis (mois)</label><input type="number" value={preavisMonths} onChange={e => setPreavisMonths(e.target.value)} className="w-full px-2 py-1.5 text-sm rounded bg-secondary border border-border" /></div>
        <div><label className="block text-[11px] text-muted-foreground mb-1">Congés non pris (jours)</label><input type="number" value={congesNonPris} onChange={e => setCongesNonPris(e.target.value)} className="w-full px-2 py-1.5 text-sm rounded bg-secondary border border-border" /></div>
      </div>

      {calc && emp && (
        <div id="print-area" className="bg-card border border-border/60 rounded-xl p-5">
          <div className="text-center mb-4">
            <h2 className="text-base font-bold text-foreground">Reçu pour solde de tout compte</h2>
            <p className="text-sm text-muted-foreground">{emp.full_name} · ancienneté {years.toFixed(2)} ans · sortie {new Date(sortieDate).toLocaleDateString('fr-FR')}</p>
          </div>
          <div className="text-sm max-w-md mx-auto">
            <Row label="Salaire mensuel de référence" value={calc.monthly} />
            {motif === 'licenciement' && <Row label={`Indemnité de licenciement (${years.toFixed(1)} ans)`} value={calc.indemnite} />}
            <Row label={`Indemnité de préavis (${preavisMonths} mois)`} value={calc.preavis} />
            <Row label={`Congés payés non pris (${congesNonPris} j)`} value={calc.conges} />
            <div className="flex justify-between py-2 border-t-2 border-border mt-1 font-bold text-base"><span>Total à percevoir</span><span className="tabular-nums">{fmt(calc.total)} MAD</span></div>
          </div>
          <p className="text-[11px] text-muted-foreground mt-4 text-center print:mt-16">Barème indicatif (art. 52-53 Code du travail) — à faire valider par votre conseil.</p>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return <div className="flex justify-between py-1"><span className="text-muted-foreground">{label}</span><span className="tabular-nums">{fmt(value)}</span></div>;
}
