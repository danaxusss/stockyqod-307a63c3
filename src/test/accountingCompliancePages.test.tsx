import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeDb, fakeClient, type FakeDb } from './fakeSupabase';

const state = vi.hoisted(() => ({ db: null as unknown as FakeDb }));
vi.mock('../utils/supabaseClient', () => ({ get supabase() { return fakeClient(state.db); } }));
vi.mock('../integrations/supabase/client', () => ({ get supabase() { return fakeClient(state.db); } }));
vi.mock('@/integrations/supabase/client', () => ({ get supabase() { return fakeClient(state.db); } }));
vi.mock('../utils/supabaseCompanyFilter', () => ({
  getCompanyContext: () => ({ companyId: 'c1', bypassFilter: false, isSuperAdmin: false, isCompta: true }),
}));
vi.mock('../utils/supabaseCompanies', () => ({ SupabaseCompaniesService: { getCompanyById: vi.fn(async () => ({ id: 'c1', name: 'Société A', if_number: '12345678', ice: '' })) } }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ currentUser: { username: 'sara' }, companyName: 'Société A' }) }));
const showToast = vi.hoisted(() => vi.fn());
vi.mock('../context/ToastContext', () => ({ useToast: () => ({ showToast }) }));

import CloturePage from '../pages/comptabilite/CloturePage';
import ImmobilisationsPage from '../pages/comptabilite/ImmobilisationsPage';
import EtatsSynthesePage from '../pages/comptabilite/EtatsSynthesePage';
import JournalEntryPage from '../pages/comptabilite/JournalEntryPage';
import PlanComptablePage from '../pages/comptabilite/PlanComptablePage';

const year = (label: string, status = 'open') => ({ id: `fy${label}`, company_id: 'c1', label, start_date: `${label}-01-01`, end_date: `${label}-12-31`, status });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-25T10:00:00'));
  state.db = createFakeDb({
    accounting_fiscal_years: [year('2026')],
    journals: [{ id: 'j-od', company_id: 'c1', code: 'OD', label: 'Opérations diverses', type: 'od' }],
    accounts: [
      { id: 'a1', company_id: 'c1', code: '5141', label: 'Banque', class: 5, active: true, is_system: true },
      { id: 'a2', company_id: 'c1', code: '7111', label: 'Ventes de marchandises', class: 7, active: true, is_system: true },
      { id: 'a3', company_id: 'c1', code: '44552', label: 'TVA 14%', class: 4, active: false, is_system: true },
      { id: 'a4', company_id: 'c1', code: '4456', label: 'TVA due', class: 4, active: true, is_system: true },
      { id: 'a5', company_id: 'c1', code: '3421', label: 'Clients', class: 3, active: true, is_system: true },
    ],
    journal_entries: [{ id: 'e1', company_id: 'c1', fiscal_year_id: 'fy2026', journal_id: 'j-od', entry_number: 1, entry_date: '2026-03-01', status: 'posted', reference: 'P1', label: 'Vente', posted_at: '2026-03-01T10:00:00Z' }],
    journal_entry_lines: [
      { id: 'l1', entry_id: 'e1', company_id: 'c1', account_code: '5141', debit: 1_200_000, credit: 0, sort_order: 0 },
      { id: 'l2', entry_id: 'e1', company_id: 'c1', account_code: '7111', debit: 0, credit: 1_000_000, sort_order: 1 },
      { id: 'l3', entry_id: 'e1', company_id: 'c1', account_code: '4456', debit: 0, credit: 300_000, sort_order: 2 },
      { id: 'l4', entry_id: 'e1', company_id: 'c1', account_code: '3421', debit: 100_000, credit: 0, sort_order: 3 },
    ],
    fixed_assets: [{
      id: 'as1', company_id: 'c1', label: 'Voiture direction', account_code: '2340', acquisition_date: '2026-01-01', amount: 500_000, method: 'lineaire',
      duration_years: 5, salvage: 0, depreciation_account_code: '2834', expense_account_code: '6191', passenger_car: true,
    }],
    fixed_asset_depreciations: [],
  });
  try { localStorage.clear(); } catch { /* */ }
});
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

const page = (el: React.ReactElement) => render(<MemoryRouter>{el}</MemoryRouter>);

describe('accounting pages', () => {
  it('Clôture shows the IS estimate and runs the FEC controls', async () => {
    const createObjectURL = vi.fn(() => 'blob:x');
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    page(<CloturePage />);
    expect(await screen.findByText('Impôt sur les sociétés 2026 — estimation')).toBeTruthy();
    // 1,000,000 of profit in 2026: 20 % → 200,000.
    expect(screen.getAllByText(/200 000,00 MAD/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: /Exporter le FEC/ }));
    expect(await screen.findByText('FEC_12345678_20261231.txt')).toBeTruthy();
    expect(screen.getByText(/Contrôles réussis/)).toBeTruthy();
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('Immobilisations shows the car cap, the expense-account hint and the schedule', async () => {
    page(<ImmobilisationsPage />);
    const rows = await screen.findAllByText('Voiture direction');
    expect(rows.length).toBeGreaterThan(0);
    expect(screen.getAllByText(/non déductible 2026 : 20 000,00/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/le compte usuel pour ce type d'immobilisation est le 6193/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole('button', { name: /Plan d'amortissement de Voiture direction/ })[0]);
    expect(screen.getAllByText('2030').length).toBeGreaterThan(0);
  });

  it('Bilan puts the debit balance of 3421 on the assets side and a credit balance of class 4 on the liabilities side', async () => {
    page(<EtatsSynthesePage />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Bilan' }));
    expect(screen.getAllByText('Total Actif').length).toBe(1);
    expect(screen.getByText('3421 — Clients')).toBeTruthy();
    expect(screen.getByText('4456 — TVA due')).toBeTruthy();
    expect(screen.getByText("Résultat net de l'exercice")).toBeTruthy();
  });

  it('manual entry refuses a line with both a debit and a credit', async () => {
    page(<JournalEntryPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Écriture/ }));
    const section = screen.getByRole('region', { name: 'Écriture en cours' });
    fireEvent.change(within(section).getByLabelText('Compte, ligne 1'), { target: { value: '5141' } });
    fireEvent.change(within(section).getByLabelText('Compte, ligne 2'), { target: { value: '7111' } });
    const amounts = within(section).getAllByRole('spinbutton');
    fireEvent.change(amounts[0], { target: { value: '100' } });
    fireEvent.change(amounts[1], { target: { value: '5' } });
    fireEvent.change(amounts[3], { target: { value: '95' } });
    fireEvent.click(within(section).getByRole('button', { name: 'Brouillon' }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/Ligne 1 : saisissez soit un débit, soit un crédit/) })));
    expect(state.db.tables.journal_entries).toHaveLength(1);
  });

  it('Plan comptable marks inactive accounts and refuses to deactivate an account with entries', async () => {
    page(<PlanComptablePage />);
    expect(await screen.findByText('désactivé')).toBeTruthy();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Désactiver le compte 5141' }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ message: 'Le compte 5141 a des écritures : il ne peut pas être désactivé.' })));
  });
});
