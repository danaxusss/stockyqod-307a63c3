import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Wallet } from 'lucide-react';
import { Payslip, Employee } from '../../types';
import { SupabasePayslipsService } from '../../utils/supabasePayslips';
import { SupabaseEmployeesService } from '../../utils/supabaseEmployees';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';
import { PageHeader } from '../../components/PageHeader';
import { DocumentCard } from '../../components/lists/DocumentCard';
import { btnPrimary, btnSecondary, EmptyState, field, fieldLabel, LoadingState, panel, td, tdNum, th, theadRow, thRight } from '../../components/backoffice/BackOfficeUi';

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

  const selectCls = field;

  return (
    <div className="mx-auto max-w-[110rem]">
      <PageHeader
        title="Bulletins de paie"
        subtitle={`${payslips.length} bulletin(s)`}
        actions={
          <button onClick={() => setShowNewForm(v => !v)} aria-expanded={showNewForm} className={btnPrimary}>
            <Plus className="h-4 w-4" /> Nouveau bulletin
          </button>
        }
      >
        {/* Filters */}
        <div className={`${panel} grid grid-cols-2 gap-2 p-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]`}>
          <select className={`${selectCls} col-span-2 md:col-span-1`} value={filterEmployee} onChange={e => setFilterEmployee(e.target.value)} aria-label="Employé">
            <option value="">Tous les employés</option>
            {employees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
          </select>
          <select className={selectCls} value={filterYear} onChange={e => setFilterYear(e.target.value ? Number(e.target.value) : '')} aria-label="Année">
            <option value="">Toutes les années</option>
            {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <select className={selectCls} value={filterMonth} onChange={e => setFilterMonth(e.target.value ? Number(e.target.value) : '')} aria-label="Mois">
            <option value="">Tous les mois</option>
            {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
        </div>
      </PageHeader>

      {showNewForm && (
        <section className={`${panel} mb-4 border-primary/40 p-4 sm:p-5`}>
          <h2 className="mb-3 font-semibold text-foreground">Créer un bulletin</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
            <div className="col-span-2 sm:col-span-1">
              <label className={fieldLabel} htmlFor="ps-employee">Employé *</label>
              <select id="ps-employee" className={selectCls} value={newEmployeeId} onChange={e => setNewEmployeeId(e.target.value)}>
                <option value="">— Sélectionner —</option>
                {employees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
              </select>
            </div>
            <div>
              <label className={fieldLabel} htmlFor="ps-month">Mois</label>
              <select id="ps-month" className={selectCls} value={newMonth} onChange={e => setNewMonth(Number(e.target.value))}>
                {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className={fieldLabel} htmlFor="ps-year">Année</label>
              <select id="ps-year" className={selectCls} value={newYear} onChange={e => setNewYear(Number(e.target.value))}>
                {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          </div>
          <div className="mt-4 flex gap-2 sm:justify-end">
            <button onClick={() => setShowNewForm(false)} className={`${btnSecondary} flex-1 sm:flex-none`}>Annuler</button>
            <button onClick={handleCreate} disabled={creating} className={`${btnPrimary} flex-1 sm:flex-none`}>
              {creating ? 'Création…' : 'Créer'}
            </button>
          </div>
        </section>
      )}

      {isLoading ? (
        <LoadingState />
      ) : payslips.length === 0 ? (
        <div className={panel}>
          <EmptyState icon={Wallet} title="Aucun bulletin trouvé." />
        </div>
      ) : (
        <div className={`${panel} overflow-hidden`}>
          <ul className="divide-y divide-border md:hidden">
            {payslips.map(p => (
              <DocumentCard key={p.id} to={`/paie/bulletins/${p.id}`}
                number={p.payslip_number}
                title={(p.employee as unknown as { full_name: string })?.full_name || '—'}
                subtitle={`Brut ${fmt(p.total_gross)} MAD · retenues ${fmt(p.total_deductions)} MAD`}
                date={`${MONTHS[p.period_month - 1]} ${p.period_year}`}
                amount={<span className="text-emerald-700 dark:text-emerald-300">{fmt(p.net_salary)} MAD</span>}
                note={<span className="text-muted-foreground">net à payer</span>}
              />
            ))}
          </ul>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className={theadRow}>
                  <th className={th}>N° Bulletin</th>
                  <th className={th}>Employé</th>
                  <th className={th}>Période</th>
                  <th className={thRight}>Salaire brut</th>
                  <th className={thRight}>Retenues</th>
                  <th className={thRight}>Salaire net</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {payslips.map(p => (
                  <tr
                    key={p.id}
                    className="cursor-pointer hover:bg-secondary/40"
                    onClick={() => navigate(`/paie/bulletins/${p.id}`)}
                  >
                    <td className={`${td} font-mono font-semibold text-primary`}>{p.payslip_number}</td>
                    <td className={`${td} font-medium text-foreground`}>{(p.employee as unknown as { full_name: string })?.full_name || '—'}</td>
                    <td className={`${td} whitespace-nowrap text-muted-foreground`}>{MONTHS[p.period_month - 1]} {p.period_year}</td>
                    <td className={`${tdNum} text-foreground`}>{fmt(p.total_gross)} MAD</td>
                    <td className={`${tdNum} text-red-700 dark:text-red-300`}>{fmt(p.total_deductions)} MAD</td>
                    <td className={`${tdNum} font-semibold text-emerald-700 dark:text-emerald-300`}>{fmt(p.net_salary)} MAD</td>
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
