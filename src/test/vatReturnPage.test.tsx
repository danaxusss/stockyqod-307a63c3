import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { createFakeDb, fakeClient, type FakeDb } from './fakeSupabase';

const state = vi.hoisted(() => ({ db: null as unknown as FakeDb }));
vi.mock('../utils/supabaseClient', () => ({ get supabase() { return fakeClient(state.db); } }));
vi.mock('../integrations/supabase/client', () => ({ get supabase() { return fakeClient(state.db); } }));
vi.mock('@/integrations/supabase/client', () => ({ get supabase() { return fakeClient(state.db); } }));
vi.mock('../utils/supabaseCompanyFilter', () => ({
  getCompanyContext: () => ({ companyId: 'c1', bypassFilter: false, isSuperAdmin: false, isCompta: true }),
}));
// Company settings are read from the fake companies table, so a save shows on reload.
vi.mock('../utils/supabaseCompanies', () => ({
  SupabaseCompaniesService: { getCompanyById: vi.fn(async (id: string) => structuredClone(state.db.tables.companies.find(c => c.id === id) || null)) },
  invalidateCompaniesCache: vi.fn(),
}));
vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ currentUser: { username: 'sara' }, isCompta: true, isAdmin: false, isSuperAdmin: false }),
}));
const showToast = vi.hoisted(() => vi.fn());
vi.mock('../context/ToastContext', () => ({ useToast: () => ({ showToast }) }));

import TvaPage from '../pages/comptabilite/TvaPage';

