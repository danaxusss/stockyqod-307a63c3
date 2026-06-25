import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Pencil, UserX, UserCheck as UserCheckIcon, Users } from 'lucide-react';
import { Employee } from '../../types';
import { SupabaseEmployeesService } from '../../utils/supabaseEmployees';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';
import { getCompanyContext } from '../../utils/supabaseCompanyFilter';

function fmt(n: number) {
  return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2 }).format(n);
}

const CONTRACT_LABELS = { CDI: 'CDI', CDD: 'CDD', Interim: 'Intérim' };
const MARITAL_LABELS: Record<string, string> = {
  celibataire: 'Célibataire', marie: 'Marié(e)', divorce: 'Divorcé(e)', veuf: 'Veuf/Veuve',
};

const EMPTY_FORM: Omit<Employee, 'id' | 'created_at' | 'updated_at'> = {
  company_id: '',
  full_name: '',
  cin: '',
  gender: undefined,
  birth_date: '',
  marital_status: undefined,
  dependents_count: 0,
  position: '',
  department: '',
  contract_type: 'CDI',
  cnss_number: '',
  cimr_number: '',
  cimr_rate: 0,
  bank_iban: '',
  hire_date: '',
  base_salary: 0,
  is_active: true,
};

interface EmployeeFormProps {
  initial: Partial<Employee>;
  companyId: string;
  onSave: (data: Omit<Employee, 'id' | 'created_at' | 'updated_at'>) => Promise<void>;
  onCancel: () => void;
  saving: boolean;
}

