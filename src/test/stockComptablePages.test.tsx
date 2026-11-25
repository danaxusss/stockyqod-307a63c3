import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeDb, fakeClient, type FakeDb } from './fakeSupabase';

const state = vi.hoisted(() => ({ db: null as unknown as FakeDb, priceType: 'normal', role: { isAdmin: false, isSuperAdmin: false } }));
vi.mock('../utils/supabaseClient', () => ({ get supabase() { return fakeClient(state.db); } }));
vi.mock('../integrations/supabase/client', () => ({ get supabase() { return fakeClient(state.db); } }));
vi.mock('@/integrations/supabase/client', () => ({ get supabase() { return fakeClient(state.db); } }));
vi.mock('../utils/supabaseCompanyFilter', () => ({
  getCompanyContext: () => ({ companyId: 'c1', bypassFilter: true, isSuperAdmin: false, isCompta: true }),
}));
vi.mock('../utils/supabaseCompanies', () => ({
  SupabaseCompaniesService: { getCompanyById: vi.fn(async () => ({ id: 'c1', name: 'Cuisimat SARL', ice: '001234567000089', if_number: '12345678', tva_rate: 20 })) },
}));
vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({
    currentUser: { username: 'sara' }, companyName: 'Cuisimat SARL', isCompta: true, ...state.role,
    getPriceDisplayType: () => state.priceType, canAccessStockLocation: () => true,
  }),
}));
const showToast = vi.hoisted(() => vi.fn());
vi.mock('../context/ToastContext', () => ({ useToast: () => ({ showToast }) }));

import StockComptablePage from '../pages/inventaire/StockComptablePage';
import CloturePage from '../pages/comptabilite/CloturePage';
import { buildModules, computeAccess, type AccessFlags } from '../lib/navigation';

const year = (label: string, status = 'open') => ({ id: `fy${label}`, company_id: 'c1', label, start_date: `${label}-01-01`, end_date: `${label}-12-31`, status });
const reads: string[] = [];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-25T10:00:00'));
  reads.length = 0;
  state.priceType = 'normal';
  state.role = { isAdmin: false, isSuperAdmin: false };
  state.db = createFakeDb({
    products: [
      { barcode: 'P1', name: 'Four mixte', brand: 'ATA', price: 300, reseller_price: 0, provider: '', image: null, stock_levels: { DEP: 10 } },
      { barcode: 'P2', name: 'Plat inox', brand: 'ATA', price: 50, reseller_price: 0, provider: '', image: null, stock_levels: { DEP: 0 } },
    ],
    // 5 at 96 TTC at the end of 2025, 5 received at 168 since: (5 × 96 + 5 × 168) / 10 = 132 now.
    product_costs: [{ barcode: 'P1', buyprice: 132 }, { barcode: 'P2', buyprice: 24 }],
    stock_movements: [{ id: 'm1', barcode: 'P1', location_key: 'DEP', type: 'in', quantity: 5, unit_cost: 168, source_type: 'receipt', created_by: 'u', created_at: '2026-02-03T09:00:00.000Z' }],
    stock_locations: [{ id: 'loc-1', company_id: 'c1', name: 'Dépôt', abbreviation: 'DEP' }],
    accounting_fiscal_years: [year('2025')],
    journals: [{ id: 'j-od', company_id: 'c1', code: 'OD', label: 'Opérations diverses', type: 'od' }],
    accounts: ['1111', '3111', '6114', '7111', '5141'].map(code => ({ id: code, company_id: 'c1', code, label: code, class: Number(code[0]), active: true, is_system: true })),
    journal_entries: [{ id: 'e1', company_id: 'c1', fiscal_year_id: 'fy2025', journal_id: 'j-od', entry_number: 1, entry_date: '2025-01-01', status: 'posted', reference: 'AN', label: 'Ouverture', posted_at: '2025-01-01T10:00:00Z' }],
    journal_entry_lines: [
      { id: 'l1', entry_id: 'e1', company_id: 'c1', account_code: '3111', debit: 300, credit: 0, sort_order: 0 },
      { id: 'l2', entry_id: 'e1', company_id: 'c1', account_code: '1111', debit: 0, credit: 300, sort_order: 1 },
    ],
  });
  state.db.failRead = table => { reads.push(table); };
  let ids = 0;
  state.db.failWrite = (table, op, payload) => {
    if (op === 'insert') for (const r of (Array.isArray(payload) ? payload : [payload]) as Record<string, unknown>[]) r.id ??= `${table}-${++ids}`;
  };
  try { localStorage.clear(); } catch { /* */ }
});
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); vi.restoreAllMocks(); });

