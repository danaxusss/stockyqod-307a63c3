import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Pencil, UserX, UserCheck as UserCheckIcon, Users } from 'lucide-react';
import { Employee } from '../../types';
import { SupabaseEmployeesService } from '../../utils/supabaseEmployees';
import { PayrollSettingsService } from '../../utils/supabasePayrollSettings';
import { hrLimitsFor, officialSettingsFor, type PayrollSettings } from '../../utils/payrollDefaults';
import { smigWarning, traineeIrEnd } from '../../utils/payrollCalc';
import { checkbox } from '../../components/backoffice/BackOfficeUi';
import { Notice } from './payrollUi';
import { EmployeeDeclarationFields } from './EmployeeDeclarationFields';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';
import { getCompanyContext } from '../../utils/supabaseCompanyFilter';
import { PageHeader } from '../../components/PageHeader';
import { StatusPill } from '../../components/lists/StatusPill';
import { btnPrimary, btnSecondary, EmptyState, field, fieldLabel, iconBtn, iconBtnDanger, LoadingState, panel, td, tdNum, th, theadRow, thRight } from '../../components/backoffice/BackOfficeUi';

function fmt(n: number) {
  return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2 }).format(n);
}

const CONTRACT_LABELS = { CDI: 'CDI', CDD: 'CDD', Interim: 'Intérim', Stage: 'Stage (ANAPEC)' };
const PAYMENT_LABELS: Record<string, string> = { virement: 'Virement', cheque: 'Chèque', especes: 'Espèces' };
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
  cimr_employer_rate: null,
  bank_iban: '',
  hire_date: '',
  base_salary: 0,
  is_active: true,
  matricule: '',
  mode_paiement: 'virement',
  date_sortie: null,
  stage_start_date: null,
  stage_cnss_exempt: null,
};

interface EmployeeFormProps {
  initial: Partial<Employee>;
  companyId: string;
  onSave: (data: Omit<Employee, 'id' | 'created_at' | 'updated_at'>) => Promise<void>;
  onCancel: () => void;
  saving: boolean;
  settings: PayrollSettings;
}

