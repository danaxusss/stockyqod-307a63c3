import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { computePayroll, computeAnciennete, type PayrollResult } from '../../utils/payrollCalc';
import { PayrollSettingsService } from '../../utils/supabasePayrollSettings';
import { SupabaseEmployeesService } from '../../utils/supabaseEmployees';
import { DEFAULT_PAYROLL_SETTINGS, type PayrollSettings } from '../../utils/payrollDefaults';
import type { Employee } from '../../types';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';
import { PageHeader } from '../../components/PageHeader';
import { field, fieldAuto, fieldLabel, LoadingState, panel, Segmented } from '../../components/backoffice/BackOfficeUi';

function fmt(n: number) { return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n); }

export default function SimulationPage() {
  const { isPaie, isSuperAdmin } = useAuth();
  const { showToast } = useToast();
  const [settings, setSettings] = useState<PayrollSettings>(DEFAULT_PAYROLL_SETTINGS);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);

  const [mode, setMode] = useState<'brut' | 'net'>('brut');
  const [form, setForm] = useState({
    base_salary: '10000', anciennete_years: '0', primes_soumises: '0', heures_supp: '0',
    primes_non_soumises: '0', autres_retenues: '0', cimr_rate: '0', dependents_count: '0',
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, emps] = await Promise.all([
        PayrollSettingsService.get(new Date().getFullYear()).catch(() => DEFAULT_PAYROLL_SETTINGS),
        SupabaseEmployeesService.list().catch(() => []),
      ]);
      setSettings(s); setEmployees(emps.filter(e => e.is_active));
    } catch (e: any) { showToast({ type: 'error', message: e?.message || 'Erreur' }); }
    finally { setLoading(false); }
  }, [showToast]);
  useEffect(() => { load(); }, [load]);

  const num = (k: keyof typeof form) => Number(form[k]) || 0;

  // ancienneté amount derived from years × base (approx; on the base salary)
  const ancienneteAmount = useMemo(() => {
    const years = num('anciennete_years');
    let rate = 0;
    if (years >= 25) rate = 0.25; else if (years >= 20) rate = 0.20; else if (years >= 12) rate = 0.15; else if (years >= 5) rate = 0.10; else if (years >= 2) rate = 0.05;
    return Math.round(num('base_salary') * rate * 100) / 100;
  }, [form]);

  const result: PayrollResult = useMemo(() => {
    // In "net" mode, iterate base salary until net matches the target.
    if (mode === 'net') {
      const target = num('base_salary');
      let lo = 0, hi = target * 2 + 5000;
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        const rYears = num('anciennete_years');
        let rate = 0; if (rYears >= 25) rate = 0.25; else if (rYears >= 20) rate = 0.20; else if (rYears >= 12) rate = 0.15; else if (rYears >= 5) rate = 0.10; else if (rYears >= 2) rate = 0.05;
        const r = computePayroll({ base_salary: mid, anciennete_amount: Math.round(mid * rate * 100) / 100, primes_soumises: num('primes_soumises'), heures_supp: num('heures_supp'), primes_non_soumises: num('primes_non_soumises'), autres_retenues: num('autres_retenues'), cimr_rate: num('cimr_rate'), dependents_count: num('dependents_count'), settings });
        if (r.net_salary > target) hi = mid; else lo = mid;
      }
      const base = (lo + hi) / 2;
      const rYears = num('anciennete_years');
      let rate = 0; if (rYears >= 25) rate = 0.25; else if (rYears >= 20) rate = 0.20; else if (rYears >= 12) rate = 0.15; else if (rYears >= 5) rate = 0.10; else if (rYears >= 2) rate = 0.05;
      return computePayroll({ base_salary: Math.round(base * 100) / 100, anciennete_amount: Math.round(base * rate * 100) / 100, primes_soumises: num('primes_soumises'), heures_supp: num('heures_supp'), primes_non_soumises: num('primes_non_soumises'), autres_retenues: num('autres_retenues'), cimr_rate: num('cimr_rate'), dependents_count: num('dependents_count'), settings });
    }
    return computePayroll({ base_salary: num('base_salary'), anciennete_amount: ancienneteAmount, primes_soumises: num('primes_soumises'), heures_supp: num('heures_supp'), primes_non_soumises: num('primes_non_soumises'), autres_retenues: num('autres_retenues'), cimr_rate: num('cimr_rate'), dependents_count: num('dependents_count'), settings });
  }, [form, mode, settings, ancienneteAmount]);

  const loadEmployee = (id: string) => {
    const e = employees.find(x => x.id === id);
    if (!e) return;
    const years = e.hire_date ? Math.max(0, Math.floor((Date.now() - new Date(e.hire_date).getTime()) / (365.25 * 864e5))) : 0;
    setMode('brut');
    setForm(f => ({ ...f, base_salary: String(e.base_salary || 0), anciennete_years: String(years), cimr_rate: String(e.cimr_rate || 0), dependents_count: String(e.dependents_count || 0) }));
  };

  if (!isPaie && !isSuperAdmin) return <div className="py-12 text-center text-muted-foreground">Accès réservé au rôle Paie.</div>;
  if (loading) return <LoadingState />;

  const Field = ({ label, k, suffix }: { label: string; k: keyof typeof form; suffix?: string }) => (
    <div>
      <label className={fieldLabel}>{label}</label>
      <div className="relative">
        <input type="number" value={form[k]} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))}
          className={`${field} tabular-nums ${suffix ? 'pr-10' : ''}`} />
        {suffix && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{suffix}</span>}
      </div>
    </div>
  );

  const rows: [string, number, string?][] = [
    ['Salaire de base', num('base_salary')],
    ['Ancienneté', ancienneteAmount],
    ['Primes soumises', num('primes_soumises')],
    ['Heures supplémentaires', num('heures_supp')],
    ['Primes non soumises (exonérées)', num('primes_non_soumises')],
  ];

  const line = 'flex justify-between gap-4 px-4 py-2 sm:px-5';
  const group = 'px-4 pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:px-5';

  return (
    <div className="mx-auto max-w-[110rem]">
      <PageHeader title="Simulateur de paie" subtitle={`Brut → net, ou net → brut · barème ${settings.year || 'par défaut'}`} />

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* Inputs */}
        <section className={`${panel} space-y-4 p-4 sm:p-5`}>
          <div className="flex flex-wrap items-center gap-2">
            <Segmented<'brut' | 'net'> label="Mode de calcul" value={mode} onChange={setMode}
              options={[{ value: 'brut', label: 'Partir du brut' }, { value: 'net', label: 'Cibler un net' }]} />
            {employees.length > 0 && (
              <select onChange={e => e.target.value && loadEmployee(e.target.value)} defaultValue="" aria-label="Charger un employé"
                className={`${fieldAuto} w-full sm:ml-auto sm:w-auto`}>
                <option value="">Charger un employé…</option>
                {employees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
              </select>
            )}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={mode === 'net' ? 'Net cible (MAD)' : 'Salaire de base (MAD)'} k="base_salary" />
            <Field label="Ancienneté (années)" k="anciennete_years" suffix="ans" />
            <Field label="Primes soumises" k="primes_soumises" />
            <Field label="Heures supp. (montant)" k="heures_supp" />
            <Field label="Primes non soumises" k="primes_non_soumises" />
            <Field label="Autres retenues" k="autres_retenues" />
            <Field label="Taux CIMR" k="cimr_rate" suffix="%" />
            <Field label="Personnes à charge" k="dependents_count" />
          </div>
        </section>

        {/* Result */}
        <section className={`${panel} overflow-hidden lg:sticky lg:top-4`}>
          <div className="border-b border-border px-4 py-3 sm:px-5">
            <h2 className="font-semibold text-foreground">Décomposition</h2>
          </div>
          <div className="text-sm">
            <div className="pt-2">
              {rows.filter(r => r[1] !== 0 || r[0].startsWith('Salaire')).map(([l, v]) => (
                <div key={l} className={line}><span className="text-muted-foreground">{l}</span><span className="tabular-nums text-foreground">{fmt(v)}</span></div>
              ))}
            </div>
            <div className={`${line} mt-1 border-t border-border py-2.5 font-semibold text-foreground`}><span>Brut global</span><span className="tabular-nums">{fmt(result.brut_global)}</span></div>

            <div className={group}>Retenues salariales</div>
            <div className={line}><span className="text-muted-foreground">CNSS (part salariale)</span><span className="tabular-nums text-red-700 dark:text-red-300">-{fmt(result.cnss_employee)}</span></div>
            <div className={line}><span className="text-muted-foreground">AMO</span><span className="tabular-nums text-red-700 dark:text-red-300">-{fmt(result.amo_employee)}</span></div>
            {result.cimr_employee > 0 && <div className={line}><span className="text-muted-foreground">CIMR</span><span className="tabular-nums text-red-700 dark:text-red-300">-{fmt(result.cimr_employee)}</span></div>}
            <div className={line}><span className="text-muted-foreground">IR (net imposable {fmt(result.net_imposable)})</span><span className="tabular-nums text-red-700 dark:text-red-300">-{fmt(result.ir_amount)}</span></div>
            {result.autres_retenues > 0 && <div className={line}><span className="text-muted-foreground">Autres retenues</span><span className="tabular-nums text-red-700 dark:text-red-300">-{fmt(result.autres_retenues)}</span></div>}

            <div className={`${line} mt-2 bg-emerald-500/10 py-3 text-base font-bold text-emerald-700 dark:text-emerald-300`}><span>Net à payer</span><span className="tabular-nums">{fmt(result.net_salary)}</span></div>

            <div className={group}>Charges patronales</div>
            <div className={line}><span className="text-muted-foreground">CNSS patronale</span><span className="tabular-nums text-foreground">{fmt(result.cnss_employer)}</span></div>
            <div className={line}><span className="text-muted-foreground">AMO patronale</span><span className="tabular-nums text-foreground">{fmt(result.amo_employer)}</span></div>
            <div className={line}><span className="text-muted-foreground">Allocations familiales</span><span className="tabular-nums text-foreground">{fmt(result.alloc_familiales)}</span></div>
            <div className={line}><span className="text-muted-foreground">Taxe formation pro. (1,6 %)</span><span className="tabular-nums text-foreground">{fmt(result.tfp_employer)}</span></div>
            <div className={`${line} mt-1 border-t border-border bg-secondary/40 py-3 font-bold text-foreground`}><span>Coût total employeur</span><span className="tabular-nums">{fmt(result.employer_cost)}</span></div>
          </div>
        </section>
      </div>
    </div>
  );
}
