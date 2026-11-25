import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeDb, fakeClient, type FakeDb } from './fakeSupabase';

type Role = { isAdmin: boolean; isSuperAdmin: boolean; isCompta: boolean; isFacturation: boolean; isManager: boolean };
const state = vi.hoisted(() => ({
  db: null as unknown as FakeDb,
  priceType: 'normal',
  role: { isAdmin: false, isSuperAdmin: false, isCompta: true, isFacturation: false, isManager: false } as Role,
}));
vi.mock('../utils/supabaseClient', () => ({ get supabase() { return fakeClient(state.db); } }));
vi.mock('../integrations/supabase/client', () => ({ get supabase() { return fakeClient(state.db); } }));
vi.mock('../utils/supabaseCompanyFilter', () => ({
  getCompanyContext: () => ({ companyId: 'c1', bypassFilter: true, isSuperAdmin: false, isCompta: true }),
}));
vi.mock('../utils/supabaseCompanies', () => ({
  SupabaseCompaniesService: { getCompanyById: vi.fn(async () => ({ id: 'c1', name: 'Cuisimat SARL', ice: '001234567000089', tva_rate: 20 })) },
}));
vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({
    currentUser: { username: 'sara' }, companyName: 'Cuisimat SARL', ...state.role,
    getPriceDisplayType: () => state.priceType, canAccessStockLocation: () => true,
  }),
}));
const showToast = vi.hoisted(() => vi.fn());
vi.mock('../context/ToastContext', () => ({ useToast: () => ({ showToast }) }));

import StockComptablePage from '../pages/inventaire/StockComptablePage';

