import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Wallet } from 'lucide-react';
import { Payslip, Employee } from '../../types';
import { SupabasePayslipsService } from '../../utils/supabasePayslips';
import { SupabaseEmployeesService } from '../../utils/supabaseEmployees';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';

function fmt(n: number) {
  return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2 }).format(n);
}

const MONTHS = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];

const currentYear = new Date().getFullYear();
const YEARS = Array.from({ length: 5 }, (_, i) => currentYear - i);

export default function PayslipsPage() {
  const navigate = useNavigate();
  const { isSuperAdmin, isPaie, companyId: ctxCompanyId } = useAuth();
  const { showToast } = useToast();

  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filterEmployee, setFilterEmployee] = useState('');
  const [filterYear, setFilterYear] = useState<number | ''>('');
  const [filterMonth, setFilterMonth] = useState<number | ''>('');
  const [creating, setCreating] = useState(false);
  const [newEmployeeId, setNewEmployeeId] = useState('');
  const [newMonth, setNewMonth] = useState(new Date().getMonth() + 1);
  const [newYear, setNewYear] = useState(currentYear);
  const [showNewForm, setShowNewForm] = useState(false);

  const companyId = ctxCompanyId || '';

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [ps, emps] = await Promise.all([
        SupabasePayslipsService.list({
          employeeId: filterEmployee || undefined,
          year: filterYear || undefined,
          month: filterMonth || undefined,
        }),
        SupabaseEmployeesService.list(),
      ]);
      setPayslips(ps);
      setEmployees(emps.filter(e => e.is_active));
    } catch (e) {
      showToast({ type: 'error', title: 'Erreur', message: (e as any)?.message || String(e) });
    } finally {
      setIsLoading(false);
    }
  }, [filterEmployee, filterYear, filterMonth, showToast]);

  useEffect(() => { load(); }, [load]);

  if (!isPaie && !isSuperAdmin) {
    return <div className="text-center py-12 text-muted-foreground">Accès réservé au rôle Paie.</div>;
  }

  const handleCreate = async () => {
    if (!newEmployeeId) {
      showToast({ type: 'error', title: 'Erreur', message: 'Sélectionnez un employé.' });
      return;
    }
    const employee = employees.find(e => e.id === newEmployeeId);
    if (!employee) return;

    setCreating(true);
    try {
      const payslip = await SupabasePayslipsService.create({
        company_id: employee.company_id || companyId,
        employee_id: newEmployeeId,
        period_month: newMonth,
        period_year: newYear,
        hours_worked: 191,
        base_salary: employee.base_salary,
        anciennete_rate: 0,
        anciennete_amount: 0,
        other_earnings: 0,
        total_gross: employee.base_salary,
        cnss_employee: 0,
        amo_employee: 0,
        cimr_employee: 0,
        frais_pro: 0,
        ir_amount: 0,
        other_deductions: 0,
        total_deductions: 0,
        net_salary: employee.base_salary,
        cnss_employer: 0,
        amo_employer: 0,
        alloc_familiales: 0,
      });
      navigate(`/paie/bulletins/${payslip.id}`);
    } catch (e) {
      showToast({ type: 'error', title: 'Erreur', message: (e as any)?.message || String(e) });
    } finally {
      setCreating(false);
    }
  };

  const selectCls = 'text-xs px-2 py-1.5 border border-input rounded-lg bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary';

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-lg font-bold text-foreground">Bulletins de paie</h1>
          <p className="text-xs text-muted-foreground">{payslips.length} bulletin(s)</p>
        </div>
        <button
          onClick={() => setShowNewForm(v => !v)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary hover:bg-primary/90 text-white rounded-lg"
        >
          <Plus className="h-3.5 w-3.5" /> Nouveau bulletin
        </button>
      </div>

      {showNewForm && (
        <div className="glass rounded-lg p-4 space-y-3">
          <h2 className="text-sm font-semibold text-foreground">Créer un bulletin</h2>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-3 sm:col-span-1">
              <label className="block text-[11px] text-muted-foreground mb-0.5">Employé *</label>
              <select className={`w-full ${selectCls}`} value={newEmployeeId} onChange={e => setNewEmployeeId(e.target.value)}>
                <option value="">— Sélectionner —</option>
                {employees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-muted-foreground mb-0.5">Mois</label>
              <select className={`w-full ${selectCls}`} value={newMonth} onChange={e => setNewMonth(Number(e.target.value))}>
                {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-muted-foreground mb-0.5">Année</label>
              <select className={`w-full ${selectCls}`} value={newYear} onChange={e => setNewYear(Number(e.target.value))}>
                {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowNewForm(false)} className="px-3 py-1.5 text-sm rounded-lg border border-border hover:bg-accent text-foreground">Annuler</button>
            <button onClick={handleCreate} disabled={creating} className="px-4 py-1.5 text-sm rounded-lg bg-primary hover:bg-primary/90 text-white disabled:opacity-50">
              {creating ? 'Création…' : 'Créer'}
            </button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <select className={selectCls} value={filterEmployee} onChange={e => setFilterEmployee(e.target.value)}>
          <option value="">Tous les employés</option>
          {employees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
        </select>
        <select className={selectCls} value={filterYear} onChange={e => setFilterYear(e.target.value ? Number(e.target.value) : '')}>
          <option value="">Toutes les années</option>
          {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <select className={selectCls} value={filterMonth} onChange={e => setFilterMonth(e.target.value ? Number(e.target.value) : '')}>
          <option value="">Tous les mois</option>
          {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
        </select>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center min-h-[20vh]"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>
      ) : payslips.length === 0 ? (
        <div className="glass rounded-lg p-12 text-center">
          <Wallet className="h-8 w-8 mx-auto text-muted-foreground/40 mb-2" />
          <p className="text-sm text-muted-foreground">Aucun bulletin trouvé.</p>
        </div>
      ) : (
        <div className="glass rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-secondary/30">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground">N° Bulletin</th>
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground">Employé</th>
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground">Période</th>
                  <th className="px-4 py-2 text-right font-medium text-muted-foreground">Salaire brut</th>
                  <th className="px-4 py-2 text-right font-medium text-muted-foreground">Retenues</th>
                  <th className="px-4 py-2 text-right font-medium text-muted-foreground">Salaire net</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {payslips.map(p => (
                  <tr
                    key={p.id}
                    className="hover:bg-accent/20 cursor-pointer"
                    onClick={() => navigate(`/paie/bulletins/${p.id}`)}
                  >
                    <td className="px-4 py-2.5 font-mono font-semibold text-primary">{p.payslip_number}</td>
                    <td className="px-4 py-2.5 font-medium text-foreground">{(p.employee as unknown as { full_name: string })?.full_name || '—'}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{MONTHS[p.period_month - 1]} {p.period_year}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-foreground">{fmt(p.total_gross)} MAD</td>
                    <td className="px-4 py-2.5 text-right font-mono text-red-600 dark:text-red-400">{fmt(p.total_deductions)} MAD</td>
                    <td className="px-4 py-2.5 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">{fmt(p.net_salary)} MAD</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