// The same company as vatReturn.test.ts, reduced: October 2026, cash basis, prorata 80 %, opening credit 1 000.
//   F1 12 000 @20 %: 6 000 received 10/10 → VAT 1 000;  F3 24 000 @20 %: 20 000 + 4 000 withheld 25/10 → VAT 4 000.
//   SI1 goods: half paid 05/10 → VAT 1 000;  SI4 works: paid 10 000 + 2 000 withheld 20/10 → VAT 2 000.
//   Due 5 000; deductible (1 000 + 2 000) × 80 % = 2 400; 5 000 − 2 400 − 1 000 − 4 000 = −2 400 → credit 2 400.
const company = (p: Record<string, unknown> = {}) => ({
  id: 'c1', name: 'Cuisimat SARL', if_number: '84016950', ice: '001525874000045', tva_rate: 20,
  vat_regime: 'encaissement', vat_periodicity: 'M', vat_prorata: 80, vat_opening_credit: 1000, vat_start_date: '2026-10-01', ...p,
});
const doc = (p: Record<string, unknown>) => ({
  created_at: '2026-10-01T09:00:00Z', updated_at: '2026-10-01T09:00:00Z', status: 'final', customer_info: { fullName: 'Client' }, items: [],
  document_type: 'invoice', company_id: 'c1', issuing_company_id: 'c1', avance_amount: 0, payment_methods_json: [], tva_rate: 20, ...p,
});
const quotes = () => [
  doc({ id: 'F1', quote_number: 'FAC2610-1', quote_date: '2026-10-05', total_amount: 12000, payment_methods_json: [{ id: 'a', method: 'Virement', amount: 6000, date: '2026-10-10', kind: 'payment' }] }),
  doc({ id: 'F3', quote_number: 'FAC2610-3', quote_date: '2026-10-12', total_amount: 24000, customer_info: { fullName: 'Office public', ice: '002000000000011' },
    payment_methods_json: [{ id: 'b', method: 'Virement', amount: 20000, date: '2026-10-25', kind: 'payment' }, { id: 'w', method: 'TVA retenue à la source', amount: 4000, date: '2026-10-25', kind: 'vat_withholding', withholding_rate: 100 }] }),
];
const sinv = (p: Record<string, unknown>) => ({ company_id: 'c1', status: 'partial', due_kind: 'legal', due_date: '2026-12-31', nature: 'marchandises', is_works: false, total_nondeductible_vat: 0, paid_amount: 0, ir_amount: 0, ...p });
const spay = (p: Record<string, unknown>) => ({ company_id: 'c1', mode: 'virement', vat_withholding_rate: 0, vat_withheld: 0, ir_withheld: 0, cash_vat_nondeductible: 0, cash_expense_nondeductible: 0, created_at: '2026-10-01T00:00:00Z', ...p });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-25T10:00:00'));
  state.db = createFakeDb({
    companies: [company()],
    quotes: quotes(),
    suppliers: [
      { id: 'S1', company_id: 'c1', name: 'Inox Maroc', legal_type: 'societe', if_number: '1234567', ice: '001234567000089', payment_days: 60 },
      { id: 'S3', company_id: 'c1', name: 'Atlas Travaux', legal_type: 'societe', if_number: '1112223', ice: null, payment_days: 60 },
    ],
    supplier_invoices: [
      sinv({ id: 'SI1', supplier_id: 'S1', supplier_invoice_number: 'FA-100', number: 'FF-2026-0001', invoice_date: '2026-09-28', total_ht: 10000, total_vat: 2000, total_ttc: 12000, description: 'Fours mixtes' }),
      sinv({ id: 'SI4', supplier_id: 'S3', supplier_invoice_number: 'FT-55', number: 'FF-2026-0002', invoice_date: '2026-10-15', total_ht: 10000, total_vat: 2000, total_ttc: 12000, nature: 'services', status: 'paid', description: 'Travaux' }),
    ],
    supplier_invoice_lines: [
      { id: 'l1', invoice_id: 'SI1', position: 0, label: 'Fours', amount_ht: 10000, vat_rate: 20, vat_amount: 2000, account_code: '6111', vat_nondeductible: false },
      { id: 'l4', invoice_id: 'SI4', position: 0, label: 'Travaux', amount_ht: 10000, vat_rate: 20, vat_amount: 2000, account_code: '6133', vat_nondeductible: false },
    ],
    supplier_payments: [
      spay({ id: 'P1', invoice_id: 'SI1', supplier_id: 'S1', payment_date: '2026-10-05', amount: 6000 }),
      spay({ id: 'P4', invoice_id: 'SI4', supplier_id: 'S3', payment_date: '2026-10-20', amount: 10000, vat_withheld: 2000, vat_withholding_rate: 100 }),
    ],
    vat_declarations: [],
    accounts: ['4455', '34551', '34552', '34581', '3456', '4456', '3421'].map(code => ({ id: code, company_id: 'c1', code, label: code, class: Number(code[0]), active: true, is_system: true })),
    accounting_fiscal_years: [{ id: 'fy2026', company_id: 'c1', label: '2026', start_date: '2026-01-01', end_date: '2026-12-31', status: 'open' }],
    journals: [{ id: 'j-od', company_id: 'c1', code: 'OD', label: 'OD', type: 'od' }],
    journal_entries: [{ id: 'e-inv', company_id: 'c1', fiscal_year_id: 'fy2026', journal_id: 'j-od', entry_date: '2026-10-05', status: 'posted', source_type: 'invoice', source_id: 'F1' }],
    journal_entry_lines: [
      { id: 'el1', entry_id: 'e-inv', company_id: 'c1', account_code: '3421', debit: 12000, credit: 0 },
      { id: 'el2', entry_id: 'e-inv', company_id: 'c1', account_code: '4455', debit: 0, credit: 2000 },
      { id: 'el3', entry_id: 'e-inv', company_id: 'c1', account_code: '7111', debit: 0, credit: 10000 },
    ],
  });
  // upsert(onConflict) updates the existing row, as Postgres does.
  state.db.strictUpsert = true;
  let ids = 0;
  state.db.failWrite = (table, op, payload) => {
    if (op === 'insert') for (const r of (Array.isArray(payload) ? payload : [payload]) as Record<string, unknown>[]) r.id ??= `${table}-${++ids}`;
  };
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });
  // jsdom cannot follow a download link.
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
});
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); vi.restoreAllMocks(); });

const open = () => render(<MemoryRouter><TvaPage /></MemoryRouter>);
const returnPanel = () => screen.getByText('Déclaration · octobre 2026').closest('section') as HTMLElement;
const rowOf = (label: string | RegExp) => within(returnPanel()).getAllByText(label)[0].closest('div') as HTMLElement;