const reads: string[] = [];
const quote = (id: string, type: string, day: string, items: unknown[], over: Record<string, unknown> = {}) => ({
  id, quote_number: id, document_type: type, status: 'final', issuing_company_id: 'c1', company_id: 'c1', quote_date: day,
  created_at: `${day}T10:00:00Z`, updated_at: `${day}T10:00:00Z`, customer_info: { fullName: 'Hôtel Atlas' }, items,
  total_amount: 0, tva_rate: 20, parent_document_id: null, ...over,
});
const qi = (barcode: string | null, quantity: number, subtotal: number, name = 'Article') => ({
  id: `${barcode}-${quantity}`, quantity, subtotal, unitPrice: subtotal / quantity, quoteName: name, addedAt: '2026-07-01T10:00:00Z',
  product: { barcode: barcode || '', name },
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-25T10:00:00'));
  reads.length = 0;
  state.priceType = 'normal';
  state.role = { isAdmin: false, isSuperAdmin: false, isCompta: true, isFacturation: false, isManager: false };
  state.db = createFakeDb({
    products: [
      // 100 at the other company's showroom: not this company's real stock.
      { barcode: 'P1', name: 'Four mixte', brand: 'ATA', price: 300, reseller_price: 0, provider: '', image: null, stock_levels: { DEP: 12, SHOW: 100 } },
      { barcode: 'P2', name: 'Plat inox', brand: 'Inoxa', price: 50, reseller_price: 0, provider: '', image: null, stock_levels: { DEP: 5 } },
    ],
    product_costs: [{ barcode: 'P1', buyprice: 132 }, { barcode: 'P2', buyprice: 24 }],
    stock_movements: [
      { id: 'm1', barcode: 'P1', location_key: 'DEP', type: 'return', quantity: 1, unit_cost: null, source_type: 'return', source_id: 'AV-0001', created_by: 'sara', created_at: '2026-07-18T10:00:00Z' },
    ],
    stock_locations: [
      { id: 'loc-1', company_id: 'c1', name: 'Dépôt', abbreviation: 'DEP' },
      { id: 'loc-2', company_id: 'c2', name: 'Showroom', abbreviation: 'SHOW' },
    ],
    suppliers: [{ id: 's1', company_id: 'c1', name: 'Inox Maroc', legal_type: 'societe' }],
    supplier_invoices: [
      { id: 'si1', company_id: 'c1', number: 'FF-2026-0002', supplier_invoice_number: 'A-77', supplier_id: 's1', invoice_date: '2026-07-10', status: 'validated' },
      { id: 'si2', company_id: 'c1', number: null, supplier_invoice_number: 'A-78', supplier_id: 's1', invoice_date: '2026-07-11', status: 'draft' },
    ],
    supplier_invoice_lines: [
      { id: 'sl1', invoice_id: 'si1', barcode: 'P1', quantity: 5, amount_ht: 500, account_code: '6111', label: 'Four mixte', position: 0 },
      { id: 'sl2', invoice_id: 'si1', barcode: 'P2', quantity: 2, amount_ht: 40, account_code: '6111', label: 'Plat inox', position: 1 },
      { id: 'sl3', invoice_id: 'si2', barcode: 'P1', quantity: 100, amount_ht: 10000, account_code: '6111', label: 'Four mixte', position: 0 },
    ],
    quotes: [
      quote('FAC2607-1', 'invoice', '2026-07-15', [qi('P1', 3, 600, 'Four mixte'), qi(null, 1, 240, 'Installation')]),
      quote('FAC2607-2', 'invoice', '2026-07-16', [qi('P1', 8, 1600)], { issuing_company_id: 'c2' }),
      quote('FAC2607-3', 'invoice', '2026-07-20', [qi('P2', 4, 120)]),
      quote('AV-0001', 'avoir', '2026-07-18', [qi('P1', 1, 200)], { parent_document_id: 'FAC2607-1' }),
      quote('AV-0002', 'avoir', '2026-07-22', [qi('P2', 1, 30)], { parent_document_id: 'FAC2607-3' }),
    ],
    invoiced_stock_openings: [{ id: 'o1', company_id: 'c1', as_of: '2026-06-30', saved_by: 'sara', updated_at: '2026-07-01T09:00:00Z' }],
    invoiced_stock_opening_lines: [
      { id: 'ol1', opening_id: 'o1', barcode: 'P1', quantity: 10 },
      { id: 'ol2', opening_id: 'o1', barcode: 'P2', quantity: 3 },
    ],
  });
  state.db.failRead = table => { reads.push(table); };
  state.db.rpc.replace_invoiced_stock_opening = ({ p_company_id, p_as_of, p_lines }: { p_company_id: string; p_as_of: string; p_lines: Array<{ barcode: string; quantity: number }> }) => {
    const t = state.db.tables;
    let head = t.invoiced_stock_openings.find(o => o.company_id === p_company_id);
    if (!head) { head = { id: 'o-new', company_id: p_company_id }; t.invoiced_stock_openings.push(head); }
    Object.assign(head, { as_of: p_as_of, saved_by: 'sara', updated_at: '2026-11-25T10:00:00Z' });
    t.invoiced_stock_opening_lines = t.invoiced_stock_opening_lines.filter(l => l.opening_id !== head!.id);
    p_lines.forEach((l, i) => t.invoiced_stock_opening_lines.push({ id: `n${i}`, opening_id: head!.id, ...l }));
    return { id: head.id, as_of: p_as_of, lines: p_lines.length };
  };
  try { localStorage.clear(); } catch { /* */ }
});
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); vi.restoreAllMocks(); });

const page = (path = '/inventaire/stock-comptable?vue=facture&date=2026-07-31') => render(<MemoryRouter initialEntries={[path]}><StockComptablePage /></MemoryRouter>);
const mainTable = () => screen.getByRole('table', { name: 'Rapprochement par article' });
const row = (name: string) => within(mainTable()).getByRole('button', { name: `Détail ${name}` }).closest('tr')!;

