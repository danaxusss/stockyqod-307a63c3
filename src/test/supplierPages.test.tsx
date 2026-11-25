import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeDb, fakeClient, type FakeDb } from './fakeSupabase';

const state = vi.hoisted(() => ({ db: null as unknown as FakeDb }));
vi.mock('../utils/supabaseClient', () => ({ get supabase() { return fakeClient(state.db); } }));
vi.mock('../integrations/supabase/client', () => ({ get supabase() { return fakeClient(state.db); } }));
vi.mock('@/integrations/supabase/client', () => ({ get supabase() { return fakeClient(state.db); } }));
vi.mock('../utils/supabaseCompanyFilter', () => ({
  getCompanyContext: () => ({ companyId: 'c1', bypassFilter: false, isSuperAdmin: false, isCompta: true }),
}));
vi.mock('../utils/supabaseCompanies', () => ({
  SupabaseCompaniesService: { getCompanyById: vi.fn(async () => ({ id: 'c1', name: 'Cuisimat SARL', if_number: '84016950', tva_rate: 20 })) },
}));
vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ currentUser: { username: 'sara' }, isCompta: true, isAdmin: false, isSuperAdmin: false, isFacturation: false, getPriceDisplayType: () => 'normal' }),
}));
vi.mock('../hooks/useAccess', () => ({ useAccess: () => ({ access: { accounting: true, supplierInvoices: true }, modules: [] }) }));
const showToast = vi.hoisted(() => vi.fn());
vi.mock('../context/ToastContext', () => ({ useToast: () => ({ showToast }) }));

import SupplierInvoicesPage from '../pages/fournisseurs/SupplierInvoicesPage';
import SupplierInvoiceDetailPage from '../pages/fournisseurs/SupplierInvoiceDetailPage';
import SuppliersPage from '../pages/fournisseurs/SuppliersPage';
import PaymentDelaysPage from '../pages/fournisseurs/PaymentDelaysPage';
import WithholdingsPage from '../pages/fournisseurs/WithholdingsPage';
import { SupplierPostingSection } from '../pages/fournisseurs/SupplierPostingSection';
import { SupplierInvoicesService } from '../utils/supabaseSuppliers';
import { buildModules, computeAccess, type AccessFlags } from '../lib/navigation';

const supplierRow = (p: Record<string, unknown> = {}) => ({ id: 's1', company_id: 'c1', name: 'Inox Maroc', legal_type: 'societe', ice: '001234567000089', if_number: '1234567', rc: '4521', address: '12 rue X', city: 'Casablanca', payment_days: 60, tax_certificate_date: null, active: true, ...p });
const invoiceRow = (p: Record<string, unknown> = {}) => ({
  id: 'i1', company_id: 'c1', supplier_id: 's1', number: 'FF-2026-0001', supplier_invoice_number: 'FA-77', invoice_date: '2026-09-01',
  reception_date: '2026-09-01', delivery_date: '2026-09-01', due_date: '2026-10-31', due_kind: 'legal', nature: 'marchandises', is_works: false,
  description: 'Fours', status: 'validated', total_ht: 1000, total_vat: 200, total_ttc: 1200, total_nondeductible_vat: 0, paid_amount: 0,
  ir_rate: null, ir_amount: 0, cash_over_limit: false, created_at: '2026-09-01T10:00:00Z', ...p,
});
const lineRow = (p: Record<string, unknown> = {}) => ({ id: 'l1', invoice_id: 'i1', position: 0, label: 'Four mixte', barcode: 'P1', quantity: 2, amount_ht: 1000, vat_rate: 20, vat_amount: 200, account_code: '6111', vat_nondeductible: false, ...p });
const missingTable = (t: string) => `Could not find the table 'public.${t}' in the schema cache`;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-25T10:00:00'));
  state.db = createFakeDb({
    suppliers: [supplierRow(), supplierRow({ id: 's2', name: 'Benali', legal_type: 'personne_physique', first_name: 'Karim', ice: null })],
    supplier_invoices: [invoiceRow(), invoiceRow({ id: 'i2', number: null, status: 'draft', supplier_invoice_number: 'BR-1', supplier_id: 's2', due_date: '2026-12-31', invoice_date: '2026-11-02', total_ttc: 600, total_ht: 500, total_vat: 100 })],
    supplier_invoice_lines: [lineRow(), lineRow({ id: 'l2', invoice_id: 'i2', amount_ht: 500, vat_amount: 100 })],
    supplier_payments: [],
    products: [{ barcode: 'P1', name: 'Four mixte' }, { barcode: 'P2', name: 'Plat inox' }],
    purchase_orders: [{ id: 'po1', company_id: 'c1', po_number: 'BC-2026-0004', provider_id: null, provider_name: 'inox maroc', status: 'received', order_date: '2026-11-01', total_ht: 3600 }],
    purchase_order_items: [{ id: 'poi1', po_id: 'po1', barcode: 'P1', label: 'Four mixte', qty_ordered: 3, qty_received: 3, unit_cost: 1200, sort_order: 0 }],
    providers: [{ id: 'pr1', company_id: 'c1', name: 'Sud Froid' }],
    accounts: ['4411', '34552', '34551', '6111', '5141', '5161', '44581', '44525'].map(code => ({ id: code, company_id: 'c1', code, label: code, class: Number(code[0]), active: true, is_system: true })),
    accounting_fiscal_years: [{ id: 'fy2026', company_id: 'c1', label: '2026', start_date: '2026-01-01', end_date: '2026-12-31', status: 'open' }],
    journals: [
      { id: 'j-ac', company_id: 'c1', code: 'AC', label: 'Achats', type: 'achat' },
      { id: 'j-bq', company_id: 'c1', code: 'BQ', label: 'Banque', type: 'banque' },
      { id: 'j-cs', company_id: 'c1', code: 'CS', label: 'Caisse', type: 'caisse' },
    ],
    journal_entries: [],
    journal_entry_lines: [],
  });
  let ids = 0;
  state.db.failWrite = (table, op, payload) => {
    if (op === 'insert') for (const r of (Array.isArray(payload) ? payload : [payload]) as Record<string, unknown>[]) r.id ??= `${table}-${++ids}`;
  };
  state.db.rpc.validate_supplier_invoice = ({ p_invoice_id }: { p_invoice_id: string }) => {
    const inv = state.db.tables.supplier_invoices.find(i => i.id === p_invoice_id)!;
    Object.assign(inv, { status: 'validated', number: 'FF-2026-0002' });
    return { number: 'FF-2026-0002' };
  };
  try { localStorage.clear(); } catch { /* */ }
});
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); vi.restoreAllMocks(); });