function EmployeeForm({ initial, companyId, onSave, onCancel, saving }: EmployeeFormProps) {
  const [form, setForm] = useState<Omit<Employee, 'id' | 'created_at' | 'updated_at'>>({
    ...EMPTY_FORM,
    company_id: companyId,
    ...initial,
  });

  const set = (field: keyof typeof form, value: unknown) =>
    setForm(f => ({ ...f, [field]: value }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({ ...form, company_id: companyId });
  };

  const inputCls = 'w-full text-sm px-2.5 py-1.5 border border-input rounded-lg bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary';
  const labelCls = 'block text-[11px] text-muted-foreground mb-0.5';

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className={labelCls}>Nom complet *</label>
          <input required className={inputCls} value={form.full_name} onChange={e => set('full_name', e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>CIN</label>
          <input className={inputCls} value={form.cin || ''} onChange={e => set('cin', e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>Genre</label>
          <select className={inputCls} value={form.gender || ''} onChange={e => set('gender', e.target.value || undefined)}>
            <option value="">—</option>
            <option value="M">Homme</option>
            <option value="F">Femme</option>
          </select>
        </div>
        <div>
          <label className={labelCls}>Date de naissance</label>
          <input type="date" className={inputCls} value={form.birth_date || ''} onChange={e => set('birth_date', e.target.value || undefined)} />
        </div>
        <div>
          <label className={labelCls}>Situation familiale</label>
          <select className={inputCls} value={form.marital_status || ''} onChange={e => set('marital_status', e.target.value as Employee['marital_status'] || undefined)}>
            <option value="">—</option>
            {Object.entries(MARITAL_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Nombre de personnes à charge</label>
          <input type="number" min={0} max={6} className={inputCls} value={form.dependents_count} onChange={e => set('dependents_count', parseInt(e.target.value) || 0)} />
        </div>
        <div>
          <label className={labelCls}>Poste / Fonction</label>
          <input className={inputCls} value={form.position || ''} onChange={e => set('position', e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>Département</label>
          <input className={inputCls} value={form.department || ''} onChange={e => set('department', e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>Type de contrat</label>
          <select className={inputCls} value={form.contract_type} onChange={e => set('contract_type', e.target.value as Employee['contract_type'])}>
            {Object.entries(CONTRACT_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Date d'embauche</label>
          <input type="date" className={inputCls} value={form.hire_date || ''} onChange={e => set('hire_date', e.target.value || undefined)} />
        </div>
        <div>
          <label className={labelCls}>N° CNSS</label>
          <input className={inputCls} value={form.cnss_number || ''} onChange={e => set('cnss_number', e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>N° CIMR</label>
          <input className={inputCls} value={form.cimr_number || ''} onChange={e => set('cimr_number', e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>Taux CIMR salarié (%)</label>
          <input type="number" min={0} max={20} step={0.01} className={inputCls} value={form.cimr_rate ?? 0} onChange={e => set('cimr_rate', parseFloat(e.target.value) || 0)} />
        </div>
        <div>
          <label className={labelCls}>RIB bancaire</label>
          <input className={inputCls} value={form.bank_iban || ''} onChange={e => set('bank_iban', e.target.value)} />
        </div>
        <div className="col-span-2">
          <label className={labelCls}>Salaire de base (MAD)</label>
          <input type="number" min={0} step={0.01} required className={inputCls} value={form.base_salary} onChange={e => set('base_salary', parseFloat(e.target.value) || 0)} />
        </div>
      </div>
      <div className="flex gap-2 justify-end pt-2 border-t border-border">
        <button type="button" onClick={onCancel} className="px-3 py-1.5 text-sm rounded-lg border border-border hover:bg-accent text-foreground">Annuler</button>
        <button type="submit" disabled={saving} className="px-4 py-1.5 text-sm rounded-lg bg-primary hover:bg-primary/90 text-white disabled:opacity-50">
          {saving ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
    </form>
  );
}

export default function EmployeesPage() {
  const { isSuperAdmin, isPaie, companyId: ctxCompanyId } = useAuth();
  const { showToast } = useToast();

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [saving, setSaving] = useState(false);
  const [showInactive, setShowInactive] = useState(false);

  const companyId = ctxCompanyId || '';

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await SupabaseEmployeesService.list();
      setEmployees(data);
    } catch (e) {
      showToast({ type: 'error', title: 'Erreur', message: String(e) });
    } finally {
      setIsLoading(false);
    }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  if (!isPaie && !isSuperAdmin) {
    return <div className="text-center py-12 text-muted-foreground">Accès réservé au rôle Paie.</div>;
  }

  const handleSave = async (data: Omit<Employee, 'id' | 'created_at' | 'updated_at'>) => {
    setSaving(true);
    try {
      if (editingEmployee) {
        await SupabaseEmployeesService.update(editingEmployee.id, data);
        showToast({ type: 'success', title: 'Modifié', message: `${data.full_name} mis à jour.` });
      } else {
        await SupabaseEmployeesService.create({ ...data, company_id: companyId });
        showToast({ type: 'success', title: 'Créé', message: `${data.full_name} ajouté.` });
      }
      setShowForm(false);
      setEditingEmployee(null);
      await load();
    } catch (e) {
      showToast({ type: 'error', title: 'Erreur', message: String(e) });
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivate = async (emp: Employee) => {
    if (!confirm(`Désactiver ${emp.full_name} ?`)) return;
    try {
      await SupabaseEmployeesService.deactivate(emp.id);
      showToast({ type: 'success', title: 'Désactivé', message: emp.full_name });
      await load();
    } catch (e) {
      showToast({ type: 'error', title: 'Erreur', message: String(e) });
    }
  };

  const handleReactivate = async (emp: Employee) => {
    try {
      await SupabaseEmployeesService.update(emp.id, { is_active: true });
      showToast({ type: 'success', title: 'Réactivé', message: emp.full_name });
      await load();
    } catch (e) {
      showToast({ type: 'error', title: 'Erreur', message: String(e) });
    }
  };

  const displayed = employees.filter(e => showInactive ? true : e.is_active);

  if (isLoading) {
    return <div className="flex items-center justify-center min-h-[40vh]"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;
  }

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold text-foreground">Employés</h1>
          <p className="text-xs text-muted-foreground">{employees.filter(e => e.is_active).length} actifs</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowInactive(v => !v)}
            className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${showInactive ? 'bg-secondary border-border text-foreground' : 'border-transparent text-muted-foreground hover:bg-accent'}`}
          >
            {showInactive ? 'Tous' : 'Actifs seulement'}
          </button>
          <button
            onClick={() => { setEditingEmployee(null); setShowForm(true); }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary hover:bg-primary/90 text-white rounded-lg"
          >
            <Plus className="h-3.5 w-3.5" /> Nouvel employé
          </button>
        </div>
      </div>

      {showForm && (
        <div className="glass rounded-lg p-4">
          <h2 className="text-sm font-semibold text-foreground mb-3">
            {editingEmployee ? `Modifier — ${editingEmployee.full_name}` : 'Nouvel employé'}
          </h2>
          <EmployeeForm
            initial={editingEmployee || {}}
            companyId={companyId}
            onSave={handleSave}
            onCancel={() => { setShowForm(false); setEditingEmployee(null); }}
            saving={saving}
          />
        </div>
      )}

      {displayed.length === 0 ? (
        <div className="glass rounded-lg p-12 text-center">
          <Users className="h-8 w-8 mx-auto text-muted-foreground/40 mb-2" />
          <p className="text-sm text-muted-foreground">Aucun employé trouvé.</p>
        </div>
      ) : (
        <div className="glass rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-secondary/30">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground">Nom</th>
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground">Poste</th>
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground">Département</th>
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground">Contrat</th>
                  <th className="px-4 py-2 text-left font-medium text-muted-foreground">CNSS</th>
                  <th className="px-4 py-2 text-right font-medium text-muted-foreground">Salaire base</th>
                  <th className="px-4 py-2 text-center font-medium text-muted-foreground">Statut</th>
                  <th className="px-4 py-2 text-center font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {displayed.map(emp => (
                  <tr key={emp.id} className={`hover:bg-accent/20 ${!emp.is_active ? 'opacity-50' : ''}`}>
                    <td className="px-4 py-2.5 font-medium text-foreground">{emp.full_name}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{emp.position || '—'}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{emp.department || '—'}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{emp.contract_type}</td>
                    <td className="px-4 py-2.5 font-mono text-muted-foreground">{emp.cnss_number || '—'}</td>
                    <td className="px-4 py-2.5 text-right font-mono font-semibold text-foreground">{fmt(emp.base_salary)} MAD</td>
                    <td className="px-4 py-2.5 text-center">
                      <span className={`inline-block text-[10px] font-bold px-1.5 py-0.5 rounded-full ${emp.is_active ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-secondary text-muted-foreground'}`}>
                        {emp.is_active ? 'Actif' : 'Inactif'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => { setEditingEmployee(emp); setShowForm(true); }} className="p-1 rounded hover:bg-accent" title="Modifier">
                          <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                        </button>
                        {emp.is_active ? (
                          <button onClick={() => handleDeactivate(emp)} className="p-1 rounded hover:bg-destructive/10" title="Désactiver">
                            <UserX className="h-3.5 w-3.5 text-muted-foreground" />
                          </button>
                        ) : (
                          <button onClick={() => handleReactivate(emp)} className="p-1 rounded hover:bg-emerald-500/10" title="Réactiver">
                            <UserCheckIcon className="h-3.5 w-3.5 text-muted-foreground" />
                          </button>
                        )}
                      </div>
                    </td>
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