describe('VAT return page', () => {
  it('computes October from the documents and lays out the return', async () => {
    open();
    await screen.findByText('Déclaration · octobre 2026');
    expect(screen.getByText(/au plus tard le 30\/11\/2026/)).toBeTruthy();
    expect(within(rowOf('Total TVA exigible')).getByText('5 000,00 Dh')).toBeTruthy();
    expect(within(rowOf('Total TVA déductible')).getByText('2 400,00 Dh')).toBeTruthy();
    expect(within(rowOf(/Crédit de la période précédente/)).getByText('− 1 000,00 Dh')).toBeTruthy();
    expect(within(rowOf(/TVA retenue à la source par les clients/)).getByText('− 4 000,00 Dh')).toBeTruthy();
    expect(within(rowOf('Crédit de TVA à reporter')).getByText('2 400,00 Dh')).toBeTruthy();
    // The pieces behind a line.
    // F3: its payment and its withholding in the 20 % line, and the withholding list.
    expect(within(returnPanel()).getAllByText('FAC2610-3').length).toBe(3);
    // Label about SIMPL-TVA, withheld VAT to pay apart, the relevé, the ledger.
    expect(screen.getByText('À reporter sur SIMPL-TVA.')).toBeTruthy();
    const apart = screen.getByText('À verser à part : TVA retenue sur vos fournisseurs').closest('section') as HTMLElement;
    expect(within(apart).getByText('novembre 2026')).toBeTruthy();
    expect(within(apart).getAllByText('2 000,00 Dh').length).toBe(2);
    expect(screen.getByText('Relevé de déductions (2 lignes)')).toBeTruthy();
    expect(screen.getByText(/Ligne 2 \(Atlas Travaux, facture FT-55\) : ICE du fournisseur manquant/)).toBeTruthy();
    const ledger = await screen.findByText('4455 TVA facturée (mouvements)');
    // Ledger 2 000 (F1 booked), documents at invoice date 6 000 (F1 2 000 + F3 4 000), return 5 000.
    expect(within(ledger.closest('tr') as HTMLElement).getAllByText(/Dh/).map(e => e.textContent)).toEqual(['2 000,00 Dh', '6 000,00 Dh', '5 000,00 Dh']);
    expect(screen.getByText(/un écart est normal/)).toBeTruthy();
    // PDF for the accountant's file.
    fireEvent.click(screen.getAllByRole('button', { name: /PDF/ })[0]);
    expect(URL.createObjectURL).toHaveBeenCalledWith(expect.objectContaining({ type: 'application/pdf' }));
  });

  it('blocks the EDI file while an ICE is missing, then exports the zipped XML', async () => {
    open();
    await screen.findByText('Déclaration · octobre 2026');
    fireEvent.click(screen.getByRole('button', { name: /Fichier EDI/ }));
    expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', title: 'Relevé incomplet' }));
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('exports the EDI zip once the data is complete', async () => {
    state.db.tables.suppliers[1].ice = '003000000000077';
    open();
    await screen.findByText('Déclaration · octobre 2026');
    let blob: Blob | undefined;
    vi.mocked(URL.createObjectURL).mockImplementation((b: Blob | MediaSource) => { blob = b as Blob; return 'blob:x'; });
    fireEvent.click(screen.getByRole('button', { name: /Fichier EDI/ }));
    await waitFor(() => expect(blob).toBeTruthy());
    const bytes = await new Promise<Uint8Array>(resolve => { const fr = new FileReader(); fr.onload = () => resolve(new Uint8Array(fr.result as ArrayBuffer)); fr.readAsArrayBuffer(blob!); });
    const files = unzipSync(bytes);
    expect(Object.keys(files)).toEqual(['ReleveDeductions_84016950_2026_M10.xml']);
    const xml = strFromU8(files['ReleveDeductions_84016950_2026_M10.xml']);
    expect(xml).toContain('<identifiantFiscal>84016950</identifiantFiscal>');
    expect(xml).toContain('<num>FT-55</num>');
    expect(xml).toContain('<prorata>80</prorata>');
  });

  it('saves a draft with its lists, files it, freezes it and reopens it after confirmation', async () => {
    open();
    await screen.findByText('Déclaration · octobre 2026');
    fireEvent.click(screen.getAllByRole('button', { name: /Enregistrer$/ })[0]);
    await waitFor(() => expect(state.db.tables.vat_declarations).toHaveLength(1));
    const draft = state.db.tables.vat_declarations[0];
    expect(draft).toMatchObject({ company_id: 'c1', period: '2026-10', period_type: 'M', status: 'draft', tva_facturee: 5000, tva_due: 0, credit_report: 2400, credit_precedent: 1000, tva_retenue_clients: 4000, prorata: 80 });
    expect(draft.snapshot.result.sales.byRate[0].items).toHaveLength(3);
    expect(draft.snapshot.releve).toHaveLength(2);
    expect(await screen.findByText('brouillon enregistré')).toBeTruthy();

    fireEvent.click(screen.getAllByRole('button', { name: /Marquer comme déposée/ })[0]);
    await waitFor(() => expect(state.db.tables.vat_declarations[0].status).toBe('filed'));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/figés/));
    expect(state.db.tables.vat_declarations[0].filed_by).toBe('sara');
    await screen.findAllByRole('button', { name: /Rouvrir/ });
    expect(screen.queryAllByRole('button', { name: /Marquer comme déposée/ })).toHaveLength(0);

    // A payment recorded afterwards does not change the filed return, the page says it moved.
    state.db.tables.quotes.push(doc({ id: 'F8', quote_number: 'FAC2610-8', quote_date: '2026-10-28', total_amount: 1200, payment_methods_json: [{ id: 'z', method: 'Virement', amount: 1200, date: '2026-10-29', kind: 'payment' }] }));
    vi.mocked(window.confirm).mockReturnValue(false);
    fireEvent.click(screen.getAllByRole('button', { name: /Rouvrir/ })[0]);
    expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/Rouvrir la déclaration déposée/));
    expect(state.db.tables.vat_declarations[0].status).toBe('filed');
  });

  it('shows a filed return as stored, and the change since', async () => {
    const first = open();
    await screen.findByText('Déclaration · octobre 2026');
    fireEvent.click(screen.getAllByRole('button', { name: /Marquer comme déposée/ })[0]);
    await screen.findAllByRole('button', { name: /Rouvrir/ });
    first.unmount();
    // F8: 1 200 received on 29/10 after filing → VAT 200; live credit 2 400 − 200 = 2 200.
    state.db.tables.quotes.push(doc({ id: 'F8', quote_number: 'FAC2610-8', quote_date: '2026-10-28', total_amount: 1200, payment_methods_json: [{ id: 'z', method: 'Virement', amount: 1200, date: '2026-10-29', kind: 'payment' }] }));
    open();
    await screen.findByText('Déclaration · octobre 2026');
    expect(screen.getByText(/les montants et les listes affichés sont ceux enregistrés/)).toBeTruthy();
    expect(screen.getByText(/le calcul actuel donne 2 200,00 Dh de crédit/)).toBeTruthy();
    expect(within(rowOf('Total TVA exigible')).getByText('5 000,00 Dh')).toBeTruthy();
    expect(within(returnPanel()).queryByText('FAC2610-8')).toBeNull();
    // Reopening, confirmed, recomputes from the documents.
    fireEvent.click(screen.getAllByRole('button', { name: /Rouvrir/ })[0]);
    await waitFor(() => expect(state.db.tables.vat_declarations[0]).toMatchObject({ status: 'draft', reopened_by: 'sara' }));
    await waitFor(() => expect(within(rowOf('Total TVA exigible')).getByText('5 200,00 Dh')).toBeTruthy());
  });

  it('starts November from the credit of the filed October return', async () => {
    // A stored list the page cannot read (an older or damaged snapshot) is not shown as the return.
    state.db.tables.vat_declarations.push({ id: 'd10', company_id: 'c1', period: '2026-10', period_type: 'M', status: 'filed', credit_report: 2400, tva_due: 0, snapshot: { version: 1, result: { deductions: { items: [] } } } });
    open();
    await screen.findByText('Déclaration · octobre 2026');
    expect(screen.getByText(/détail enregistré de cette déclaration est illisible/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Mois'), { target: { value: '11' } });
    const panelEl = (await screen.findByText('Déclaration · novembre 2026')).closest('section') as HTMLElement;
    expect(within(panelEl).getByText(/Crédit de la déclaration octobre 2026 \(déposée\)/)).toBeTruthy();
    expect(within(panelEl).getAllByText('− 2 400,00 Dh').length).toBeGreaterThan(0);
  });

  it('creates the OD entry as a draft, balanced', async () => {
    open();
    await screen.findByText('Déclaration · octobre 2026');
    fireEvent.click(screen.getByRole('button', { name: /Créer l’écriture en brouillon/ }));
    await waitFor(() => expect(state.db.tables.journal_entries.some(e => e.source_id === 'tva:2026-10')).toBe(true));
    const entry = state.db.tables.journal_entries.find(e => e.source_id === 'tva:2026-10')!;
    expect(entry).toMatchObject({ status: 'draft', entry_date: '2026-10-31', journal_id: 'j-od' });
    const lines = state.db.tables.journal_entry_lines.filter(l => l.entry_id === entry.id);
    // D 4455 5 000 | C 34552 2 400 | C 34581 4 000 | C 3456 1 000 | D 3456 2 400
    expect(lines.map(l => [l.account_code, l.debit, l.credit])).toEqual([['4455', 5000, 0], ['34552', 0, 2400], ['34581', 0, 4000], ['3456', 0, 1000], ['3456', 2400, 0]]);
  });

  it('saves the VAT settings from the page', async () => {
    open();
    await screen.findByText('Déclaration · octobre 2026');
    fireEvent.click(screen.getByRole('button', { name: /Réglages TVA/ }));
    fireEvent.change(screen.getByLabelText('Périodicité'), { target: { value: 'T' } });
    fireEvent.change(screen.getByLabelText('Prorata de déduction (%)'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: /Enregistrer les réglages/ }));
    await waitFor(() => expect(state.db.tables.companies[0]).toMatchObject({ vat_periodicity: 'T', vat_prorata: 100 }));
    // Quarterly now: the period to file on 25/11 is the third quarter, due by 31/10.
    expect(await screen.findByText('Déclaration · 3e trimestre 2026')).toBeTruthy();
    expect(screen.getByText(/au plus tard le 31\/10\/2026/)).toBeTruthy();
  });
});