const page = (el: React.ReactElement, path = '/inventaire/stock-comptable') => render(<MemoryRouter initialEntries={[path]}>{el}</MemoryRouter>);

describe('Stock comptable page', () => {
  it('is refused to a reseller, who never gets purchase prices or movements', async () => {
    state.priceType = 'reseller';
    page(<StockComptablePage />);
    expect(await screen.findByText('Les prix d’achat ne sont pas accessibles à votre compte.')).toBeTruthy();
    expect(screen.queryByText(/Coût unitaire HT/)).toBeNull();
    expect(screen.queryByRole('button', { name: /CSV/ })).toBeNull();
    await new Promise(r => setTimeout(r, 20));
    expect(reads).not.toContain('product_costs');
    expect(reads).not.toContain('stock_movements');
  });

  it('shows an accountant the stock at the year end, excluding VAT, next to the 3111 balance', async () => {
    page(<StockComptablePage />);
    // Today: 10 at 132 TTC = 110 HT → 1,100.
    expect(await screen.findAllByText('1 100,00 Dh')).not.toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: /Fin 2025/ }));
    expect(await screen.findByText('Inventaire détaillé au 31/12/2025, en quantité et en valeur')).toBeTruthy();
    // 5 at 96 TTC = 80 HT → 400.
    const table = screen.getByRole('table');
    const row = within(table).getByText('Four mixte').closest('tr')!;
    expect(within(row).getByText('5')).toBeTruthy();
    expect(within(row).getByText('80,00 Dh')).toBeTruthy();
    expect(within(row).getAllByText('400,00 Dh')).toHaveLength(1);
    expect(within(table).queryByText('Plat inox')).toBeNull();
    expect(screen.getByText('Compte 3111 au 31/12/2025')).toBeTruthy();
    expect(screen.getByText('300,00 Dh')).toBeTruthy();
    expect(screen.getByText('Écart 100,00 Dh')).toBeTruthy();
    expect(screen.getByText(/rejoint le stock valorisé une fois l’écriture de stock de fin d’exercice validée/)).toBeTruthy();
    expect(screen.getByText(/Valeur hors taxe : les prix d'achat sont saisis TTC/)).toBeTruthy();

    // Zero quantities on demand; searching only filters what is already computed.
    fireEvent.click(screen.getByLabelText('Masquer les quantités nulles'));
    expect(within(screen.getByRole('table')).getByText('Plat inox')).toBeTruthy();
    const movementReads = reads.filter(t => t === 'stock_movements').length;
    fireEvent.change(screen.getByLabelText('Rechercher'), { target: { value: 'plat' } });
    await waitFor(() => expect(within(screen.getByRole('table')).queryByText('Four mixte')).toBeNull());
    expect(reads.filter(t => t === 'stock_movements').length).toBe(movementReads);
  });

  it('opens at the date asked by the Clôture page and lists quantities per location', async () => {
    page(<StockComptablePage />, '/inventaire/stock-comptable?date=2025-12-31');
    expect(await screen.findByText('Inventaire détaillé au 31/12/2025, en quantité et en valeur')).toBeTruthy();
    fireEvent.click(await screen.findByLabelText('Détail par emplacement'));
    expect(await screen.findAllByText('Dépôt')).not.toHaveLength(0);
  });
});

describe('menu', () => {
  const none: AccessFlags = {
    canCreateQuote: false, isAdmin: false, isSuperAdmin: false, isFacturation: false, isCompta: false, isManager: false,
    isSeniorSales: false, isJuniorSales: false, isPaie: false, isStock: false, isTasks: false, isTasksOnly: false, tasksRole: null,
  };
  const links = (f: Partial<AccessFlags>) => buildModules(computeAccess({ ...none, ...f })).map(m => [m.id, m.items.map(i => i.to)] as const);
  const where = (f: Partial<AccessFlags>) => links(f).filter(([, to]) => to.includes('/inventaire/stock-comptable')).map(([id]) => id);

  it('lists the page in the Stock menu, in Comptabilité for accountants without it, never for a reseller', () => {
    expect(where({ isManager: true, isStock: true })).toEqual(['stock']);
    expect(where({ isAdmin: true, isStock: true })).toEqual(['stock']);
    expect(where({ isCompta: true })).toEqual(['comptabilite']);
    expect(where({ isManager: true, isStock: true, seesCosts: false })).toEqual([]);
    expect(where({ isCompta: true, seesCosts: false })).toEqual([]);
    expect(where({ isFacturation: true })).toEqual([]);
  });
});