const page = (el: React.ReactElement, path: string, route = path.split('?')[0]) => render(
  <MemoryRouter initialEntries={[path]}><Routes><Route path={route} element={el} /><Route path="*" element={<p>autre page</p>} /></Routes></MemoryRouter>,
);

describe('supplier invoice list', () => {
  it('lists invoices with totals, the overdue ones flagged, and filters them', async () => {
    page(<SupplierInvoicesPage />, '/compta/factures-fournisseurs');
    expect(await screen.findByText('FF-2026-0001')).toBeTruthy();
    const table = screen.getByRole('table');
    expect(within(table).getByText('Inox Maroc')).toBeTruthy();
    expect(within(table).getByText('Benali Karim')).toBeTruthy();
    expect(within(table).getByText('25 j de retard')).toBeTruthy();
    expect(within(table).getByText('Total (2)')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('En retard'));
    expect(within(screen.getByRole('table')).queryByText('Benali Karim')).toBeNull();
    fireEvent.click(screen.getByLabelText('En retard'));
    fireEvent.change(screen.getByLabelText('Statut'), { target: { value: 'draft' } });
    expect(within(screen.getByRole('table')).queryByText('Inox Maroc')).toBeNull();
  });

  it('shows cards below 1024 px', async () => {
    const real = window.matchMedia;
    window.matchMedia = ((q: string) => ({ ...real(q), matches: q === '(max-width: 1023px)' })) as typeof window.matchMedia;
    try {
      page(<SupplierInvoicesPage />, '/compta/factures-fournisseurs');
      expect(await screen.findByText('FF-2026-0001')).toBeTruthy();
      expect(screen.queryByRole('table')).toBeNull();
      expect(screen.getByText('Facture FA-77')).toBeTruthy();
      expect(screen.getByText('reste 1 200,00 Dh')).toBeTruthy();
    } finally { window.matchMedia = real; }
  });

  it('says to run the migration when the tables do not exist yet', async () => {
    state.db.failRead = t => (t.startsWith('supplier') ? missingTable(t) : undefined);
    page(<SupplierInvoicesPage />, '/compta/factures-fournisseurs');
    expect(await screen.findByText('Factures fournisseurs pas encore installées')).toBeTruthy();
    expect(screen.getByText('20261126120000_supplier_invoices.sql')).toBeTruthy();
    expect(showToast).not.toHaveBeenCalled();
  });

  it('every supplier page shows the same notice before the migration', async () => {
    state.db.failRead = t => (t.startsWith('supplier') ? missingTable(t) : undefined);
    for (const [el, path] of [[<SuppliersPage key="a" />, '/compta/fournisseurs'], [<PaymentDelaysPage key="b" />, '/compta/delais-paiement'], [<WithholdingsPage key="c" />, '/compta/retenues-source'], [<SupplierInvoiceDetailPage key="d" />, '/compta/factures-fournisseurs/i1']] as const) {
      const { unmount } = page(el, path, path.endsWith('i1') ? '/compta/factures-fournisseurs/:id' : path);
      expect(await screen.findByText('Factures fournisseurs pas encore installées')).toBeTruthy();
      unmount();
    }
    expect(showToast).not.toHaveBeenCalled();
  });
});

