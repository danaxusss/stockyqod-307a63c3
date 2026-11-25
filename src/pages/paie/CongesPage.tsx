import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { CalendarDays, Plus, Check, X, Trash2, Save } from 'lucide-react';
import { HolidayService, HrSettingsService, LeaveOpeningService, LeaveService, type LeaveRequest } from '../../utils/supabasePayrollHr';
import { PayrollRunService } from '../../utils/supabasePayrollRun';
import { SupabaseEmployeesService } from '../../utils/supabaseEmployees';
import { PayrollSettingsService } from '../../utils/supabasePayrollSettings';
import { leaveWorkingDays } from '../../utils/payrollCalc';
import { fixedCivilHolidays, isUnpaidLeave, leaveYear, RELIGIOUS_HOLIDAYS, type Holiday, type OpeningBalance } from '../../utils/hrLeave';
import type { Employee } from '../../types';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';
import { PageHeader, Panel } from '../../components/PageHeader';
import { payrollYears, MONTHS } from '../../utils/payrollFormat';
import { StatusPill } from '../../components/lists/StatusPill';
import { btnPrimary, btnSecondary, checkbox, EmptyState, field, fieldLabel, fieldSm, iconBtnDanger, LoadingState, panel } from '../../components/backoffice/BackOfficeUi';
import { Notice } from './payrollUi';

const TYPE_LABELS: Record<string, string> = {
  paye: 'Congé payé', maladie: 'Maladie', sans_solde: 'Sans solde', absence: 'Absence non justifiée', exceptionnel: 'Exceptionnel', autre: 'Autre',
};
const DAYS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const errMsg = (e: unknown) => (e instanceof Error ? e.message : (e as { message?: string })?.message || 'Échec');
const frDay = (s: string) => s.slice(0, 10).split('-').reverse().join('/');
const days1 = (n: number) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(n);
const EMPTY_FORM = { employee_id: '', type: 'paye', start_date: '', end_date: '', reason: '', pay_maintained: false };

