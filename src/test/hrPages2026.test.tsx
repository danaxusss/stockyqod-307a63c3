// The HR pages on the in-memory database: final settlement, leave and
// holidays, certificates, advances, the run's "payé" / "dévalider", the
// trainee block of the employee form, and the screens before the HR
// migration has been run. Plus the text of the HR PDFs.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeDb, fakeClient, type FakeDb } from './fakeSupabase';

const state = vi.hoisted(() => ({ db: null as unknown as FakeDb }));
vi.mock('../utils/supabaseClient', () => ({ get supabase() { return fakeClient(state.db); } }));
vi.mock('../integrations/supabase/client', () => ({ get supabase() { return fakeClient(state.db); } }));
vi.mock('@/integrations/supabase/client', () => ({ get supabase() { return fakeClient(state.db); } }));
vi.mock('../utils/supabaseCompanyFilter', () => ({
  getCompanyContext: () => ({ companyId: 'c1', bypassFilter: true, isSuperAdmin: true, isCompta: false }),
}));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ isPaie: true, isSuperAdmin: false, companyId: 'c1', currentUser: { username: 'rh' } }) }));
const showToast = vi.hoisted(() => vi.fn());
vi.mock('../context/ToastContext', () => ({ useToast: () => ({ showToast }) }));
vi.mock('../utils/companySettings', () => ({ CompanySettingsService: { getSettings: vi.fn(async () => ({ company_name: 'Atlas SARL', address: '12 Bd Zerktouni, 20000 Casablanca', ice: '001234567000089', rc: '12345', if_number: '998877', cnss: '7654321' })) } }));

import StcPage from '../pages/paie/StcPage';
import CongesPage from '../pages/paie/CongesPage';
import AttestationsPage from '../pages/paie/AttestationsPage';
import AvancesPage from '../pages/paie/AvancesPage';
import PayrollRunPage from '../pages/paie/PayrollRunPage';
import EmployeesPage from '../pages/paie/EmployeesPage';
import { buildCertificatePdf, buildStcReceiptPdf } from '../utils/hrPdf';
import type { Employee } from '../types';

let seq = 0;
const withIds = (extra?: FakeDb['failWrite']): FakeDb['failWrite'] => (table, op, payload) => {
  if (op === 'insert') for (const r of (Array.isArray(payload) ? payload : [payload]) as Record<string, unknown>[]) if (r && r.id == null) { r.id = `${table}-${++seq}`; r.created_at ??= new Date(1700000000000 + seq).toISOString(); }
  return extra?.(table, op, payload);
};
const HR_TABLES = ['public_holidays', 'payroll_hr_settings', 'leave_opening_balances', 'payroll_stc', 'hr_documents'];
const missing = (table: string) => (HR_TABLES.includes(table) ? `Could not find the table 'public.${table}' in the schema cache` : undefined);
const money = (n: string) => new RegExp(n.replace(/ /g, '[\\s\\u202f\\u00a0]'));

const ali = { id: 'ali', company_id: 'c1', full_name: 'Ali Amrani', dependents_count: 2, contract_type: 'CDI', base_salary: 8500, is_active: true, hire_date: '2019-09-01', position: 'Magasinier', cin: 'BK123456', gender: 'M', cnss_number: '112233445' };

