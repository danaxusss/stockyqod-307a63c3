import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { CalendarDays, Plus, Check, X, Trash2 } from 'lucide-react';
import { LeaveService, type LeaveRequest } from '../../utils/supabasePayrollHr';
import { SupabaseEmployeesService } from '../../utils/supabaseEmployees';
import { PayrollSettingsService } from '../../utils/supabasePayrollSettings';
import { leaveWorkingDays } from '../../utils/payrollCalc';
import type { Employee } from '../../types';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';
import { PageHeader, Panel } from '../../components/PageHeader';
import { StatusPill } from '../../components/lists/StatusPill';
import { btnPrimary, EmptyState, field, fieldLabel, iconBtnDanger, LoadingState, panel } from '../../components/backoffice/BackOfficeUi';

const TYPE_LABELS: Record<string, string> = { paye: 'Congé payé', maladie: 'Maladie', sans_solde: 'Sans solde', exceptionnel: 'Exceptionnel', autre: 'Autre' };

export default function CongesPage() {
  const { isPaie, isSuperAdmin, currentUser } = useAuth();
  const { showToast } = useToast();
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [daysPerMonth, setDaysPerMonth] = useState(1.5);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ employee_id: '', type: 'paye', start_date: '', end_date: '', reason: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, emps, s] = await Promise.all([LeaveService.list(), SupabaseEmployeesService.list(), PayrollSettingsService.get(new Date().getFullYear()).catch(() => null)]);
      setRequests(r); setEmployees(emps.filter(e => e.is_active));
      if (s) setDaysPerMonth(s.conges_days_per_month);
    } catch (e: any) { showToast({ type: 'error', message: e?.message || 'Erreur' }); }
    finally { setLoading(false); }
  }, [showToast]);
  useEffect(() => { load(); }, [load]);

  // Solde congés payés (acquis - pris) par employé, année courante
  const soldes = useMemo(() => {
    const year = new Date().getFullYear();
    return employees.map(e => {
      const hire = e.hire_date ? new Date(e.hire_date) : null;
      const startMonth = hire && hire.getFullYear() === year ? hire.getMonth() : 0;
      const monthsWorked = new Date().getMonth() - startMonth + 1;
      const acquired = Math.max(0, monthsWorked) * daysPerMonth;
      const taken = requests.filter(r => r.employee_id === e.id && r.type === 'paye' && r.status === 'approved' && new Date(r.start_date).getFullYear() === year).reduce((s, r) => s + Number(r.days), 0);
      return { employee: e, acquired: Math.round(acquired * 10) / 10, taken, solde: Math.round((acquired - taken) * 10) / 10 };
    });
  }, [employees, requests, daysPerMonth]);

  const submit = async () => {
    if (!form.employee_id || !form.start_date || !form.end_date) { showToast({ type: 'error', message: 'Employé et dates requis' }); return; }
    try {
      await LeaveService.create({ employee_id: form.employee_id, type: form.type as any, start_date: form.start_date, end_date: form.end_date, days: leaveWorkingDays(form.start_date, form.end_date), reason: form.reason, approved_by: currentUser?.username || null });
      showToast({ type: 'success', message: 'Demande enregistrée' });
      setAdding(false); setForm({ employee_id: '', type: 'paye', start_date: '', end_date: '', reason: '' }); await load();
    } catch (e: any) { showToast({ type: 'error', message: e?.message || 'Échec' }); }
  };

  const setStatus = async (id: string, status: 'approved' | 'rejected') => {
    try { await LeaveService.setStatus(id, status, currentUser?.username || null); await load(); }
    catch (e: any) { showToast({ type: 'error', message: e?.message || 'Échec' }); }
  };

  if (!isPaie && !isSuperAdmin) return <div className="py-12 text-center text-muted-foreground">Accès réservé au rôle Paie.</div>;
  if (loading) return <LoadingState />;

  return (
    <div className="mx-auto max-w-[110rem]">
      <PageHeader
        title="Congés"
        subtitle={`${daysPerMonth} j acquis / mois`}
        actions={<button onClick={() => setAdding(v => !v)} aria-expanded={adding} className={btnPrimary}><Plus className="h-4 w-4" /> Demande</button>}
      />

      {adding && (
        <section className={`${panel} mb-4 border-primary/40 p-4`}>
          <h2 className="mb-3 text-sm font-semibold text-foreground">Nouvelle demande</h2>
          <div className="grid grid-cols-2 items-end gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
            <div className="col-span-2 sm:col-span-1"><label className={fieldLabel} htmlFor="lv-employee">Employé</label>
              <select id="lv-employee" value={form.employee_id} onChange={e => setForm(f => ({ ...f, employee_id: e.target.value }))} className={field}><option value="">—</option>{employees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}</select></div>
            <div className="col-span-2 sm:col-span-1"><label className={fieldLabel} htmlFor="lv-type">Type</label>
              <select id="lv-type" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} className={field}>{Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
            <div><label className={fieldLabel} htmlFor="lv-start">Du</label><input id="lv-start" type="date" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} className={field} /></div>
            <div><label className={fieldLabel} htmlFor="lv-end">Au</label><input id="lv-end" type="date" value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} className={field} /></div>
            <button onClick={submit} aria-label="Enregistrer la demande" className={`${btnPrimary} col-span-2 sm:col-span-1`}><Check className="h-4 w-4" /><span className="sm:hidden">Enregistrer</span></button>
          </div>
        </section>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        {/* Soldes */}
        <Panel title={`Soldes congés payés ${new Date().getFullYear()}`}>
          {soldes.length === 0 ? <EmptyState title="Aucun employé actif" /> : (
            <ul className="divide-y divide-border">
              {soldes.map(s => (
                <li key={s.employee.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">{s.employee.full_name}</span>
                    <span className="block text-xs text-muted-foreground">Acquis {s.acquired} j · Pris {s.taken} j</span>
                  </span>
                  <span className="shrink-0 rounded-lg bg-secondary px-2.5 py-1 text-sm font-semibold tabular-nums text-foreground">{s.solde} j</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {/* Requests */}
        <Panel title="Demandes">
          {requests.length === 0 ? <EmptyState icon={CalendarDays} title="Aucune demande" /> : (
            <ul className="divide-y divide-border">
              {requests.map(r => (
                <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:flex-nowrap sm:px-5">
                  <span className="min-w-0 flex-1 basis-full sm:basis-auto">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground">{(r.employee as any)?.full_name || '—'}</span>
                      <StatusPill tone="neutral">{TYPE_LABELS[r.type]}</StatusPill>
                    </span>
                    <span className="block text-xs tabular-nums text-muted-foreground">{new Date(r.start_date).toLocaleDateString('fr-FR')} → {new Date(r.end_date).toLocaleDateString('fr-FR')} · {r.days} j</span>
                  </span>
                  <span className="flex flex-1 items-center justify-end gap-1 sm:flex-none">
                    {r.status === 'pending' ? (
                      <>
                        <button onClick={() => setStatus(r.id, 'approved')} aria-label="Approuver" title="Approuver" className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300"><Check className="h-4 w-4" /></button>
                        <button onClick={() => setStatus(r.id, 'rejected')} aria-label="Refuser" title="Refuser" className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-red-500/10 text-red-700 hover:bg-red-500/20 dark:text-red-300"><X className="h-4 w-4" /></button>
                      </>
                    ) : r.status === 'approved' ? <StatusPill tone="success">Approuvé</StatusPill> : <StatusPill tone="danger">Refusé</StatusPill>}
                    <button onClick={() => LeaveService.remove(r.id).then(load)} aria-label="Supprimer la demande" title="Supprimer" className={iconBtnDanger}><Trash2 className="h-4 w-4" /></button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