export default function CongesPage() {
  const { isPaie, isSuperAdmin, currentUser } = useAuth();
  const { showToast } = useToast();
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [openings, setOpenings] = useState<OpeningBalance[]>([]);
  const [daysPerMonth, setDaysPerMonth] = useState(1.5);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [holidaysSaved, setHolidaysSaved] = useState(false);
  const [holidaysDirty, setHolidaysDirty] = useState(false);
  const [restDay, setRestDay] = useState(0);
  const [migrationMissing, setMigrationMissing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  // Balances, holidays and requests are for a leave year.
  const [year, setYear] = useState(new Date().getFullYear());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, emps, s, hol, hr, op] = await Promise.all([
        LeaveService.list(), SupabaseEmployeesService.list(), PayrollSettingsService.get(year).catch(() => null),
        HolidayService.forYear(year), HrSettingsService.get(), LeaveOpeningService.list(),
      ]);
      setRequests(r); setEmployees(emps.filter(e => e.is_active)); setOpenings(op);
      if (s) setDaysPerMonth(s.conges_days_per_month);
      setHolidays(hol.holidays); setHolidaysSaved(hol.saved); setHolidaysDirty(false);
      setRestDay(hr.weekly_rest_day);
      setMigrationMissing(hol.migrationMissing || hr.migrationMissing);
    } catch (e) { showToast({ type: 'error', message: errMsg(e) }); }
    finally { setLoading(false); }
  }, [showToast, year]);
  useEffect(() => { load(); }, [load]);

  const holidayDates = useMemo(() => holidays.filter(h => h.date).map(h => h.date), [holidays]);
  const rules = useMemo(() => ({ restDay, holidays: holidayDates }), [restDay, holidayDates]);

  // Balance at today for the current year, at 31 December for a past year.
  const asOf = useMemo(() => {
    const now = new Date();
    return year < now.getFullYear() ? new Date(year, 11, 31) : year > now.getFullYear() ? new Date(year, 0, 0) : now;
  }, [year]);
  const soldes = useMemo(() => employees.map(e => ({
    employee: e, ...leaveYear(e, year, asOf, { requests, openings, daysPerMonth }),
  })), [employees, requests, openings, daysPerMonth, year, asOf]);
  const balanceOf = (employeeId: string) => soldes.find(s => s.employee.id === employeeId)?.balance ?? 0;

  const yearRequests = requests.filter(r => r.start_date.slice(0, 4) === String(year) || r.end_date.slice(0, 4) === String(year));
  const formDays = form.start_date && form.end_date && form.end_date >= form.start_date ? leaveWorkingDays(form.start_date, form.end_date, rules) : 0;

  const submit = async () => {
    if (!form.employee_id || !form.start_date || !form.end_date) { showToast({ type: 'error', message: 'Employé et dates requis' }); return; }
    if (form.end_date < form.start_date) { showToast({ type: 'error', message: 'La date de fin précède la date de début.' }); return; }
    try {
      // A leave over two years counts each year's holidays.
      const dates = form.start_date.slice(0, 4) === form.end_date.slice(0, 4) && form.start_date.slice(0, 4) === String(year)
        ? holidayDates : await HolidayService.datesBetween(form.start_date, form.end_date);
      const days = leaveWorkingDays(form.start_date, form.end_date, { restDay, holidays: dates });
      await LeaveService.create({
        employee_id: form.employee_id, type: form.type as LeaveRequest['type'], start_date: form.start_date, end_date: form.end_date,
        days, reason: form.reason, approved_by: currentUser?.username || null, pay_maintained: form.type === 'maladie' && form.pay_maintained,
      });
      showToast({ type: 'success', message: `Demande enregistrée (${days} j ouvrables)` });
      setAdding(false); setForm(EMPTY_FORM); await load();
    } catch (e) { showToast({ type: 'error', message: errMsg(e) }); }
  };

  /** After a change to an unpaid leave, its months' open payslips follow. */
  const syncPayslips = async (r: LeaveRequest) => {
    if (!isUnpaidLeave(r)) return;
    const { updated, locked } = await PayrollRunService.syncLeaveAbsences(r.employee_id, r.start_date, r.end_date);
    if (updated.length) showToast({ type: 'info', message: `Bulletin(s) mis à jour : ${updated.map(p => `${MONTHS[p.period_month - 1]} ${p.period_year}`).join(', ')} (ligne d'absence et jours CNSS).` });
    if (locked.length) showToast({ type: 'warning', message: `Bulletin(s) déjà validé(s), non modifié(s) : ${locked.map(p => `${MONTHS[p.period_month - 1]} ${p.period_year}`).join(', ')}. Corrigez le mois suivant ou dévalidez le lot.` });
  };

  const setStatus = async (r: LeaveRequest, status: 'approved' | 'rejected') => {
    if (status === 'approved' && r.type === 'paye') {
      const bal = balanceOf(r.employee_id);
      if (Number(r.days) > bal && !confirm(`Cette demande (${days1(r.days)} j) dépasse le solde de congés (${days1(bal)} j). Approuver quand même ?`)) return;
    }
    try {
      const saved = await LeaveService.setStatus(r.id, status, currentUser?.username || null);
      await syncPayslips({ ...r, ...(saved || {}), status });
      await load();
    } catch (e) { showToast({ type: 'error', message: errMsg(e) }); }
  };

  const remove = async (r: LeaveRequest) => {
    if (!confirm('Supprimer cette demande ?')) return;
    try {
      await LeaveService.remove(r.id);
      if (r.status === 'approved') await syncPayslips({ ...r, status: 'rejected' });
      await load();
    } catch (e) { showToast({ type: 'error', message: errMsg(e) }); }
  };

  const setOpening = async (employeeId: string, value: string) => {
    try {
      await LeaveOpeningService.set(employeeId, year, value.trim() === '' ? null : Number(value.replace(',', '.')));
      setOpenings(await LeaveOpeningService.list());
    } catch (e) { showToast({ type: 'error', message: errMsg(e) }); }
  };

  const editHoliday = (i: number, patch: Partial<Holiday>) => { setHolidays(h => h.map((x, j) => (j === i ? { ...x, ...patch } : x))); setHolidaysDirty(true); };
  const addHoliday = (label = '', kind: Holiday['kind'] = 'religieux') => { setHolidays(h => [...h, { date: '', label, kind }]); setHolidaysDirty(true); };
  const removeHoliday = (i: number) => { setHolidays(h => h.filter((_, j) => j !== i)); setHolidaysDirty(true); };
  const saveHolidays = async () => {
    const bad = holidays.find(h => !h.date || !h.date.startsWith(String(year)) || !h.label.trim());
    if (bad) { showToast({ type: 'error', message: `Chaque jour férié doit avoir une date en ${year} et un libellé.` }); return; }
    try {
      await HolidayService.saveYear(year, [...holidays].sort((a, b) => a.date.localeCompare(b.date)));
      showToast({ type: 'success', message: `Jours fériés ${year} enregistrés` });
      await load();
    } catch (e) { showToast({ type: 'error', message: errMsg(e) }); }
  };
  const saveRestDay = async (d: number) => {
    setRestDay(d);
    try { await HrSettingsService.setRestDay(d); } catch (e) { showToast({ type: 'error', message: errMsg(e) }); }
  };

  if (!isPaie && !isSuperAdmin) return <div className="py-12 text-center text-muted-foreground">Accès réservé au rôle Paie.</div>;
  if (loading) return <LoadingState />;

  const yearPicker = (
    <select value={year} onChange={e => setYear(Number(e.target.value))} aria-label="Année" className="h-9 rounded-md border border-input bg-background px-2 text-sm">
      {payrollYears().map(y => <option key={y} value={y}>{y}</option>)}
    </select>
  );
  const missingReligious = RELIGIOUS_HOLIDAYS.filter(r => !holidays.some(h => h.label.startsWith(r.label)));

  return (
    <div className="mx-auto max-w-[110rem]">
      <PageHeader
        title="Congés"
        subtitle={`${days1(daysPerMonth)} j acquis / mois · repos hebdomadaire : ${DAYS[restDay].toLowerCase()}`}
        actions={<>{yearPicker}<button onClick={() => setAdding(v => !v)} aria-expanded={adding} className={btnPrimary}><Plus className="h-4 w-4" /> Demande</button></>}
      />

      {migrationMissing && <Notice className="mb-4">La base n'est pas à jour (migration 20261126150000_hr.sql) : les fêtes civiles par défaut et le dimanche sont utilisés, rien de ce bloc ne peut être enregistré.</Notice>}

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
          <div className="mt-3 space-y-2 text-xs text-muted-foreground">
            {formDays > 0 && <p>{formDays} jour(s) ouvrable(s) : hors {DAYS[restDay].toLowerCase()} et jours fériés.</p>}
            {form.type === 'maladie' && (
              <>
                <label className="flex items-center gap-2 text-foreground"><input type="checkbox" className={checkbox} checked={form.pay_maintained} onChange={e => setForm(f => ({ ...f, pay_maintained: e.target.checked }))} /> Salaire maintenu par l'employeur</label>
                <p>Sans maintien, les jours sont retirés de la paie comme une absence non payée (la CNSS verse les indemnités journalières) : aucun calcul automatique de ces indemnités.</p>
              </>
            )}
            {(form.type === 'sans_solde' || form.type === 'absence') && <p>Une fois approuvée : ligne d'absence sur le bulletin du mois (jours × salaire de base / 26) et jours CNSS réduits.</p>}
            {form.type === 'paye' && form.employee_id && <p>Solde actuel : {days1(balanceOf(form.employee_id))} j.</p>}
          </div>
        </section>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="min-w-0 space-y-4">
          <Panel title={`Soldes congés payés ${year}`}>
            {soldes.length === 0 ? <EmptyState title="Aucun employé actif" /> : (
              <ul className="divide-y divide-border">
                {soldes.map(s => (
                  <li key={s.employee.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">{s.employee.full_name}</span>
                      <span className="block text-xs text-muted-foreground">
                        Acquis {days1(s.entitlement.entitlement)} j ({s.entitlement.months} mois{s.entitlement.minorMonths ? `, dont ${s.entitlement.minorMonths} à 2 j` : ''}{s.entitlement.seniorityDays ? ` + ${days1(s.entitlement.seniorityDays)} j ancienneté` : ''}{s.entitlement.capped ? ', plafond 30 j' : ''}) · Report {days1(s.carry)} j · Pris {days1(s.taken)} j
                      </span>
                    </span>
                    <label className="shrink-0 text-xs text-muted-foreground" title="Solde d'ouverture de l'année (première année d'utilisation)">
                      <span className="sr-only">Report {year} de {s.employee.full_name}</span>
                      <input key={`${year}-${s.openingSet ? s.carry : 'auto'}`} type="number" step="0.5" className={`${fieldSm} w-20 text-right tabular-nums`} placeholder={days1(s.carry)} defaultValue={s.openingSet ? String(s.carry) : ''}
                        aria-label={`Report ${year} de ${s.employee.full_name}`} disabled={migrationMissing} onBlur={e => { if (e.target.value !== (s.openingSet ? String(s.carry) : '')) setOpening(s.employee.id, e.target.value); }} />
                    </label>
                    <span className="shrink-0 rounded-lg bg-secondary px-2.5 py-1 text-sm font-semibold tabular-nums text-foreground">{days1(s.balance)} j</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground sm:px-5">1,5 j par mois de service (2 j avant 18 ans) + 1,5 j par période de 5 ans d'ancienneté, 30 j ouvrables au plus. Le champ « report » fixe le solde d'ouverture de la première année ; ensuite le solde de l'année précédente est reporté.</p>
          </Panel>

          <Panel title={`Jours fériés ${year}`} action={<span className="flex items-center gap-2">
            <select value={restDay} onChange={e => saveRestDay(Number(e.target.value))} aria-label="Jour de repos hebdomadaire" disabled={migrationMissing} className="h-9 rounded-md border border-input bg-background px-2 text-sm">
              {DAYS.map((d, i) => <option key={i} value={i}>Repos : {d.toLowerCase()}</option>)}
            </select>
          </span>}>
            {!holidaysSaved && <p className="px-4 pt-3 text-xs text-muted-foreground sm:px-5">Fêtes civiles pré-remplies, non enregistrées.</p>}
            <ul className="divide-y divide-border">
              {holidays.map((h, i) => (
                <li key={i} className="flex items-center gap-2 px-4 py-2 sm:px-5">
                  <input type="date" value={h.date} onChange={e => editHoliday(i, { date: e.target.value })} aria-label="Date du jour férié" className={`${fieldSm} w-40`} />
                  <input value={h.label} onChange={e => editHoliday(i, { label: e.target.value })} aria-label="Libellé du jour férié" className={`${fieldSm} min-w-0 flex-1`} />
                  <StatusPill tone={h.kind === 'civil' ? 'neutral' : 'info'}>{h.kind === 'civil' ? 'Civil' : 'Religieux'}</StatusPill>
                  <button onClick={() => removeHoliday(i)} aria-label="Retirer le jour férié" className={iconBtnDanger}><Trash2 className="h-4 w-4" /></button>
                </li>
              ))}
            </ul>
            <div className="space-y-2 border-t border-border px-4 py-3 text-xs text-muted-foreground sm:px-5">
              <p>Fêtes religieuses : dates lunaires annoncées chaque année (observation du croissant). Ajoutez-les dès l'annonce officielle{missingReligious.length ? ' :' : '.'}</p>
              <div className="flex flex-wrap gap-1.5">
                {missingReligious.map(r => <button key={r.label} onClick={() => { for (let k = 0; k < r.days; k++) addHoliday(r.days > 1 ? `${r.label} (${k + 1}${k === 0 ? 'er' : 'e'} jour)` : r.label); }} className="rounded-md bg-secondary px-2 py-1 font-medium text-foreground hover:bg-secondary/70">+ {r.label}{r.days > 1 ? ` (${r.days} j)` : ''}</button>)}
                <button onClick={() => addHoliday('', 'civil')} className="rounded-md bg-secondary px-2 py-1 font-medium text-foreground hover:bg-secondary/70">+ Autre</button>
                {holidaysSaved && <button onClick={() => { setHolidays(fixedCivilHolidays(year)); setHolidaysDirty(true); }} className="rounded-md px-2 py-1 font-medium text-primary hover:bg-primary/10">Rétablir les fêtes civiles</button>}
              </div>
              {(holidaysDirty || !holidaysSaved) && <button onClick={saveHolidays} disabled={migrationMissing} className={btnSecondary}><Save className="h-4 w-4" /> Enregistrer les jours fériés {year}</button>}
            </div>
          </Panel>
        </div>

        <Panel title={`Demandes ${year}`}>
          {yearRequests.length === 0 ? <EmptyState icon={CalendarDays} title="Aucune demande" /> : (
            <ul className="divide-y divide-border">
              {yearRequests.map(r => (
                <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:flex-nowrap sm:px-5">
                  <span className="min-w-0 flex-1 basis-full sm:basis-auto">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground">{r.employee?.full_name || '—'}</span>
                      <StatusPill tone="neutral">{TYPE_LABELS[r.type] || r.type}</StatusPill>
                      {r.type === 'maladie' && <StatusPill tone={r.pay_maintained ? 'success' : 'warning'}>{r.pay_maintained ? 'Salaire maintenu' : 'Non payée'}</StatusPill>}
                    </span>
                    <span className="block text-xs tabular-nums text-muted-foreground">{frDay(r.start_date)} → {frDay(r.end_date)} · {days1(r.days)} j</span>
                  </span>
                  <span className="flex flex-1 items-center justify-end gap-1 sm:flex-none">
                    {r.status === 'pending' ? (
                      <>
                        <button onClick={() => setStatus(r, 'approved')} aria-label="Approuver" title="Approuver" className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300"><Check className="h-4 w-4" /></button>
                        <button onClick={() => setStatus(r, 'rejected')} aria-label="Refuser" title="Refuser" className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-red-500/10 text-red-700 hover:bg-red-500/20 dark:text-red-300"><X className="h-4 w-4" /></button>
                      </>
                    ) : r.status === 'approved' ? <StatusPill tone="success">Approuvé</StatusPill> : <StatusPill tone="danger">Refusé</StatusPill>}
                    <button onClick={() => remove(r)} aria-label="Supprimer la demande" title="Supprimer" className={iconBtnDanger}><Trash2 className="h-4 w-4" /></button>
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