describe('Clôture: stock de marchandises', () => {
  it('prefills the closing stock, shows an edited difference and creates the draft entry once', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    page(<CloturePage />, '/comptabilite/cloture');
    const panel = (await screen.findByText('Stock de marchandises 2025')).closest('section')!;
    await waitFor(() => expect(within(panel).getAllByText('400,00 MAD').length).toBeGreaterThan(0));
    expect(within(panel).getByText('300,00 MAD')).toBeTruthy();
    expect(within(panel).getByRole('link', { name: "Voir l'inventaire" }).getAttribute('href')).toBe('/inventaire/stock-comptable?date=2025-12-31');
    const input = within(panel).getByLabelText(/Stock final retenu/) as HTMLInputElement;
    expect(input.value).toBe('400');
    // Variation 300 − 400 = −100 (the stock went up).
    expect(within(panel).getByText('-100,00 MAD')).toBeTruthy();
    fireEvent.change(input, { target: { value: '380' } });
    expect(within(panel).getByText(/Écart avec le stock valorisé : -20,00 MAD/)).toBeTruthy();

    fireEvent.click(within(panel).getByRole('button', { name: "Créer l'écriture de stock" }));
    await waitFor(() => expect(state.db.tables.journal_entries.some(e => e.source_id === 'stock:fy2025')).toBe(true));
    const entry = state.db.tables.journal_entries.find(e => e.source_id === 'stock:fy2025')!;
    expect(entry).toMatchObject({ status: 'draft', entry_date: '2025-12-31', journal_id: 'j-od' });
    expect(state.db.tables.journal_entry_lines.filter(l => l.entry_id === entry.id).map(l => [l.account_code, l.debit, l.credit]))
      .toEqual([['6114', 300, 0], ['3111', 0, 300], ['3111', 380, 0], ['6114', 0, 380]]);
    expect(await screen.findByRole('button', { name: 'Remplacer le brouillon' })).toBeTruthy();
    expect(await screen.findByText(/Brouillon créé \(stock initial 300,00 MAD, stock final 380,00 MAD\)/)).toBeTruthy();
  });

  it('shows a posted entry as done, and asks before closing a year whose stock was not booked', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    page(<CloturePage />, '/comptabilite/cloture');
    const panel = (await screen.findByText('Stock de marchandises 2025')).closest('section')!;
    await waitFor(() => expect(within(panel).getAllByText('400,00 MAD').length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByRole('button', { name: /Clôturer l'exercice 2025/ })[0]);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0]).toMatch(/Aucune écriture de stock validée pour l'exercice 2025.*ne tiendra pas compte du stock/);
    expect(state.db.tables.accounting_fiscal_years.find(y => y.label === '2025')?.status).toBe('open');
  });

  it('once posted: amounts from the entry, no button, its number', async () => {
    state.db.tables.journal_entries.push({ id: 's1', company_id: 'c1', fiscal_year_id: 'fy2025', journal_id: 'j-od', entry_number: 7, entry_date: '2025-12-31', status: 'posted', source_type: 'manual', source_id: 'stock:fy2025', posted_at: '2026-01-10T10:00:00Z' });
    state.db.tables.journal_entry_lines.push(
      { id: 's1a', entry_id: 's1', company_id: 'c1', account_code: '6114', debit: 300, credit: 0, label: 'Annulation du stock initial', sort_order: 0 },
      { id: 's1b', entry_id: 's1', company_id: 'c1', account_code: '3111', debit: 0, credit: 300, label: 'Annulation du stock initial', sort_order: 1 },
      { id: 's1c', entry_id: 's1', company_id: 'c1', account_code: '3111', debit: 390, credit: 0, label: 'Stock final', sort_order: 2 },
      { id: 's1d', entry_id: 's1', company_id: 'c1', account_code: '6114', debit: 0, credit: 390, label: 'Stock final', sort_order: 3 },
    );
    page(<CloturePage />, '/comptabilite/cloture');
    const panel = (await screen.findByText('Stock de marchandises 2025')).closest('section')!;
    expect(await within(panel).findByText('Écriture validée n° 7')).toBeTruthy();
    expect(within(panel).getByText('300,00 MAD')).toBeTruthy();
    expect(within(panel).getByText('390,00 MAD')).toBeTruthy();
    expect(within(panel).getByText('-90,00 MAD')).toBeTruthy();
    expect(within(panel).queryByRole('button', { name: /écriture de stock|Remplacer/ })).toBeNull();
    expect(within(panel).getByText(/contre-passez-la d'abord dans Saisie/)).toBeTruthy();
  });
});
