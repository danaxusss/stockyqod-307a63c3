import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { CalendarDays, Plus, Loader, Check, X, Trash2 } from 'lucide-react';
import { LeaveService, type LeaveRequest } from '../../utils/supabasePayrollHr';
import { SupabaseEmployeesService } from '../../utils/supabaseEmployees';
import { PayrollSettingsService } from '../../utils/supabasePayrollSettings';
import type { Employee } from '../../types';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';

const TYPE_LABELS: Record<string, string> = { paye: 'Congé payé', maladie: 'Maladie', sans_solde: 'Sans solde', exceptionnel: 'Exceptionnel', autre: 'Autre' };
const daysBetween = (a: string, b: string) => Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 864e5) + 1);

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
      await LeaveService.create({ employee_id: form.employee_id, type: form.type as any, start_date: form.start_date, end_date: form.end_date, days: daysBetween(form.start_date, form.end_date), reason: form.reason, approved_by: currentUser?.username || null });
      showToast({ type: 'success', message: 'Demande enregistrée' });
      setAdding(false); setForm({ employee_id: '', type: 'paye', start_date: '', end_date: '', reason: '' }); await load();
    } catch (e: any) { showToast({ type: 'error', message: e?.message || 'Échec' }); }
  };

  const setStatus = async (id: string, status: 'approved' | 'rejected') => {
    try { await LeaveService.setStatus(id, status, currentUser?.username || null); await load(); }
    catch (e: any) { showToast({ type: 'error', message: e?.message || 'Échec' }); }
  };

  if (!isPaie && !isSuperAdmin) return <div className="text-center py-12 text-muted-foreground">Accès réservé au rôle Paie.</div>;
  if (loading) return <div className="flex items-center justify-center py-24 text-muted-foreground"><Loader className="h-5 w-5 animate-spin mr-2" />Chargement…</div>;

  return (
    <div className="max-w-4xl mx-auto py-6 px-3">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-primary/10"><CalendarDays className="h-5 w-5 text-primary" /></div>
          <div><h1 className="text-lg font-bold text-foreground leading-tight">Congés</h1><p className="text-xs text-muted-foreground">{daysPerMonth} j acquis / mois</p></div>
        </div>
        <button onClick={() => setAdding(v => !v)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium"><Plus className="h-4 w-4" /> Demande</button>
      </div>

      {adding && (
        <div className="bg-card border border-primary/30 rounded-xl p-3 mb-4 grid grid-cols-2 sm:grid-cols-5 gap-2 items-end">
          <div className="col-span-2 sm:col-span-1"><label className="block text-[11px] text-muted-foreground mb-1">Employé</label>
            <select value={form.employee_id} onChange={e => setForm(f => ({ ...f, employee_id: e.target.value }))} className="w-full px-2 py-1.5 text-sm rounded bg-secondary border border-border"><option value="">—</option>{employees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}</select></div>
          <div><label className="block text-[11px] text-muted-foreground mb-1">Type</label>
            <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} className="w-full px-2 py-1.5 text-sm rounded bg-secondary border border-border">{Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
          <div><label className="block text-[11px] text-muted-foreground mb-1">Du</label><input type="date" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} className="w-full px-2 py-1.5 text-sm rounded bg-secondary border border-border" /></div>
          <div><label className="block text-[11px] text-muted-foreground mb-1">Au</label><input type="date" value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} className="w-full px-2 py-1.5 text-sm rounded bg-secondary border border-border" /></div>
          <button onClick={submit} className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm"><Check className="h-4 w-4 mx-auto" /></button>
        </div>
      )}

      {/* Soldes */}
      <div className="bg-card border border-border/60 rounded-xl overflow-hidden mb-4">
        <div className="px-3 py-2 bg-secondary/50 border-b border-border/60 text-sm font-semibold">Soldes congés payés {new Date().getFullYear()}</div>
        <table className="w-full text-sm">
          <tbody>
            {soldes.map(s => (
              <tr key={s.employee.id} className="border-b border-border/40 last:border-0">
                <td className="px-3 py-2">{s.employee.full_name}</td>
                <td className="px-3 py-2 text-right text-xs text-muted-foreground">Acquis {s.acquired} j · Pris {s.taken} j</td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums w-24">{s.solde} j</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Requests */}
      <div className="bg-card border border-border/60 rounded-xl overflow-hidden">
        <div className="px-3 py-2 bg-secondary/50 border-b border-border/60 text-sm font-semibold">Demandes</div>
        <table className="w-full text-sm">
          <tbody>
            {requests.map(r => (
              <tr key={r.id} className="border-b border-border/40 last:border-0">
                <td className="px-3 py-2">{(r.employee as any)?.full_name || '—'}</td>
                <td className="px-3 py-2 text-xs">{TYPE_LABELS[r.type]}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{new Date(r.start_date).toLocaleDateString('fr-FR')} → {new Date(r.end_date).toLocaleDateString('fr-FR')} · {r.days} j</td>
                <td className="px-3 py-2 text-right">
                  {r.status === 'pending' ? (
                    <div className="flex gap-1 justify-end">
                      <button onClick={() => setStatus(r.id, 'approved')} className="p-1 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"><Check className="h-3.5 w-3.5" /></button>
                      <button onClick={() => setStatus(r.id, 'rejected')} className="p-1 rounded bg-red-500/15 text-red-600 dark:text-red-400"><X className="h-3.5 w-3.5" /></button>
                    </div>
                  ) : <span className={`text-[11px] font-semibold ${r.status === 'approved' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>{r.status === 'approved' ? 'Approuvé' : 'Refusé'}</span>}
                </td>
                <td className="px-2 text-center"><button onClick={() => LeaveService.remove(r.id).then(load)} className="p-1 text-muted-foreground hover:bg-secondary rounded"><Trash2 className="h-3.5 w-3.5" /></button></td>
              </tr>
            ))}
            {requests.length === 0 && <tr><td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">Aucune demande</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
