import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { computePayroll, seniorityRate, seniorityYears, type PayrollResult } from '../../utils/payrollCalc';
import { PayrollSettingsService } from '../../utils/supabasePayrollSettings';
import { SupabaseEmployeesService } from '../../utils/supabaseEmployees';
import { officialSettingsFor, type PayrollSettings } from '../../utils/payrollDefaults';
import { payrollYears, pct } from '../../utils/payrollFormat';
import type { Employee } from '../../types';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';
import { PageHeader } from '../../components/PageHeader';
import { field, fieldAuto, fieldLabel, LoadingState, panel, Segmented } from '../../components/backoffice/BackOfficeUi';

function fmt(n: number) { return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n); }

export default function SimulationPage() {
  const { isPaie, isSuperAdmin } = useAuth();
  const { showToast } = useToast();
  // The simulator has no pay period: the year to simulate is chosen.
  const [year, setYear] = useState(new Date().getFullYear());
  const [settings, setSettings] = useState<PayrollSettings>(officialSettingsFor(new Date().getFullYear()));
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
        PayrollSettingsService.get(year).catch(() => officialSettingsFor(year)),
        SupabaseEmployeesService.list().catch(() => []),
      ]);
      setSettings(s); setEmployees(emps.filter(e => e.is_active));
    } catch (e: any) { showToast({ type: 'error', message: e?.message || 'Erreur' }); }
    finally { setLoading(false); }
  }, [showToast, year]);
  useEffect(() => { load(); }, [load]);

  const num = (k: keyof typeof form) => Number(form[k]) || 0;

  // Seniority on the base salary, at the legal rates for the years entered.
  const ancRate = seniorityRate(num('anciennete_years'));
  const ancienneteAmount = Math.round(num('base_salary') * ancRate * 100) / 100;

  const common = {
    primes_soumises: num('primes_soumises'), heures_supp: num('heures_supp'), primes_non_soumises: num('primes_non_soumises'),
    autres_retenues: num('autres_retenues'), cimr_rate: num('cimr_rate'), dependents_count: num('dependents_count'), settings,
  };
  const result: PayrollResult = useMemo(() => {
    // In "net" mode, iterate base salary until net matches the target.
    if (mode === 'net') {
      const target = num('base_salary');
      let lo = 0, hi = target * 2 + 5000;
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        const r = computePayroll({ ...common, base_salary: mid, anciennete_amount: Math.round(mid * ancRate * 100) / 100 });
        if (r.net_salary > target) hi = mid; else lo = mid;
      }
      const base = (lo + hi) / 2;
      return computePayroll({ ...common, base_salary: Math.round(base * 100) / 100, anciennete_amount: Math.round(base * ancRate * 100) / 100 });
    }
    return computePayroll({ ...common, base_salary: num('base_salary'), anciennete_amount: ancienneteAmount });
  }, [form, mode, settings, ancienneteAmount, ancRate]);

  const loadEmployee = (id: string) => {
    const e = employees.find(x => x.id === id);
    if (!e) return;
    // Completed years at the end of the simulated year's current month.
    const now = new Date();
    const years = seniorityYears(e.hire_date, new Date(year, now.getMonth() + 1, 0));
    setMode('brut');
    setForm(f => ({ ...f, base_salary: String(e.base_salary || 0), anciennete_years: String(years), cimr_rate: String(e.cimr_rate || 0), dependents_count: String(e.dependents_count || 0) }));
  };

  if (!isPaie && !isSuperAdmin) return <div className="py-12 text-center text-muted-foreground">Accès réservé au rôle Paie.</div>;
  if (loading) return <LoadingState />;

  // A plain function, not a component: inputs keep focus while typing.
  const field2 = (label: string, k: keyof typeof form, suffix?: string) => (
    <div>
      <label className={fieldLabel}>{label}</label>
      <div className="relative">
        <input type="number" aria-label={label} value={form[k]} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))}
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
      <PageHeader title="Simulateur de paie" subtitle={`Brut → net, ou net → brut · paramètres ${year}`}
        actions={<select value={year} onChange={e => setYear(Number(e.target.value))} aria-label="Année" className={fieldAuto}>{payrollYears().map(y => <option key={y} value={y}>{y}</option>)}</select>} />

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
            {field2(mode === 'net' ? 'Net cible (MAD)' : 'Salaire de base (MAD)', "base_salary")}
            {field2("Ancienneté (années)", "anciennete_years", "ans")}
            {field2("Primes soumises", "primes_soumises")}
            {field2("Heures supp. (montant)", "heures_supp")}
            {field2("Primes non soumises", "primes_non_soumises")}
            {field2("Autres retenues", "autres_retenues")}
            {field2("Taux CIMR", "cimr_rate", "%")}
            {field2("Personnes à charge", "dependents_count")}
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
            <div className={line}><span className="text-muted-foreground">CNSS salariale ({pct(settings.cnss_rate_emp)} plafonné)</span><span className="tabular-nums text-red-700 dark:text-red-300">-{fmt(result.cnss_employee)}</span></div>
            <div className={line}><span className="text-muted-foreground">AMO ({pct(settings.amo_rate_emp)})</span><span className="tabular-nums text-red-700 dark:text-red-300">-{fmt(result.amo_employee)}</span></div>
            {result.cimr_employee > 0 && <div className={line}><span className="text-muted-foreground">CIMR</span><span className="tabular-nums text-red-700 dark:text-red-300">-{fmt(result.cimr_employee)}</span></div>}
            <div className={line}><span className="text-muted-foreground">IR (net imposable {fmt(result.net_imposable)})</span><span className="tabular-nums text-red-700 dark:text-red-300">-{fmt(result.ir_amount)}</span></div>
            {result.autres_retenues > 0 && <div className={line}><span className="text-muted-foreground">Autres retenues</span><span className="tabular-nums text-red-700 dark:text-red-300">-{fmt(result.autres_retenues)}</span></div>}

            <div className={`${line} mt-2 bg-emerald-500/10 py-3 text-base font-bold text-emerald-700 dark:text-emerald-300`}><span>Net à payer</span><span className="tabular-nums">{fmt(result.net_salary)}</span></div>

            <div className={group}>Charges patronales</div>
            <div className={line}><span className="text-muted-foreground">CNSS patronale ({pct(settings.cnss_rate_er)} plafonné)</span><span className="tabular-nums text-foreground">{fmt(result.cnss_employer)}</span></div>
            <div className={line}><span className="text-muted-foreground">AMO patronale ({pct(settings.amo_rate_er)})</span><span className="tabular-nums text-foreground">{fmt(result.amo_employer)}</span></div>
            <div className={line}><span className="text-muted-foreground">Allocations familiales ({pct(settings.af_rate)})</span><span className="tabular-nums text-foreground">{fmt(result.alloc_familiales)}</span></div>
            <div className={line}><span className="text-muted-foreground">Taxe formation pro. ({pct(settings.tfp_rate)})</span><span className="tabular-nums text-foreground">{fmt(result.tfp_employer)}</span></div>
            {result.cimr_employer > 0 && <div className={line}><span className="text-muted-foreground">CIMR patronale</span><span className="tabular-nums text-foreground">{fmt(result.cimr_employer)}</span></div>}
            <div className={`${line} mt-1 border-t border-border bg-secondary/40 py-3 font-bold text-foreground`}><span>Coût total employeur</span><span className="tabular-nums">{fmt(result.employer_cost)}</span></div>
          </div>
        </section>
      </div>
    </div>
  );
}
