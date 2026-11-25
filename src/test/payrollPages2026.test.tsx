// The payslip screen and the payroll settings page, on the in-memory database.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
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
vi.mock('../utils/companySettings', () => ({ CompanySettingsService: { getSettings: vi.fn(async () => null) } }));

import PayslipDetailPage from '../pages/paie/PayslipDetailPage';
import ParametresPaiePage from '../pages/paie/ParametresPaiePage';

const employee = { id: 'e1', company_id: 'c1', full_name: 'Ali Amrani', dependents_count: 0, contract_type: 'CDI', base_salary: 9000, is_active: true, position: 'Magasinier' };

beforeEach(() => {
  state.db = createFakeDb({
    employees: [employee], payslips: [], payslip_variables: [], payslip_items: [], payroll_settings: [], payroll_rubriques: [], payroll_runs: [],
  });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => { vi.restoreAllMocks(); showToast.mockReset(); });

const money = (n: string) => new RegExp(n.replace(' ', '[\\s\\u202f\\u00a0]'));

describe('payslip screen', () => {
  beforeEach(() => {
    state.db.tables.payslips.push({
      id: 'p1', company_id: 'c1', employee_id: 'e1', employee, period_month: 11, period_year: 2026, payslip_number: 'PAIE-2026-007',
      hours_worked: 191, base_salary: 8000, total_gross: 0, is_locked: false, run_id: null, cnss_days: 26,
    });
    state.db.tables.payslip_variables.push(
      { id: 'v1', payslip_id: 'p1', label: 'Indemnité de transport', type: 'gain', amount: 800, soumis_cnss: false, soumis_amo: false, soumis_ir: false, soumis_cimr: false, inclus_anciennete: false, base: 'fixe', ir_ceiling_type: 'amount', ir_ceiling_value: 500, cnss_ceiling_type: 'amount', cnss_ceiling_value: 500, sort_order: 0 },
      { id: 'v2', payslip_id: 'p1', label: 'Absence', type: 'retenue', amount: 250, quantity: 0, rate: 1, soumis_cnss: true, soumis_amo: true, soumis_ir: true, soumis_cimr: true, inclus_anciennete: false, base: 'fixe', sort_order: 1 },
    );
  });

  const renderPage = () => render(
    <MemoryRouter initialEntries={['/paie/bulletins/p1']}><Routes><Route path="/paie/bulletins/:id" element={<PayslipDetailPage />} /></Routes></MemoryRouter>,
  );

  it('computes from the payslip\'s own salary, shows the absence in the earnings and offers the current salary', async () => {
    renderPage();
    const earnings = (await screen.findByText('Éléments de rémunération')).closest('section')!;
    // 8,000 + 800 − 250 = 8,550 (the employee earns 9,000 today)
    expect(within(earnings).getByText(money('8 550,00'))).toBeTruthy();
    expect(within(earnings).getByLabelText('Montant déduit du brut')).toBeTruthy();
    expect(screen.getByText(/exonéré IR jusqu'à 500,00 MAD/)).toBeTruthy();
    // Rates come from the settings of the period.
    expect(screen.getByText(/CNSS salarié \(4,48 % plafonné/)).toBeTruthy();
    expect(screen.getByText(/Taxe formation pro\. \(1,6 %\)|Charges patronales/)).toBeTruthy();

    fireEvent.click(screen.getAllByText('Reprendre le salaire actuel de l\'employé')[0]);
    await waitFor(() => expect(within(earnings).getByText(money('9 550,00'))).toBeTruthy());
  });

  it('saves with the run rules: figures, bases and lines stored', async () => {
    renderPage();
    await screen.findByText('Éléments de rémunération');
    fireEvent.click(screen.getAllByText('Enregistrer')[0]);
    await waitFor(() => expect(state.db.tables.payslips[0].total_gross).toBe(8550));
    // IR base 8,000 + 300 − 250 = 8,050 ; CNSS base 8,000 + 300 − 250 = 8,050
    expect(state.db.tables.payslips[0]).toMatchObject({ base_salary: 8000, ir_taxable_gross: 8050, cnss_base: 8050 });
    expect(state.db.tables.payslip_variables.map(v => v.label)).toEqual(['Indemnité de transport', 'Absence']);
  });

  it('warns under the SMIG and blocks a negative net', async () => {
    state.db.tables.payslips[0].base_salary = 3000;
    state.db.tables.payslip_variables.push({ id: 'v3', payslip_id: 'p1', code: 'AVANCE', label: 'Avance', type: 'retenue', amount: 9000, soumis_cnss: false, soumis_ir: false, sort_order: 2 });
    renderPage();
    expect(await screen.findByText(/sous le SMIG 2026/)).toBeTruthy();
    expect(screen.getByText(/Net à payer négatif/)).toBeTruthy();
    expect((screen.getByText('Valider le bulletin').closest('button') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('payroll settings page', () => {
  const renderPage = () => render(<MemoryRouter><ParametresPaiePage /></MemoryRouter>);

  it('shows the official status, flags a change and restores the official values', async () => {
    renderPage();
    expect(await screen.findByText('Conforme au barème officiel 2026')).toBeTruthy();
    const ded = screen.getByText('Déduction/personne à charge (an)').closest('label')!.querySelector('input')!;
    expect(ded.value).toBe('600');
    fireEvent.change(ded, { target: { value: '500' } });
    expect(screen.getByText('Valeurs modifiées')).toBeTruthy();
    fireEvent.click(screen.getByText('Rétablir les valeurs officielles'));
    expect(screen.getByText('Conforme au barème officiel 2026')).toBeTruthy();
  });

  it('edits the IR scale with computed deductions and refuses a broken scale', async () => {
    renderPage();
    await screen.findByText(/Barème IR 2026/);
    // Deductions are worked out: 4,000 for the 10 % band.
    expect(screen.getAllByText(money('4 000,00')).length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText('Taux de la tranche 2'), { target: { value: '150' } });
    expect(screen.getByText(/Tranche 2 : le taux doit être entre 0 et 100 %/)).toBeTruthy();
    expect(screen.getAllByText(/Enregistrer 2026/).every(t => (t.closest('button') as HTMLButtonElement).disabled)).toBe(true);
  });

  it('offers the 2027 bill behind a confirmation, never by itself', async () => {
    renderPage();
    await screen.findByText('Conforme au barème officiel 2026');
    fireEvent.change(screen.getByLabelText('Année'), { target: { value: '2027' } });
    // 2027 inherits the last enacted values.
    expect(await screen.findByText('Conforme au barème officiel 2026')).toBeTruthy();
    fireEvent.click(screen.getByText('Appliquer le projet de loi de finances 2027 (pas encore adopté)'));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/pas encore adopté/));
    expect(screen.getByText('Projet de loi de finances 2027 (pas encore adopté)')).toBeTruthy();
    // Nothing saved until "Enregistrer".
    expect(state.db.tables.payroll_settings).toHaveLength(0);
  });
});

describe('declarations page', () => {
  beforeEach(() => {
    const slip = (id: string, locked: boolean, extra: Record<string, unknown>) => ({
      id, company_id: 'c1', employee_id: 'e1', period_month: new Date().getMonth() + 1, period_year: new Date().getFullYear(), payslip_number: id,
      total_gross: 8850, cnss_employee: 268.8, amo_employee: 183.06, ir_amount: 328.79, net_salary: 8069.35, frais_pro: 2087.5,
      cnss_employer: 538.8, amo_employer: 332.91, alloc_familiales: 518.4, tfp_employer: 129.6, is_locked: locked, ...extra,
    });
    state.db.tables.payslips.push(
      slip('PAIE-A', true, { ir_taxable_gross: 8350, net_taxable: 5810.64, cnss_base: 8100, cnss_days: 24 }),
      slip('PAIE-B', false, { ir_taxable_gross: 8350, net_taxable: 5810.64, cnss_base: 8100 }),
    );
  });

  it('declares validated payslips by default, with the real CNSS base and the days; drafts on request', async () => {
    const { default: DeclarationsPage } = await import('../pages/paie/DeclarationsPage');
    render(<MemoryRouter><DeclarationsPage /></MemoryRouter>);
    expect(await screen.findByText(/^1 bulletin\(s\) ·/)).toBeTruthy();
    expect(screen.getByText(/1 bulletin\(s\) non validé\(s\) ne sont pas inclus/)).toBeTruthy();
    const table = screen.getByRole('table');
    // Base CNSS 8,100 (not the 8,850 gross), capped at 6,000; 24 days declared.
    expect(within(table).getAllByText(money('8 100,00')).length).toBeGreaterThan(0);
    expect(within(table).getAllByText(money('6 000,00')).length).toBeGreaterThan(0);
    expect(within(table).getAllByText('24').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByLabelText(/Inclure les brouillons/));
    expect(screen.getByText(/^2 bulletin\(s\) ·/)).toBeTruthy();
    expect(screen.getByText(/Déclaration provisoire/)).toBeTruthy();
    fireEvent.click(screen.getByText('IR'));
    expect(within(screen.getByRole('table')).getAllByText(money('8 350,00')).length).toBeGreaterThan(0);
    expect(within(screen.getByRole('table')).getAllByText(money('5 810,64')).length).toBeGreaterThan(0);
  });
});