describe('supplier invoice detail', () => {
  it('prefills a new invoice from a purchase order, in HT, with its supplier, and saves then validates it', async () => {
    page(<SupplierInvoiceDetailPage />, '/compta/factures-fournisseurs/nouvelle?po=po1', '/compta/factures-fournisseurs/:id');
    const amount = await screen.findByLabelText('Montant HT ligne 1') as HTMLInputElement;
    // 3 × 1,200 TTC = 3,600 TTC → 3,000 HT at 20 %.
    expect(amount.value).toBe('3000');
    expect((screen.getByLabelText('Quantité ligne 1') as HTMLInputElement).value).toBe('3');
    expect((screen.getByLabelText('Fournisseur') as HTMLSelectElement).value).toBe('s1');
    expect((screen.getByLabelText(/Nature des marchandises/) as HTMLInputElement).value).toBe('Commande BC-2026-0004');
    fireEvent.change(screen.getByLabelText('N° de la facture du fournisseur'), { target: { value: 'FA-90' } });
    fireEvent.click(screen.getByRole('button', { name: /Valider la facture/ }));
    await waitFor(() => expect(state.db.tables.supplier_invoices.some(i => i.supplier_invoice_number === 'FA-90')).toBe(true));
    const saved = state.db.tables.supplier_invoices.find(i => i.supplier_invoice_number === 'FA-90')!;
    expect(saved).toMatchObject({ company_id: 'c1', status: 'validated', number: 'FF-2026-0002', total_ht: 3000, total_vat: 600, total_ttc: 3600, source_po_id: 'po1', due_date: '2027-01-24' });
    expect(saved).not.toHaveProperty('paid_amount');
    expect(state.db.tables.supplier_invoice_lines.filter(l => l.invoice_id === saved.id)).toEqual([expect.objectContaining({ barcode: 'P1', quantity: 3, amount_ht: 3000, account_code: '6111' })]);
  });

  it('refuses a second invoice with the same supplier number', async () => {
    await expect(SupplierInvoicesService.save({ supplier_id: 's1', supplier_invoice_number: ' fa-77', invoice_date: '2026-11-01', due_date: '2026-12-01', delivery_date: null }, [lineRow() as never]))
      .rejects.toThrow('La facture n° fa-77 de ce fournisseur est déjà enregistrée.');
  });

  it('shows a booked invoice read-only with the customer-invoice wording, and suggests the VAT withholding', async () => {
    Object.assign(state.db.tables.supplier_invoices[0], { nature: 'immobilisation' });
    state.db.tables.supplier_invoice_lines[0].account_code = '2355';
    state.db.tables.journal_entries.push({ id: 'e1', company_id: 'c1', source_type: 'invoice', source_id: 'sinv:i1', status: 'posted', entry_number: 4 });
    page(<SupplierInvoiceDetailPage />, '/compta/factures-fournisseurs/i1', '/compta/factures-fournisseurs/:id');
    expect(await screen.findByText('Cette facture fournisseur est comptabilisée. Extournez son écriture dans Comptabilité pour la modifier.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Modifier' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Supprimer' })).toBeNull();
    expect((screen.getByLabelText('Montant HT ligne 1') as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(/Suggestion : 100 % de la TVA/)).toBeTruthy();
    expect(screen.getByText(/pas d’attestation de régularité fiscale enregistrée/)).toBeTruthy();
    expect((screen.getByLabelText('TVA retenue') as HTMLInputElement).value).toBe('200');
    expect(screen.getByText('1 000,00 Dh', { selector: 'p' })).toBeTruthy();
  });

  it('records a cash payment above 5,000 DH: warns, flags the invoice and keeps the lost VAT on the payment', async () => {
    Object.assign(state.db.tables.supplier_invoices[0], { total_ht: 10000, total_vat: 2000, total_ttc: 12000 });
    page(<SupplierInvoiceDetailPage />, '/compta/factures-fournisseurs/i1', '/compta/factures-fournisseurs/:id');
    await screen.findByText('Règlements');
    fireEvent.change(screen.getByLabelText('Mode'), { target: { value: 'especes' } });
    fireEvent.change(screen.getByLabelText('Montant soldé (TTC)'), { target: { value: '6000' } });
    expect(await screen.findByText(/plus de 5 000 DH en espèces le même jour/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Enregistrer le règlement/ }));
    await waitFor(() => expect(state.db.tables.supplier_payments).toHaveLength(1));
    await waitFor(() => expect(state.db.tables.supplier_invoices[0].cash_over_limit).toBe(true));
    expect(state.db.tables.supplier_payments[0]).toMatchObject({ amount: 6000, mode: 'especes', cash_vat_nondeductible: 1000, cash_expense_nondeductible: 1000, supplier_id: 's1' });
    expect(state.db.tables.supplier_invoices[0]).toMatchObject({ paid_amount: 6000, status: 'partial' });
  });
});

describe('ledger and reports', () => {
  it('generates the invoice entry once, balanced, in the purchases journal', async () => {
    render(<MemoryRouter><SupplierPostingSection autoPost={false} /></MemoryRouter>);
    const row = (await screen.findByText(/FF-2026-0001 · FA-77/)).closest('li')!;
    fireEvent.click(within(row).getByRole('button', { name: /Générer/ }));
    await waitFor(() => expect(state.db.tables.journal_entries).toHaveLength(1));
    const e = state.db.tables.journal_entries[0];
    expect(e).toMatchObject({ journal_id: 'j-ac', source_type: 'invoice', source_id: 'sinv:i1', entry_date: '2026-09-01', status: 'draft' });
    const lines = state.db.tables.journal_entry_lines.filter(l => l.entry_id === e.id);
    expect(lines.map(l => [l.account_code, l.debit, l.credit])).toEqual([['6111', 1000, 0], ['34552', 200, 0], ['4411', 0, 1200]]);
    expect(await screen.findByText('Aucune facture fournisseur en attente')).toBeTruthy();
    const inv = (await SupplierInvoicesService.get('i1'))!;
    await expect(SupplierInvoicesService.postInvoice(inv, undefined)).rejects.toThrow(/déjà une écriture/);
  });

  it('lists late invoices with the fine and the key rate used', async () => {
    page(<PaymentDelaysPage />, '/compta/delais-paiement');
    const table = await screen.findByRole('table');
    expect(within(table).getByText('FA-77')).toBeTruthy();
    expect(within(table).getByText('25 j')).toBeTruthy();
    expect(within(table).getByText('2,25 %')).toBeTruthy();
    // 1,200 TTC, 1 month: 2.25 %.
    expect(within(table).getAllByText('27,00 Dh').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('tab', { name: 'Déclaration' }));
    expect(await screen.findByText(/trimestrielle à partir de 2026/)).toBeTruthy();
    expect(screen.getByText(/2 millions de dirhams/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Fichier XML \(zip\) — à vérifier sur SIMPL/ })).toBeTruthy();
  });

  it('offers supplier records for names already used, without touching the orders', async () => {
    page(<SuppliersPage />, '/compta/fournisseurs');
    expect(await screen.findByText('Fournisseurs déjà utilisés sans fiche')).toBeTruthy();
    // "inox maroc" already has a record (case ignored): only the provider list name is offered.
    expect(screen.getByText('Sud Froid')).toBeTruthy();
    expect(screen.queryByText('inox maroc')).toBeNull();
    fireEvent.click(screen.getByLabelText(/Sud Froid/));
    fireEvent.click(screen.getByRole('button', { name: /Créer 1 fiche/ }));
    await waitFor(() => expect(state.db.tables.suppliers.some(s => s.name === 'Sud Froid' && s.company_id === 'c1')).toBe(true));
    expect(state.db.tables.purchase_orders[0].provider_name).toBe('inox maroc');
  });
});

describe('menu', () => {
  const none: AccessFlags = { canCreateQuote: false, isAdmin: false, isSuperAdmin: false, isFacturation: false, isCompta: false, isManager: false, isSeniorSales: false, isJuniorSales: false, isPaie: false, isStock: false, isTasks: false, isTasksOnly: false, tasksRole: null };
  const links = (f: Partial<AccessFlags>, module: string) => buildModules(computeAccess({ ...none, ...f })).find(m => m.id === module)?.items.map(i => i.to) || [];
  it('puts the supplier invoices in Documents for billing staff, in Comptabilité for accountants, nowhere for resellers', () => {
    expect(links({ isFacturation: true }, 'documents')).toContain('/compta/factures-fournisseurs');
    expect(links({ isCompta: true }, 'comptabilite')).toContain('/compta/factures-fournisseurs');
    expect(links({ isSuperAdmin: true }, 'comptabilite')).not.toContain('/compta/factures-fournisseurs');
    expect(links({ isSuperAdmin: true }, 'documents')).toContain('/compta/delais-paiement');
    expect(computeAccess({ ...none, isFacturation: true, seesCosts: false }).supplierInvoices).toBe(false);
    expect(computeAccess({ ...none, isStock: true, isManager: true }).supplierInvoices).toBe(false);
  });
});
