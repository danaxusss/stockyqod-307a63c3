import React, { useEffect, useState, useCallback } from 'react';
import { HandCoins, Plus, Check, Trash2 } from 'lucide-react';
import { LoanService, type EmployeeLoan } from '../../utils/supabasePayrollHr';
import { SupabaseEmployeesService } from '../../utils/supabaseEmployees';
import type { Employee } from '../../types';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';
import { PageHeader } from '../../components/PageHeader';
import { StatusPill } from '../../components/lists/StatusPill';
import { btnPrimary, EmptyState, field, fieldLabel, iconBtnDanger, LoadingState, MobileField, panel, td, tdNum, th, theadRow, thRight } from '../../components/backoffice/BackOfficeUi';

function fmt(n: number) { return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2 }).format(n); }

export default function AvancesPage() {
  const { isPaie, isSuperAdmin, currentUser } = useAuth();
  const { showToast } = useToast();
  const [loans, setLoans] = useState<EmployeeLoan[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ employee_id: '', kind: 'avance', label: 'Avance', amount: '', monthly_installment: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try { const [l, emps] = await Promise.all([LoanService.list(), SupabaseEmployeesService.list()]); setLoans(l); setEmployees(emps.filter(e => e.is_active)); }
    catch (e: any) { showToast({ type: 'error', message: e?.message || 'Erreur' }); }
    finally { setLoading(false); }
  }, [showToast]);
  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    if (!form.employee_id || !Number(form.amount) || !Number(form.monthly_installment)) { showToast({ type: 'error', message: 'Employé, montant et échéance requis' }); return; }
    try {
      await LoanService.create({ employee_id: form.employee_id, kind: form.kind as any, label: form.label || 'Avance', amount: Number(form.amount), monthly_installment: Number(form.monthly_installment), created_by: currentUser?.username || null } as any);
      showToast({ type: 'success', message: 'Enregistré' });
      setAdding(false); setForm({ employee_id: '', kind: 'avance', label: 'Avance', amount: '', monthly_installment: '' }); await load();
    } catch (e: any) { showToast({ type: 'error', message: e?.message || 'Échec' }); }
  };

  if (!isPaie && !isSuperAdmin) return <div className="py-12 text-center text-muted-foreground">Accès réservé au rôle Paie.</div>;
  if (loading) return <LoadingState />;

  const statePill = (l: EmployeeLoan) => l.active && l.remaining > 0 ? <StatusPill tone="warning">En cours</StatusPill> : <StatusPill tone="success">Soldé</StatusPill>;
  const deleteButton = (l: EmployeeLoan) => (
    <button onClick={() => LoanService.remove(l.id).then(load)} aria-label="Supprimer" title="Supprimer" className={iconBtnDanger}><Trash2 className="h-4 w-4" /></button>
  );

  return (
    <div className="mx-auto max-w-[110rem]">
      <PageHeader
        title="Avances & prêts"
        subtitle="Retenues automatiques sur la paie du mois"
        actions={<button onClick={() => setAdding(v => !v)} aria-expanded={adding} className={btnPrimary}><Plus className="h-4 w-4" /> Avance / prêt</button>}
      />

      {adding && (
        <section className={`${panel} mb-4 border-primary/40 p-4`}>
          <h2 className="mb-3 text-sm font-semibold text-foreground">Nouvelle avance / prêt</h2>
          <div className="grid grid-cols-2 items-end gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
            <div className="col-span-2 sm:col-span-1"><label className={fieldLabel} htmlFor="ln-employee">Employé</label>
              <select id="ln-employee" value={form.employee_id} onChange={e => setForm(f => ({ ...f, employee_id: e.target.value }))} className={field}><option value="">—</option>{employees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}</select></div>
            <div className="col-span-2 sm:col-span-1"><label className={fieldLabel} htmlFor="ln-kind">Type</label>
              <select id="ln-kind" value={form.kind} onChange={e => setForm(f => ({ ...f, kind: e.target.value }))} className={field}><option value="avance">Avance</option><option value="pret">Prêt</option></select></div>
            <div><label className={fieldLabel} htmlFor="ln-amount">Montant</label><input id="ln-amount" type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} className={`${field} tabular-nums`} /></div>
            <div><label className={fieldLabel} htmlFor="ln-monthly">Échéance/mois</label><input id="ln-monthly" type="number" value={form.monthly_installment} onChange={e => setForm(f => ({ ...f, monthly_installment: e.target.value }))} className={`${field} tabular-nums`} /></div>
            <button onClick={submit} aria-label="Enregistrer l'avance ou le prêt" className={`${btnPrimary} col-span-2 sm:col-span-1`}><Check className="h-4 w-4" /><span className="sm:hidden">Enregistrer</span></button>
          </div>
        </section>
      )}

      <div className={`${panel} overflow-hidden`}>
        {loans.length === 0 ? <EmptyState icon={HandCoins} title="Aucune avance / prêt" /> : (
          <>
            <ul className="divide-y divide-border md:hidden">
              {loans.map(l => (
                <li key={l.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">{l.employee?.full_name || '—'}</p>
                      <p className="truncate text-xs text-muted-foreground">{l.kind === 'pret' ? 'Prêt' : 'Avance'} · {l.label}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">{statePill(l)}{deleteButton(l)}</div>
                  </div>
                  <dl className="mt-2 grid grid-cols-3 gap-x-3">
                    <MobileField label="Montant">{fmt(l.amount)}</MobileField>
                    <MobileField label="Échéance">{fmt(l.monthly_installment)}</MobileField>
                    <MobileField label="Restant"><span className="font-semibold">{fmt(l.remaining)}</span></MobileField>
                  </dl>
                </li>
              ))}
            </ul>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead><tr className={theadRow}>
                  <th className={th}>Employé</th>
                  <th className={th}>Type</th>
                  <th className={thRight}>Montant</th>
                  <th className={thRight}>Échéance</th>
                  <th className={thRight}>Restant</th>
                  <th className={th}>État</th>
                  <th className={`${th} w-12`}><span className="sr-only">Actions</span></th>
                </tr></thead>
                <tbody className="divide-y divide-border">
                  {loans.map(l => (
                    <tr key={l.id} className="hover:bg-secondary/40">
                      <td className={`${td} font-medium text-foreground`}>{l.employee?.full_name || '—'}</td>
                      <td className={`${td} text-muted-foreground`}>{l.kind === 'pret' ? 'Prêt' : 'Avance'} · {l.label}</td>
                      <td className={`${tdNum} text-foreground`}>{fmt(l.amount)}</td>
                      <td className={`${tdNum} text-muted-foreground`}>{fmt(l.monthly_installment)}</td>
                      <td className={`${tdNum} font-semibold text-foreground`}>{fmt(l.remaining)}</td>
                      <td className={td}>{statePill(l)}</td>
                      <td className={`${td} py-1.5 text-center`}>{deleteButton(l)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