function EmployeeForm({ initial, companyId, onSave, onCancel, saving, settings }: EmployeeFormProps) {
  const [form, setForm] = useState<Omit<Employee, 'id' | 'created_at' | 'updated_at'>>({
    ...EMPTY_FORM,
    company_id: companyId,
    ...initial,
  });

  const set = (field: keyof typeof form, value: unknown) =>
    setForm(f => ({ ...f, [field]: value }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Empty optional fields are stored as null, not as empty strings.
    // Trainee fields only for a trainee; a trainee's CNSS setting defaults to on.
    const stage = form.contract_type === 'Stage'
      ? { stage_start_date: form.stage_start_date || null, stage_cnss_exempt: form.stage_cnss_exempt !== false }
      : { stage_start_date: null, stage_cnss_exempt: null };
    onSave({ ...form, ...stage, company_id: companyId, matricule: form.matricule?.trim() || null, date_sortie: form.date_sortie || null });
  };
  // Non-blocking: part-time contracts may pay less than the monthly SMIG.
  const smig = form.base_salary > 0 ? smigWarning(form.base_salary, settings, undefined, form.contract_type) : null;
  const stageStart = form.stage_start_date || form.hire_date;
  const stageYear = Number((stageStart || '').slice(0, 4)) || new Date().getFullYear();
  const stageLimits = hrLimitsFor(stageYear);

  const inputCls = field;
  const labelCls = fieldLabel;
  const legendCls = 'mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground';

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <fieldset>
        <legend className={legendCls}>Identité</legend>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2">
            <label className={labelCls} htmlFor="emp-full-name">Nom complet *</label>
            <input id="emp-full-name" required className={inputCls} value={form.full_name} onChange={e => set('full_name', e.target.value)} />
          </div>
          <div>
            <label className={labelCls} htmlFor="emp-matricule">Matricule</label>
            <input id="emp-matricule" className={`${inputCls} font-mono`} value={form.matricule || ''} onChange={e => set('matricule', e.target.value)} />
          </div>
          <div>
            <label className={labelCls} htmlFor="emp-cin">CIN</label>
            <input id="emp-cin" className={inputCls} value={form.cin || ''} onChange={e => set('cin', e.target.value)} />
          </div>
          <div>
            <label className={labelCls} htmlFor="emp-gender">Genre</label>
            <select id="emp-gender" className={inputCls} value={form.gender || ''} onChange={e => set('gender', e.target.value || undefined)}>
              <option value="">—</option>
              <option value="M">Homme</option>
              <option value="F">Femme</option>
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="emp-birth">Date de naissance</label>
            <input id="emp-birth" type="date" className={inputCls} value={form.birth_date || ''} onChange={e => set('birth_date', e.target.value || undefined)} />
          </div>
          <div>
            <label className={labelCls} htmlFor="emp-marital">Situation familiale</label>
            <select id="emp-marital" className={inputCls} value={form.marital_status || ''} onChange={e => set('marital_status', e.target.value as Employee['marital_status'] || undefined)}>
              <option value="">—</option>
              {Object.entries(MARITAL_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="emp-dependents">Nombre de personnes à charge</label>
            <input id="emp-dependents" type="number" min={0} max={6} className={inputCls} value={form.dependents_count} onChange={e => set('dependents_count', parseInt(e.target.value) || 0)} />
          </div>
        </div>
      </fieldset>

      <fieldset className="border-t border-border pt-4">
        <legend className={`${legendCls} float-left w-full`}>Poste</legend>
        <div className="clear-both grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className={labelCls} htmlFor="emp-position">Poste / Fonction</label>
            <input id="emp-position" className={inputCls} value={form.position || ''} onChange={e => set('position', e.target.value)} />
          </div>
          <div>
            <label className={labelCls} htmlFor="emp-department">Département</label>
            <input id="emp-department" className={inputCls} value={form.department || ''} onChange={e => set('department', e.target.value)} />
          </div>
          <div>
            <label className={labelCls} htmlFor="emp-contract">Type de contrat</label>
            <select id="emp-contract" className={inputCls} value={form.contract_type} onChange={e => set('contract_type', e.target.value as Employee['contract_type'])}>
              {Object.entries(CONTRACT_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="emp-hire">Date d'embauche</label>
            <input id="emp-hire" type="date" className={inputCls} value={form.hire_date || ''} onChange={e => set('hire_date', e.target.value || undefined)} />
          </div>
          <div>
            <label className={labelCls} htmlFor="emp-exit">Date de sortie</label>
            <input id="emp-exit" type="date" className={inputCls} value={form.date_sortie || ''} onChange={e => set('date_sortie', e.target.value || null)} />
          </div>
        </div>
      </fieldset>

      {form.contract_type === 'Stage' && (
        <fieldset className="border-t border-border pt-4" aria-label="Stage ANAPEC">
          <legend className={`${legendCls} float-left w-full`}>Stage (ANAPEC)</legend>
          <div className="clear-both grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className={labelCls} htmlFor="emp-stage-start">Début du stage</label>
              <input id="emp-stage-start" type="date" className={inputCls} value={form.stage_start_date || ''} placeholder={form.hire_date || ''} onChange={e => set('stage_start_date', e.target.value || null)} />
            </div>
            <div className="text-sm sm:col-span-3">
              <p className="text-foreground">{stageStart
                ? <>Exonération IR jusqu'au <b>{traineeIrEnd({ start_date: stageStart, ir_months: stageLimits.trainee_ir_months }).split('-').reverse().join('/')}</b> ({stageLimits.trainee_ir_months} mois), si l'indemnité mensuelle brute ne dépasse pas {stageLimits.trainee_ir_ceiling.toLocaleString('fr-FR')} MAD (au-delà, toute l'indemnité est imposée).</>
                : 'Saisissez la date de début (ou d\'embauche) pour voir la fin de l\'exonération IR.'}</p>
              <p className="text-xs text-muted-foreground">Stagiaire inscrit à l'ANAPEC, une seule exonération par stagiaire (CGI art. 57-16°). À déclarer dans l'état annuel des salaires.</p>
            </div>
            <label className="flex items-start gap-2 text-sm text-foreground sm:col-span-2 lg:col-span-4">
              <input type="checkbox" className={`${checkbox} mt-0.5`} checked={form.stage_cnss_exempt !== false} onChange={e => set('stage_cnss_exempt', e.target.checked)} />
              <span>Exonéré de CNSS (allocations familiales, prestations sociales) et de taxe de formation pendant {stageLimits.trainee_cnss_months} mois
                <span className="block text-xs text-muted-foreground">À confirmer avec la CNSS et le contrat d'insertion ANAPEC : règle non vérifiée dans un texte officiel. L'AMO reste calculée.</span></span>
            </label>
          </div>
        </fieldset>
      )}

      <fieldset className="border-t border-border pt-4">
        <legend className={`${legendCls} float-left w-full`}>Paie et organismes</legend>
        <div className="clear-both grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className={labelCls} htmlFor="emp-cnss">N° CNSS</label>
            <input id="emp-cnss" className={`${inputCls} font-mono`} value={form.cnss_number || ''} onChange={e => set('cnss_number', e.target.value)} />
          </div>
          <div>
            <label className={labelCls} htmlFor="emp-cimr">N° CIMR</label>
            <input id="emp-cimr" className={`${inputCls} font-mono`} value={form.cimr_number || ''} onChange={e => set('cimr_number', e.target.value)} />
          </div>
          <div>
            <label className={labelCls} htmlFor="emp-cimr-rate">Taux CIMR salarié (%)</label>
            <input id="emp-cimr-rate" type="number" min={0} max={20} step={0.01} className={`${inputCls} tabular-nums`} value={form.cimr_rate ?? 0} onChange={e => set('cimr_rate', parseFloat(e.target.value) || 0)} />
          </div>
          <div>
            <label className={labelCls} htmlFor="emp-cimr-er-rate">Taux CIMR patronal (%)</label>
            <input id="emp-cimr-er-rate" type="number" min={0} max={30} step={0.01} className={`${inputCls} tabular-nums`}
              placeholder={form.cimr_rate ? `${form.cimr_rate} (= salarié)` : ''} value={form.cimr_employer_rate ?? ''}
              onChange={e => set('cimr_employer_rate', e.target.value === '' ? null : parseFloat(e.target.value) || 0)} />
          </div>
          <div>
            <label className={labelCls} htmlFor="emp-payment">Mode de paiement</label>
            <select id="emp-payment" className={inputCls} value={form.mode_paiement || 'virement'} onChange={e => set('mode_paiement', e.target.value)}>
              {Object.entries(PAYMENT_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="emp-rib">RIB bancaire</label>
            <input id="emp-rib" className={`${inputCls} font-mono`} value={form.bank_iban || ''} onChange={e => set('bank_iban', e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls} htmlFor="emp-salary">{form.contract_type === 'Stage' ? 'Indemnité de stage mensuelle brute (MAD)' : 'Salaire de base (MAD)'}</label>
            <input id="emp-salary" type="number" min={0} step={0.01} required className={`${inputCls} tabular-nums`} value={form.base_salary} onChange={e => set('base_salary', parseFloat(e.target.value) || 0)} />
          </div>
          {smig && <Notice className="sm:col-span-2 lg:col-span-4">{smig}</Notice>}
        </div>
      </fieldset>

      <EmployeeDeclarationFields value={form} onChange={(k, v) => set(k, v)} />

      <div className="flex gap-2 border-t border-border pt-4 sm:justify-end">
        <button type="button" onClick={onCancel} className={`${btnSecondary} flex-1 sm:flex-none`}>Annuler</button>
        <button type="submit" disabled={saving} className={`${btnPrimary} flex-1 sm:flex-none`}>
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
  const [settings, setSettings] = useState<PayrollSettings>(officialSettingsFor(new Date().getFullYear()));

  const companyId = ctxCompanyId || '';

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [data, s] = await Promise.all([
        SupabaseEmployeesService.list(),
        // The form has no pay period: the minimum wage of the current year applies.
        PayrollSettingsService.get(new Date().getFullYear()).catch(() => officialSettingsFor(new Date().getFullYear())),
      ]);
      setEmployees(data); setSettings(s);
    } catch (e) {
      showToast({ type: 'error', title: 'Erreur', message: (e as any)?.message || String(e) });
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
      showToast({ type: 'error', title: 'Erreur', message: (e as any)?.message || String(e) });
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
      showToast({ type: 'error', title: 'Erreur', message: (e as any)?.message || String(e) });
    }
  };

  const handleReactivate = async (emp: Employee) => {
    try {
      await SupabaseEmployeesService.update(emp.id, { is_active: true });
      showToast({ type: 'success', title: 'Réactivé', message: emp.full_name });
      await load();
    } catch (e) {
      showToast({ type: 'error', title: 'Erreur', message: (e as any)?.message || String(e) });
    }
  };

  const displayed = employees.filter(e => showInactive ? true : e.is_active);

  if (isLoading) {
    return <LoadingState />;
  }

  const statusPill = (emp: Employee) => emp.is_active ? <StatusPill tone="success">Actif</StatusPill> : <StatusPill tone="neutral">Inactif</StatusPill>;
  const rowActions = (emp: Employee) => (
    <>
      <button onClick={() => { setEditingEmployee(emp); setShowForm(true); }} className={iconBtn} title="Modifier" aria-label={`Modifier ${emp.full_name}`}>
        <Pencil className="h-4 w-4" />
      </button>
      {emp.is_active ? (
        <button onClick={() => handleDeactivate(emp)} className={iconBtnDanger} title="Désactiver" aria-label={`Désactiver ${emp.full_name}`}>
          <UserX className="h-4 w-4" />
        </button>
      ) : (
        <button onClick={() => handleReactivate(emp)} className={`${iconBtn} hover:bg-emerald-500/10 hover:text-emerald-600`} title="Réactiver" aria-label={`Réactiver ${emp.full_name}`}>
          <UserCheckIcon className="h-4 w-4" />
        </button>
      )}
    </>
  );

  return (
    <div className="mx-auto max-w-[110rem]">
      <PageHeader
        title="Employés"
        subtitle={`${employees.filter(e => e.is_active).length} actifs`}
        actions={<>
          <button
            onClick={() => setShowInactive(v => !v)}
            aria-pressed={showInactive}
            className={`${btnSecondary} ${showInactive ? 'border-primary/40 text-primary' : ''}`}
          >
            {showInactive ? 'Tous' : 'Actifs seulement'}
          </button>
          <button
            onClick={() => { setEditingEmployee(null); setShowForm(true); }}
            className={btnPrimary}
          >
            <Plus className="h-4 w-4" /> Nouvel employé
          </button>
        </>}
      />

      {showForm && (
        <section className={`${panel} mb-4 border-primary/40`}>
          <h2 className="border-b border-border px-4 py-3 font-semibold text-foreground sm:px-5">
            {editingEmployee ? `Modifier — ${editingEmployee.full_name}` : 'Nouvel employé'}
          </h2>
          <div className="p-4 sm:p-5">
            <EmployeeForm
              initial={editingEmployee || {}}
              companyId={companyId}
              onSave={handleSave}
              onCancel={() => { setShowForm(false); setEditingEmployee(null); }}
              saving={saving}
              settings={settings}
            />
          </div>
        </section>
      )}

      {displayed.length === 0 ? (
        <div className={panel}>
          <EmptyState icon={Users} title="Aucun employé trouvé." />
        </div>
      ) : (
        <div className={`${panel} overflow-hidden`}>
          <ul className="divide-y divide-border md:hidden">
            {displayed.map(emp => (
              <li key={emp.id} className={`flex items-start gap-3 px-4 py-3 ${!emp.is_active ? 'opacity-60' : ''}`}>
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold uppercase text-primary" aria-hidden="true">
                  {emp.full_name.split(' ').map(w => w[0]).slice(0, 2).join('')}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate font-medium text-foreground">{emp.full_name}</p>
                    {statusPill(emp)}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">{[emp.position, emp.department, emp.contract_type].filter(Boolean).join(' · ')}</p>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="font-mono text-xs text-muted-foreground">{emp.cnss_number || '—'}</span>
                    <span className="text-sm font-semibold tabular-nums text-foreground">{fmt(emp.base_salary)} MAD</span>
                  </div>
                </div>
                <div className="-mr-2 flex shrink-0 flex-col">{rowActions(emp)}</div>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className={theadRow}>
                  <th className={th}>Nom</th>
                  <th className={th}>Poste</th>
                  <th className={th}>Département</th>
                  <th className={th}>Contrat</th>
                  <th className={th}>CNSS</th>
                  <th className={thRight}>Salaire base</th>
                  <th className={th}>Statut</th>
                  <th className={`${th} w-24`}><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {displayed.map(emp => (
                  <tr key={emp.id} className={`hover:bg-secondary/40 ${!emp.is_active ? 'opacity-60' : ''}`}>
                    <td className={`${td} font-medium text-foreground`}>{emp.full_name}</td>
                    <td className={`${td} text-muted-foreground`}>{emp.position || '—'}</td>
                    <td className={`${td} text-muted-foreground`}>{emp.department || '—'}</td>
                    <td className={`${td} text-muted-foreground`}>{emp.contract_type}</td>
                    <td className={`${td} font-mono text-xs text-muted-foreground`}>{emp.cnss_number || '—'}</td>
                    <td className={`${tdNum} font-semibold text-foreground`}>{fmt(emp.base_salary)} MAD</td>
                    <td className={td}>{statusPill(emp)}</td>
                    <td className={`${td} py-1.5`}>
                      <div className="flex items-center justify-end gap-0.5">{rowActions(emp)}</div>
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