describe('Stock facturé / réel', () => {
  it('shows an accountant the invoiced stock next to the real stock, with the gap and its documents', async () => {
    page();
    expect(await screen.findByText('Stock facturé et stock réel au 31/07/2026')).toBeTruthy();
    expect(screen.getByText(/Écart positif/).closest('p')!.textContent).toMatch(/reçues mais leur facture fournisseur n’est pas encore enregistrée ou validée, ou bien elles sont déjà facturées à un client mais pas encore livrées/);
    expect(screen.getByText(/Écart négatif/).closest('p')!.textContent).toMatch(/facturées par un fournisseur mais pas encore reçues, ou livrées à un client mais pas encore facturées/);
    expect(screen.getAllByText(/comptées dans la société qui a émis la facture/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/avoirs fournisseurs .* ne sont pas encore gérés/).length).toBeGreaterThan(0);
    await waitFor(() => expect(mainTable()).toBeTruthy());
    expect(screen.getByText(/Ouverture au 30\/06\/2026 : 2 articles, enregistrée par sara/)).toBeTruthy();

    // Four mixte: 10 + 5 − 3 + 1 = 13 on the invoices, 12 at this company's depot (not the 100 of the other company).
    const p1 = within(row('Four mixte'));
    expect(p1.getByText('13')).toBeTruthy();
    expect(p1.getByText('12')).toBeTruthy();
    expect(p1.getByText('-1')).toBeTruthy();
    expect(p1.getByText('-110,00 Dh')).toBeTruthy();
    // Plat inox: 3 + 2 − 4 = 1, 5 in the depot: +4 × 20 = 80.
    const p2 = within(row('Plat inox'));
    expect(p2.getByText('+4')).toBeTruthy();
    expect(p2.getByText('80,00 Dh')).toBeTruthy();
    expect(screen.getByText(/1 ligne de factures \(200,00 Dh HT\)/)).toBeTruthy();
    expect(screen.getByText(/AV-0002, 25,00 Dh HT\) porte des articles qui n’ont pas été remis en stock/)).toBeTruthy();
    expect(screen.getByText(/Comptés : 1 facture fournisseur, 2 factures clients, 1 avoir\./)).toBeTruthy();

    // Drill-down with links to the documents.
    fireEvent.click(within(mainTable()).getByRole('button', { name: 'Détail Four mixte' }));
    const table = within(mainTable());
    expect(table.getByRole('link', { name: 'Facture fournisseur FF-2026-0002' }).getAttribute('href')).toBe('/compta/factures-fournisseurs/si1');
    expect(table.getByRole('link', { name: 'Facture client FAC2607-1' }).getAttribute('href')).toBe('/compta/invoices/FAC2607-1');
    expect(table.getByRole('link', { name: 'Avoir AV-0001' }).getAttribute('href')).toBe('/compta/avoirs/AV-0001');
    expect(table.queryByRole('link', { name: /FAC2607-2/ })).toBeNull();

    // The credit note not put back in stock, counted on request; filters only filter.
    const readsBefore = reads.length;
    fireEvent.click(screen.getByLabelText('Compter ces avoirs comme retours de marchandises'));
    expect(within(row('Plat inox')).getByText('+3')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Marque'), { target: { value: 'ATA' } });
    await waitFor(() => expect(within(mainTable()).queryByText('Plat inox')).toBeNull());
    fireEvent.change(screen.getByLabelText('Rechercher'), { target: { value: 'four' } });
    await waitFor(() => expect(within(mainTable()).getByText('Four mixte')).toBeTruthy());
    expect(reads.length).toBe(readsBefore);

    // An earlier date recomputes from what is loaded: the documents are not read again.
    const supplierReads = reads.filter(t => t === 'supplier_invoices').length;
    fireEvent.change(screen.getByLabelText('Marque'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Rechercher'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-07-12' } });
    await waitFor(() => expect(within(row('Four mixte')).getByText('15')).toBeTruthy());
    expect(reads.filter(t => t === 'supplier_invoices').length).toBe(supplierReads);

    // Before the opening: not defined.
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-06-01' } });
    expect(await screen.findByText('Le stock facturé commence le 30/06/2026, date de l’ouverture.')).toBeTruthy();
  });

  it('keeps the existing view as the first one, and the date when switching', async () => {
    page('/inventaire/stock-comptable?date=2026-07-31');
    expect(await screen.findByText('Inventaire détaillé au 31/07/2026, en quantité et en valeur')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Stock facturé / réel' }));
    expect(await screen.findByText('Stock facturé et stock réel au 31/07/2026')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-07-20' } });
    fireEvent.click(screen.getByRole('tab', { name: 'Stock réel valorisé' }));
    expect(await screen.findByText('Inventaire détaillé au 20/07/2026, en quantité et en valeur')).toBeTruthy();
  });

  it('replaces the opening after confirmation, from the real stock at the chosen date, edited line by line', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    page();
    await waitFor(() => expect(mainTable()).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Refaire l’ouverture/ }));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByLabelText('Quantité P1')).toBeTruthy();
    fireEvent.change(dialog.getByLabelText('Date de l’ouverture'), { target: { value: '2026-07-31' } });
    fireEvent.click(dialog.getByRole('button', { name: /Proposer le stock réel au 31\/07\/2026/ }));
    expect(await dialog.findByText(/Stock réel au 31\/07\/2026 proposé : 2 articles/)).toBeTruthy();
    expect((dialog.getByLabelText('Quantité P1') as HTMLInputElement).value).toBe('12');
    fireEvent.change(dialog.getByLabelText('Quantité P2'), { target: { value: '4,5' } });
    fireEvent.click(dialog.getByRole('button', { name: /Enregistrer l’ouverture/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(confirm).toHaveBeenLastCalledWith(expect.stringMatching(/^Cette ouverture remplace celle du 30\/06\/2026 \(2 articles\)/));
    expect(state.db.tables.invoiced_stock_openings).toEqual([expect.objectContaining({ id: 'o1', as_of: '2026-07-31' })]);
    expect(state.db.tables.invoiced_stock_opening_lines.map(l => [l.barcode, l.quantity])).toEqual([['P1', 12], ['P2', 4.5]]);
    // Read again: everything before the new opening is in it; the gap of the Four mixte is gone.
    expect(await screen.findByText(/Ouverture au 31\/07\/2026 : 2 articles/)).toBeTruthy();
    await waitFor(() => expect(within(row('Four mixte')).getAllByText('0').length).toBeGreaterThan(0));
    expect(within(row('Plat inox')).getByText('+0,5')).toBeTruthy();
  });

  it('works before the migration: counts from zero and says to run it where saving is needed', async () => {
    state.db.failRead = table => {
      reads.push(table);
      return table.startsWith('invoiced_stock_') ? `Could not find the table 'public.${table}' in the schema cache` : undefined;
    };
    page();
    expect(await screen.findByText(/Aucune ouverture : le stock facturé part de zéro/)).toBeTruthy();
    expect(screen.getByText(/exécutez la migration 20261127130000_invoiced_stock\.sql dans Supabase/)).toBeTruthy();
    await waitFor(() => expect(mainTable()).toBeTruthy());
    // From zero: 5 − 3 + 1 = 3 invoiced, 12 real.
    expect(within(row('Four mixte')).getByText('+9')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Initialiser le stock facturé/ }));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByText(/L’enregistrement n’est pas encore possible : exécutez la migration 20261127130000_invoiced_stock\.sql/)).toBeTruthy();
    expect((dialog.getByRole('button', { name: /Enregistrer l’ouverture/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('is refused to a reseller, who never reads supplier invoices or the opening', async () => {
    state.priceType = 'reseller';
    page();
    expect(await screen.findByText('Les prix d’achat ne sont pas accessibles à votre compte.')).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'Stock facturé / réel' })).toBeNull();
    await new Promise(r => setTimeout(r, 20));
    for (const t of ['supplier_invoices', 'supplier_invoice_lines', 'invoiced_stock_openings', 'quotes', 'product_costs']) expect(reads).not.toContain(t);
  });

  it('tells a stock manager that supplier invoices are not open to them, without reading them', async () => {
    state.role = { isAdmin: false, isSuperAdmin: false, isCompta: false, isFacturation: false, isManager: true };
    page();
    expect(await screen.findByText('Les factures fournisseurs ne sont pas accessibles à votre compte.')).toBeTruthy();
    await new Promise(r => setTimeout(r, 20));
    for (const t of ['supplier_invoices', 'invoiced_stock_openings', 'quotes']) expect(reads).not.toContain(t);
  });
});
