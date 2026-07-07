import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Calculator, Loader, Users } from 'lucide-react';
import { computePayroll, computeAnciennete, type PayrollResult } from '../../utils/payrollCalc';
import { PayrollSettingsService } from '../../utils/supabasePayrollSettings';
import { SupabaseEmployeesService } from '../../utils/supabaseEmployees';
import { DEFAULT_PAYROLL_SETTINGS, type PayrollSettings } from '../../utils/payrollDefaults';
import type { Employee } from '../../types';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';

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

  if (!isPaie && !isSuperAdmin) return <div className="text-center py-12 text-muted-foreground">Accès réservé au rôle Paie.</div>;
  if (loading) return <div className="flex items-center justify-center py-24 text-muted-foreground"><Loader className="h-5 w-5 animate-spin mr-2" />Chargement…</div>;

  const Field = ({ label, k, suffix }: { label: string; k: keyof typeof form; suffix?: string }) => (
    <div>
      <label className="block text-[11px] text-muted-foreground mb-1">{label}</label>
      <div className="relative">
        <input type="number" value={form[k]} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))}
          className="w-full px-2 py-1.5 text-sm rounded-lg bg-secondary border border-border focus:outline-none focus:ring-2 focus:ring-primary/30" />
        {suffix && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">{suffix}</span>}
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

  return (
    <div className="max-w-4xl mx-auto py-6 px-3">
      <div className="flex items-center gap-2 mb-4">
        <div className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-primary/10"><Calculator className="h-5 w-5 text-primary" /></div>
        <div>
          <h1 className="text-lg font-bold text-foreground leading-tight">Simulateur de paie</h1>
          <p className="text-xs text-muted-foreground">Brut → net, ou net → brut · barème {settings.year || 'par défaut'}</p>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {/* Inputs */}
        <div className="bg-card border border-border/60 rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-border overflow-hidden">
              <button onClick={() => setMode('brut')} className={`px-3 py-1.5 text-xs font-medium ${mode === 'brut' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'}`}>Partir du brut</button>
              <button onClick={() => setMode('net')} className={`px-3 py-1.5 text-xs font-medium ${mode === 'net' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'}`}>Cibler un net</button>
            </div>
            {employees.length > 0 && (
              <select onChange={e => e.target.value && loadEmployee(e.target.value)} defaultValue=""
                className="ml-auto text-xs px-2 py-1.5 rounded-lg bg-secondary border border-border">
                <option value="">Charger un employé…</option>
                {employees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
              </select>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label={mode === 'net' ? 'Net cible (MAD)' : 'Salaire de base (MAD)'} k="base_salary" />
            <Field label="Ancienneté (années)" k="anciennete_years" suffix="ans" />
            <Field label="Primes soumises" k="primes_soumises" />
            <Field label="Heures supp. (montant)" k="heures_supp" />
            <Field label="Primes non soumises" k="primes_non_soumises" />
            <Field label="Autres retenues" k="autres_retenues" />
            <Field label="Taux CIMR" k="cimr_rate" suffix="%" />
            <Field label="Personnes à charge" k="dependents_count" />
          </div>
        </div>

        {/* Result */}
        <div className="bg-card border border-border/60 rounded-xl overflow-hidden">
          <div className="px-4 py-2 bg-secondary/50 border-b border-border/60 text-sm font-semibold text-foreground">Décomposition</div>
          <div className="p-4 text-sm space-y-1">
            {rows.filter(r => r[1] !== 0 || r[0].startsWith('Salaire')).map(([l, v]) => (
              <div key={l} className="flex justify-between py-0.5"><span className="text-muted-foreground">{l}</span><span className="tabular-nums">{fmt(v)}</span></div>
            ))}
            <div className="flex justify-between py-1 border-t border-border/60 mt-1 font-semibold"><span>Brut global</span><span className="tabular-nums">{fmt(result.brut_global)}</span></div>

            <div className="pt-2 text-[11px] uppercase tracking-wide text-muted-foreground">Retenues salariales</div>
            <div className="flex justify-between py-0.5"><span className="text-muted-foreground">CNSS (part salariale)</span><span className="tabular-nums text-red-600 dark:text-red-400">-{fmt(result.cnss_employee)}</span></div>
            <div className="flex justify-between py-0.5"><span className="text-muted-foreground">AMO</span><span className="tabular-nums text-red-600 dark:text-red-400">-{fmt(result.amo_employee)}</span></div>
            {result.cimr_employee > 0 && <div className="flex justify-between py-0.5"><span className="text-muted-foreground">CIMR</span><span className="tabular-nums text-red-600 dark:text-red-400">-{fmt(result.cimr_employee)}</span></div>}
            <div className="flex justify-between py-0.5"><span className="text-muted-foreground">IR (net imposable {fmt(result.net_imposable)})</span><span className="tabular-nums text-red-600 dark:text-red-400">-{fmt(result.ir_amount)}</span></div>
            {result.autres_retenues > 0 && <div className="flex justify-between py-0.5"><span className="text-muted-foreground">Autres retenues</span><span className="tabular-nums text-red-600 dark:text-red-400">-{fmt(result.autres_retenues)}</span></div>}

            <div className="flex justify-between py-2 border-t-2 border-border mt-1 font-bold text-emerald-600 dark:text-emerald-400 text-base"><span>Net à payer</span><span className="tabular-nums">{fmt(result.net_salary)}</span></div>

            <div className="pt-2 text-[11px] uppercase tracking-wide text-muted-foreground">Charges patronales</div>
            <div className="flex justify-between py-0.5"><span className="text-muted-foreground">CNSS patronale</span><span className="tabular-nums">{fmt(result.cnss_employer)}</span></div>
            <div className="flex justify-between py-0.5"><span className="text-muted-foreground">AMO patronale</span><span className="tabular-nums">{fmt(result.amo_employer)}</span></div>
            <div className="flex justify-between py-0.5"><span className="text-muted-foreground">Allocations familiales</span><span className="tabular-nums">{fmt(result.alloc_familiales)}</span></div>
            <div className="flex justify-between py-0.5"><span className="text-muted-foreground">Taxe formation pro. (1,6 %)</span><span className="tabular-nums">{fmt(result.tfp_employer)}</span></div>
            <div className="flex justify-between py-2 border-t border-border/60 mt-1 font-bold"><span>Coût total employeur</span><span className="tabular-nums">{fmt(result.employer_cost)}</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}