beforeEach(() => {
  state.db = createFakeDb({
    employees: [{ ...ali }], payslips: [], payslip_variables: [], payslip_items: [], payroll_settings: [], payroll_rubriques: [], payroll_runs: [],
    payroll_cumuls: [], employee_loans: [], leave_requests: [], public_holidays: [], payroll_hr_settings: [], leave_opening_balances: [],
    payroll_stc: [], hr_documents: [], journal_entries: [],
  });
  state.db.failWrite = withIds();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => { vi.restoreAllMocks(); showToast.mockReset(); vi.useRealTimers(); });

/** 12 validated months Nov 2025 – Oct 2026 at 8,500 + 850 + 200 = 9,550. */
const seedPayslips = () => {
  for (let k = 0; k < 12; k++) {
    const year = k < 2 ? 2025 : 2026;
    const month = k < 2 ? 11 + k : k - 1;
    state.db.tables.payslips.push({ id: `ref-${k}`, company_id: 'c1', employee_id: 'ali', period_month: month, period_year: year, payslip_number: `PAIE-${year}-0${k}`, base_salary: 8500, anciennete_amount: 850, total_gross: 9550, net_salary: 8400 + k, ir_amount: 300, frais_pro: 2387.5, cnss_employee: 268.8, amo_employee: 215.83, cimr_employee: 0, net_taxable: 6677.87, is_locked: true, run_id: null, created_at: String(k) });
    state.db.tables.payslip_variables.push({ id: `v-${k}`, payslip_id: `ref-${k}`, code: 'PRIME_REND', label: 'Prime', type: 'gain', amount: 200, soumis_cnss: true, soumis_amo: true, soumis_ir: true, sort_order: 0 });
  }
};

describe('solde de tout compte', () => {
  const fill = async () => {
    render(<MemoryRouter><StcPage /></MemoryRouter>);
    fireEvent.change(await screen.findByLabelText('Employé'), { target: { value: 'ali' } });
    fireEvent.change(screen.getByLabelText('Date de sortie (dernier jour)'), { target: { value: '2026-11-30' } });
    fireEvent.change(screen.getByLabelText('Congés non pris (jours)'), { target: { value: '12' } });
  };

  it('shows each element with its tax treatment, the hand-computed net, and what is not due', async () => {
    seedPayslips();
    state.db.tables.employee_loans.push({ id: 'l1', company_id: 'c1', employee_id: 'ali', amount: 1500, remaining: 1000, monthly_installment: 250, start_month: 1, start_year: 2026, active: true, created_at: '1' });
    await fill();
    const table = (await screen.findByText('Indemnité de licenciement')).closest('table')!;
    expect(within(table).getByText(money('40 200,00'))).toBeTruthy();
    expect(within(table).getByText(money('19 100,00'))).toBeTruthy();
    expect(within(table).getAllByText(/1\s000\s000,00 MAD pour l'ensemble des indemnités de rupture/).length).toBeGreaterThan(0);
    // 62,725.68 (hrEngine2026: 7 years 3 months, reference 9,550, 2 months notice, 12 days, 1,000 loan)
    expect(screen.getByText(money('62 725,68 MAD'))).toBeTruthy();
    expect(screen.getByText(/Calculé comme un bulletin final séparé du mois de sortie/)).toBeTruthy();
    expect(screen.getByText(/moyenne de 12 bulletin\(s\) validé\(s\)/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Motif'), { target: { value: 'faute_grave' } });
    expect(await screen.findAllByText('non due : faute grave')).toHaveLength(2);
    expect((screen.getByLabelText('Préavis payé (mois)') as HTMLInputElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Motif'), { target: { value: 'demission' } });
    expect(await screen.findByText('non due : dû par le salarié, non payé')).toBeTruthy();
  });

  it('validates into a final payslip and deactivates the employee; the validation can be undone', async () => {
    seedPayslips();
    await fill();
    await screen.findByText('Indemnité de licenciement');
    fireEvent.click(screen.getByText('Valider le solde'));
    await waitFor(() => expect(state.db.tables.payroll_stc[0]?.status).toBe('validated'));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/bulletin final/));
    expect(state.db.tables.employees[0]).toMatchObject({ is_active: false, date_sortie: '2026-11-30' });
    const slip = state.db.tables.payslips.find(p => p.id === state.db.tables.payroll_stc[0].payslip_id)!;
    expect(slip).toMatchObject({ is_locked: true, period_month: 11 });
    expect(await screen.findByText('Annuler la validation')).toBeTruthy();
    fireEvent.click(screen.getByText('Annuler la validation'));
    await waitFor(() => expect(state.db.tables.payroll_stc[0].status).toBe('reversed'));
    expect(state.db.tables.employees[0]).toMatchObject({ is_active: true, date_sortie: null });
  });

  it('before the migration: computes, but cannot save or validate', async () => {
    state.db.failRead = missing;
    state.db.failWrite = withIds(missing);
    await fill();
    expect(await screen.findByText(/La base n'est pas à jour \(migration 20261126150000_hr\.sql\)/)).toBeTruthy();
    await screen.findByText('Indemnité de licenciement');
    expect((screen.getByText('Valider le solde').closest('button') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText('Enregistrer le brouillon').closest('button') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('congés et jours fériés', () => {
  it('pre-fills the civil holidays, counts working days around them, warns above the balance', async () => {
    state.db.tables.leave_requests.push({ id: 'r1', company_id: 'c1', employee_id: 'ali', employee: { full_name: 'Ali Amrani' }, type: 'paye', status: 'pending', start_date: '2026-12-01', end_date: '2026-12-31', days: 40 });
    render(<MemoryRouter><CongesPage /></MemoryRouter>);
    expect(await screen.findByDisplayValue('Marche Verte')).toBeTruthy();
    expect(screen.getByText('Fêtes civiles pré-remplies, non enregistrées.')).toBeTruthy();
    expect(screen.getByText(/ajoutez-les dès l'annonce officielle/i)).toBeTruthy();
    fireEvent.click(screen.getByText('Demande'));
    fireEvent.change(screen.getByLabelText('Du'), { target: { value: '2026-11-05' } });
    fireEvent.change(screen.getByLabelText('Au'), { target: { value: '2026-11-09' } });
    // Thu 5, Sat 7, Mon 9 (Fri 6 Marche Verte, Sun 8 rest)
    expect(screen.getByText(/^3 jour\(s\) ouvrable\(s\)/)).toBeTruthy();
    vi.mocked(window.confirm).mockReturnValue(false);
    fireEvent.click(screen.getByLabelText('Approuver'));
    await waitFor(() => expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/dépasse le solde de congés/)));
    expect(state.db.tables.leave_requests[0].status).toBe('pending');
  });

  it('saves the year\'s holidays, religious ones included', async () => {
    render(<MemoryRouter><CongesPage /></MemoryRouter>);
    await screen.findByDisplayValue('Marche Verte');
    fireEvent.click(screen.getByText('+ Aïd Al Fitr (2 j)'));
    const dates = screen.getAllByLabelText('Date du jour férié');
    fireEvent.change(dates[dates.length - 2], { target: { value: '2026-03-20' } });
    fireEvent.change(dates[dates.length - 1], { target: { value: '2026-03-21' } });
    fireEvent.click(screen.getByText(/Enregistrer les jours fériés/));
    await waitFor(() => expect(state.db.tables.public_holidays).toHaveLength(13));
    expect(state.db.tables.public_holidays.filter(h => h.kind === 'religieux').map(h => h.holiday_date)).toEqual(['2026-03-20', '2026-03-21']);
  });

  it('before the migration: works on the defaults and says what cannot be saved', async () => {
    state.db.failRead = missing;
    render(<MemoryRouter><CongesPage /></MemoryRouter>);
    expect(await screen.findByText(/les fêtes civiles par défaut et le dimanche sont utilisés/)).toBeTruthy();
    expect(screen.getByDisplayValue('Marche Verte')).toBeTruthy();
    expect(screen.getAllByText(/Ali Amrani/).length).toBeGreaterThan(0);
  });
});

describe('attestations', () => {
  it('salary attestation: gross and net of the last 3 validated payslips and the year\'s figures', async () => {
    seedPayslips();
    render(<MemoryRouter><AttestationsPage /></MemoryRouter>);
    fireEvent.change(await screen.findByLabelText('Employé'), { target: { value: 'ali' } });
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'attestation_salaire' } });
    const doc = await screen.findByLabelText('Texte du document');
    // August, September, October 2026 (net 8,409 / 8,410 / 8,411)
    await waitFor(() => expect(within(doc).getByText('Octobre 2026')).toBeTruthy());
    expect(within(doc).getByText('Août 2026')).toBeTruthy();
    expect(within(doc).getByText(money('8 411,00'))).toBeTruthy();
    // 2026: 10 months × 9,550 = 95,500 gross
    expect(within(doc).getByText(money('95 500,00'))).toBeTruthy();
    expect(within(doc).getByText(/est employé au sein de notre société depuis le 01\/09\/2019, en qualité de Magasinier/)).toBeTruthy();
  });

  it('work certificate: needs the exit date, states entry, exit and position', async () => {
    render(<MemoryRouter><AttestationsPage /></MemoryRouter>);
    fireEvent.change(await screen.findByLabelText('Employé'), { target: { value: 'ali' } });
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'certificat_travail' } });
    expect(await screen.findByText(/Saisissez la date de sortie/)).toBeTruthy();
    expect((screen.getByText('Générer le PDF').closest('button') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Date de sortie'), { target: { value: '2026-11-30' } });
    expect(await screen.findByText(/a été employé dans notre société du 01\/09\/2019 au 30\/11\/2026/)).toBeTruthy();
    expect(screen.getByText('Poste(s) occupé(s) : Magasinier.')).toBeTruthy();
  });
});

describe('advances', () => {
  it('start in the month after the validated one and can be edited before any repayment', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 25));
    state.db.tables.payroll_runs.push({ id: 'run-nov', company_id: 'c1', period_month: 11, period_year: 2026, status: 'validated', total_net: 0, employer_cost: 0 });
    state.db.tables.employee_loans.push(
      { id: 'l1', company_id: 'c1', employee_id: 'ali', employee: { full_name: 'Ali Amrani' }, label: 'Avance', kind: 'avance', amount: 2000, remaining: 2000, monthly_installment: 500, start_month: 12, start_year: 2026, active: true, created_at: '1' },
      { id: 'l2', company_id: 'c1', employee_id: 'ali', employee: { full_name: 'Ali Amrani' }, label: 'Prêt', kind: 'pret', amount: 6000, remaining: 4000, monthly_installment: 1000, start_month: 1, start_year: 2026, active: true, created_at: '2' },
    );
    render(<MemoryRouter><AvancesPage /></MemoryRouter>);
    fireEvent.click(await screen.findByText('Avance / prêt'));
    expect((screen.getByLabelText('1re retenue') as HTMLSelectElement).value).toBe('12');
    expect(screen.getByText('Novembre (validé)')).toBeTruthy();
    // Only the advance with nothing repaid has "Modifier" (one per layout: phone list and table).
    expect(screen.getAllByLabelText('Modifier')).toHaveLength(2);
    fireEvent.click(screen.getAllByLabelText('Modifier')[0]);
    fireEvent.change(screen.getByLabelText('Montant'), { target: { value: '2400' } });
    fireEvent.click(screen.getByLabelText('Enregistrer l\'avance ou le prêt'));
    await waitFor(() => expect(state.db.tables.employee_loans[0]).toMatchObject({ amount: 2400, remaining: 2400 }));
  });
});

describe('payroll run: paid and un-validated', () => {
  it('marks a validated run as paid, and reopens a validated run after confirmation', async () => {
    state.db.tables.payroll_runs.push({ id: 'r1', company_id: 'c1', period_month: 10, period_year: 2026, status: 'validated', total_net: 0, employer_cost: 0, total_gross: 0, total_cnss: 0, total_ir: 0, journal_entry_id: null });
    state.db.tables.payslips.push({ id: 'p1', company_id: 'c1', employee_id: 'ali', employee: ali, run_id: 'r1', period_month: 10, period_year: 2026, payslip_number: 'PAIE-1', base_salary: 8500, total_gross: 8500, net_salary: 8000, is_locked: true, loan_repayments: [] });
    render(<MemoryRouter><PayrollRunPage /></MemoryRouter>);
    fireEvent.click(await screen.findByText('Octobre 2026'));
    expect(await screen.findByText(/statut validé/)).toBeTruthy();
    fireEvent.click(screen.getAllByText('Dévalider')[0]);
    await waitFor(() => expect(state.db.tables.payroll_runs[0].status).toBe('draft'));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/Dévalider la paie d'Octobre|Dévalider la paie de Octobre/));
    expect(state.db.tables.payslips[0].is_locked).toBe(false);

    state.db.tables.payroll_runs[0].status = 'validated';
    state.db.tables.payslips[0].is_locked = true;
    fireEvent.click(screen.getByLabelText('Retour aux lots de paie'));
    fireEvent.click(await screen.findByText('Octobre 2026'));
    fireEvent.click((await screen.findAllByText('Marquer comme payé'))[0]);
    fireEvent.change(screen.getByLabelText('Date de paiement'), { target: { value: '2026-11-03' } });
    fireEvent.change(screen.getByLabelText('Mode'), { target: { value: 'cheque' } });
    fireEvent.click(screen.getByText('Confirmer le paiement'));
    await waitFor(() => expect(state.db.tables.payroll_runs[0]).toMatchObject({ status: 'paid', paid_at: '2026-11-03', payment_mode: 'cheque' }));
    expect(await screen.findByText(/statut payé le 03\/11\/2026 \(chèque\)/)).toBeTruthy();
    expect(screen.queryByText('Dévalider')).toBeNull();
  });
});

describe('employee form: trainee', () => {
  it('shows the trainee block with the end of the IR exemption and the CNSS setting to confirm', async () => {
    render(<MemoryRouter><EmployeesPage /></MemoryRouter>);
    fireEvent.click(await screen.findByText('Nouvel employé'));
    fireEvent.change(screen.getByLabelText('Type de contrat'), { target: { value: 'Stage' } });
    fireEvent.change(screen.getByLabelText('Début du stage'), { target: { value: '2026-03-01' } });
    expect(screen.getByText(/Exonération IR jusqu'au/).textContent).toMatch(/28\/02\/2027 \(12 mois\)/);
    expect(screen.getByText(/À confirmer avec la CNSS et le contrat d'insertion ANAPEC/)).toBeTruthy();
    expect(screen.getByLabelText('Indemnité de stage mensuelle brute (MAD)')).toBeTruthy();
    // No SMIG warning for an internship allowance.
    fireEvent.change(screen.getByLabelText('Indemnité de stage mensuelle brute (MAD)'), { target: { value: '2000' } });
    expect(screen.queryByText(/sous le SMIG/)).toBeNull();
    fireEvent.change(screen.getByLabelText('Nom complet *'), { target: { value: 'Sara Stagiaire' } });
    fireEvent.click(screen.getByText('Enregistrer'));
    await waitFor(() => expect(state.db.tables.employees.find(e => e.full_name === 'Sara Stagiaire')).toMatchObject({ contract_type: 'Stage', stage_start_date: '2026-03-01', stage_cnss_exempt: true }));
  });
});

describe('trainee payslip screen', () => {
  it('explains why no IR is withheld and that the CNSS setting is to confirm; no SMIG warning', async () => {
    const sara = { id: 'sara', company_id: 'c1', full_name: 'Sara Stagiaire', dependents_count: 0, contract_type: 'Stage', base_salary: 4000, is_active: true, hire_date: '2026-03-01', stage_cnss_exempt: true };
    state.db.tables.employees.push(sara);
    state.db.tables.payslips.push({ id: 'ps', company_id: 'c1', employee_id: 'sara', employee: sara, period_month: 11, period_year: 2026, payslip_number: 'PAIE-2026-050', hours_worked: 191, base_salary: 4000, total_gross: 0, is_locked: false, run_id: null, cnss_days: 26 });
    const { default: PayslipDetailPage } = await import('../pages/paie/PayslipDetailPage');
    const { Route, Routes } = await import('react-router-dom');
    render(<MemoryRouter initialEntries={['/paie/bulletins/ps']}><Routes><Route path="/paie/bulletins/:id" element={<PayslipDetailPage />} /></Routes></MemoryRouter>);
    expect(await screen.findByText(/Stagiaire ANAPEC : indemnité exonérée d'IR jusqu'à 6\s000,00 MAD par mois, jusqu'au 28\/02\/2027/)).toBeTruthy();
    expect(screen.getByText(/à confirmer avec la CNSS \/ le contrat ANAPEC/)).toBeTruthy();
    expect(screen.getByText(/\(exonéré : stagiaire\)/)).toBeTruthy();
    expect(screen.queryByText(/sous le SMIG/)).toBeNull();
    // 4,000 − AMO 90.40 = 3,909.60 (hrEngine2026)
    expect(screen.getAllByText(money('3 909,60 MAD')).length).toBeGreaterThan(0);
  });
});

describe('HR PDFs', () => {
  const text = (blob: Blob) => new Promise<string>((resolve, reject) => { const fr = new FileReader(); fr.onload = () => resolve(String(fr.result)); fr.onerror = reject; fr.readAsText(blob, 'iso-8859-1'); });
  const company = { company_name: 'Atlas SARL', address: '12 Bd Zerktouni, 20000 Casablanca', ice: '001234567000089', rc: '12345', if_number: '998877', cnss: '7654321' } as never;

  it('the settlement receipt: number, identifiers, net in words, the 60-day mention', async () => {
    const { doc } = buildStcReceiptPdf(ali as Employee, company, {
      number: 'STC-2026-001', provisional: false, motifLabel: 'Licenciement', exitDate: '2026-11-30', service: '7 ans 3 mois 0 jour',
      elements: [{ label: 'Indemnité de licenciement', amount: 40200, due: true, detail: '804 h' }, { label: 'Indemnité de préavis', amount: 0, due: false, detail: 'non due : faute grave' }],
      deductions: [{ label: 'CNSS', amount: 268.8 }], gross: 73057.69, netToPay: 62725.68, issuedOn: '2026-11-30',
    });
    // Text lines are wrapped: compare the words, not the layout.
    const t = (await text(doc.output('blob'))).replace(/\) Tj\s*(ET\s*BT[^(]*)?\(|\)\s*'?\s*T\*\s*\(|\)\]\s*TJ[^(]*\[\(/g, ' ');
    expect(t).toContain('STC-2026-001');
    expect(t).toContain('ICE : 001234567000089');
    expect(t).toContain('REÇU POUR SOLDE DE TOUT COMPTE');
    expect(t).toContain('soixante \\(60\\) jours');
    expect(t).toContain('62 725,68');
    expect(t).toMatch(/Indemnité de préavis : non due : faute grave/);
  });

  it('certificates: their own wording and a reference number', async () => {
    const t = await text(buildCertificatePdf(ali as Employee, company, { kind: 'certificat_travail', number: 'CT-2026-001', provisional: false, issuedOn: '2026-11-30', exitDate: '2026-11-30' }).doc.output('blob'));
    expect(t).toContain('CERTIFICAT DE TRAVAIL');
    expect(t).toContain('CT-2026-001');
    expect(t).toMatch(/a été employé dans notre société du 01\/09\/2019 au/);
    expect(t).not.toMatch(/est employé au sein/);
    const a = await text(buildCertificatePdf(ali as Employee, company, { kind: 'attestation_travail', number: 'ATT-2026-001', provisional: true, issuedOn: '2026-11-30' }).doc.output('blob'));
    expect(a).toContain('ATTESTATION DE TRAVAIL');
    expect(a).toContain('PROVISOIRE');
    expect(a).toMatch(/est employé au sein de notre société/);
  });
});
