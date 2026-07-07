import React, { useEffect, useState, useCallback } from 'react';
import { HandCoins, Plus, Loader, Check, Trash2 } from 'lucide-react';
import { LoanService, type EmployeeLoan } from '../../utils/supabasePayrollHr';
import { SupabaseEmployeesService } from '../../utils/supabaseEmployees';
import type { Employee } from '../../types';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';

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

  if (!isPaie && !isSuperAdmin) return <div className="text-center py-12 text-muted-foreground">Accès réservé au rôle Paie.</div>;
  if (loading) return <div className="flex items-center justify-center py-24 text-muted-foreground"><Loader className="h-5 w-5 animate-spin mr-2" />Chargement…</div>;

  return (
    <div className="max-w-4xl mx-auto py-6 px-3">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-primary/10"><HandCoins className="h-5 w-5 text-primary" /></div>
          <div><h1 className="text-lg font-bold text-foreground leading-tight">Avances & prêts</h1><p className="text-xs text-muted-foreground">Retenues automatiques sur la paie du mois</p></div>
        </div>
        <button onClick={() => setAdding(v => !v)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium"><Plus className="h-4 w-4" /> Avance / prêt</button>
      </div>

      {adding && (
        <div className="bg-card border border-primary/30 rounded-xl p-3 mb-4 grid grid-cols-2 sm:grid-cols-5 gap-2 items-end">
          <div className="col-span-2 sm:col-span-1"><label className="block text-[11px] text-muted-foreground mb-1">Employé</label>
            <select value={form.employee_id} onChange={e => setForm(f => ({ ...f, employee_id: e.target.value }))} className="w-full px-2 py-1.5 text-sm rounded bg-secondary border border-border"><option value="">—</option>{employees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}</select></div>
          <div><label className="block text-[11px] text-muted-foreground mb-1">Type</label>
            <select value={form.kind} onChange={e => setForm(f => ({ ...f, kind: e.target.value }))} className="w-full px-2 py-1.5 text-sm rounded bg-secondary border border-border"><option value="avance">Avance</option><option value="pret">Prêt</option></select></div>
          <div><label className="block text-[11px] text-muted-foreground mb-1">Montant</label><input type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} className="w-full px-2 py-1.5 text-sm rounded bg-secondary border border-border" /></div>
          <div><label className="block text-[11px] text-muted-foreground mb-1">Échéance/mois</label><input type="number" value={form.monthly_installment} onChange={e => setForm(f => ({ ...f, monthly_installment: e.target.value }))} className="w-full px-2 py-1.5 text-sm rounded bg-secondary border border-border" /></div>
          <button onClick={submit} className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm"><Check className="h-4 w-4 mx-auto" /></button>
        </div>
      )}

      <div className="bg-card border border-border/60 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="bg-secondary/50 text-xs text-muted-foreground border-b border-border/60">
            <th className="text-left font-medium px-3 py-2">Employé</th>
            <th className="text-left font-medium px-3 py-2">Type</th>
            <th className="text-right font-medium px-3 py-2">Montant</th>
            <th className="text-right font-medium px-3 py-2">Échéance</th>
            <th className="text-right font-medium px-3 py-2">Restant</th>
            <th className="text-left font-medium px-3 py-2">État</th>
            <th className="w-8"></th>
          </tr></thead>
          <tbody>
            {loans.map(l => (
              <tr key={l.id} className="border-b border-border/40">
                <td className="px-3 py-2">{(l.employee as any)?.full_name || '—'}</td>
                <td className="px-3 py-2 text-xs">{l.kind === 'pret' ? 'Prêt' : 'Avance'} · {l.label}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt(l.amount)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{fmt(l.monthly_installment)}</td>
                <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmt(l.remaining)}</td>
                <td className="px-3 py-2"><span className={`text-[11px] font-semibold ${l.active && l.remaining > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>{l.active && l.remaining > 0 ? 'En cours' : 'Soldé'}</span></td>
                <td className="px-2 text-center"><button onClick={() => LoanService.remove(l.id).then(load)} className="p-1 text-muted-foreground hover:bg-secondary rounded"><Trash2 className="h-3.5 w-3.5" /></button></td>
              </tr>
            ))}
            {loans.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">Aucune avance / prêt</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