describe('before the migration is run', () => {
  beforeEach(() => {
    // No VAT columns on the company; supplier tables missing; declarations without the new columns.
    const { vat_regime: _a, vat_periodicity: _b, vat_prorata: _c, vat_opening_credit: _d, vat_start_date: _e, ...old } = company();
    state.db.tables.companies = [old];
    state.db.tables.vat_declarations = [{ id: 'old', company_id: 'c1', period: '2026-T3', period_type: 'T', status: 'draft', credit_report: 300, tva_due: 0 }];
    const ids = { n: 0 };
    state.db.failRead = t => (t.startsWith('supplier') ? `Could not find the table 'public.${t}' in the schema cache` : undefined);
    state.db.failWrite = (table, op, payload) => {
      const rows = (Array.isArray(payload) ? payload : [payload]) as Record<string, unknown>[];
      if (table === 'vat_declarations' && rows.some(r => 'snapshot' in r)) return "Could not find the 'snapshot' column of 'vat_declarations' in the schema cache";
      if (table === 'companies' && rows.some(r => 'vat_regime' in r)) return "Could not find the 'vat_regime' column of 'companies' in the schema cache";
      if (op === 'insert') for (const r of rows) r.id ??= `${table}-${++ids.n}`;
    };
  });

  it('still computes and shows the return, says what to run, and refuses to save without the new columns', async () => {
    open();
    // Defaults: cash basis, prorata 100 %; no periodicity stored and no sale in 2025 → quarterly proposed (art. 108-II-3°): the third quarter is due.
    await screen.findByText('Déclaration · 3e trimestre 2026');
    expect(screen.getByText(/Périodicité non choisie dans les réglages : trimestrielle proposée/)).toBeTruthy();
    expect(screen.getByText(/Réglages TVA par défaut/)).toBeTruthy();
    expect(screen.getAllByText('20261127120000_vat_return.sql').length).toBeGreaterThan(0);
    expect(screen.getByText(/Les factures fournisseurs ne sont pas installées/)).toBeTruthy();
    expect(screen.getByText(/ancienne version de la page/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: /Enregistrer$/ })[0]);
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', message: expect.stringMatching(/exécutez la migration 20261127120000_vat_return\.sql/) })));
    expect(state.db.tables.vat_declarations).toHaveLength(1);
    expect(state.db.tables.vat_declarations[0].status).toBe('draft');
  });

  it('refuses to save the VAT settings and says why', async () => {
    open();
    await screen.findByText(/Déclaration · /);
    fireEvent.click(screen.getByRole('button', { name: /Réglages TVA/ }));
    fireEvent.change(screen.getByLabelText('Périodicité'), { target: { value: 'M' } });
    fireEvent.click(screen.getByRole('button', { name: /Enregistrer les réglages/ }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', message: expect.stringMatching(/Réglages TVA non enregistrés : exécutez la migration/) })));
  });
});
