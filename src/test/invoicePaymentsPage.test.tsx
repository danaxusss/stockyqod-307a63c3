import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeDb, fakeClient, type FakeDb } from './fakeSupabase';

// The invoice page with dated payments, VAT withheld by the client, stamp
// duty on cash, the cash limit warning, the attestation and finalisation.
const state = vi.hoisted(() => ({ db: null as unknown as FakeDb }));
vi.mock('../utils/supabaseClient', () => ({ get supabase() { return fakeClient(state.db); } }));
vi.mock('../integrations/supabase/client', () => ({ get supabase() { return fakeClient(state.db); } }));
vi.mock('../utils/supabaseCompanyFilter', () => ({ getCompanyContext: () => ({ companyId: 'c1', bypassFilter: false, isSuperAdmin: false, isCompta: true }) }));
vi.mock('../utils/session', () => ({ getToken: () => null }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ isSuperAdmin: false, isCompta: true, currentUser: { username: 'sara' } }) }));
const showToast = vi.hoisted(() => vi.fn());
vi.mock('../context/ToastContext', () => ({ useToast: () => ({ showToast }) }));

import InvoiceDetailPage from '../pages/compta/InvoiceDetailPage';
import { invalidateCompaniesCache } from '../utils/supabaseCompanies';
import { addDays, localDay } from '../utils/documentLines';

const today = localDay();
const ym = `${today.slice(2, 4)}${today.slice(5, 7)}`;
const fr = (day: string) => day.split('-').reverse().join('/');
const invoice = (extra: Record<string, unknown> = {}) => ({
  id: 'f1', quote_number: 'CM2611-4', document_type: 'invoice', status: 'final', company_id: 'c1', issuing_company_id: 'c1',
  created_at: '2026-11-01T10:00:00.000Z', updated_at: '2026-11-01T10:00:00.000Z', quote_date: addDays(today, -5), due_date: addDays(today, 55),
  customer_info: { fullName: 'Hôtel Atlas', phoneNumber: '0661234510', address: '', city: 'Rabat', salesPerson: '', ice: '001234567000089' },
  items: [{ id: 'a', quantity: 1, unitPrice: 1200, subtotal: 1200, quoteName: 'Four mixte', addedAt: '2026-10-01T00:00:00Z' }],
  total_amount: 1200, paid_amount: 0, avance_amount: 0, payment_methods_json: [], source_bl_ids: [], tva_rate: 20, ...extra,
});
const company = (extra: Record<string, unknown> = {}) => ({
  id: 'c1', name: 'Cuisimat', doc_prefix: 'CM', tva_rate: 20, payment_terms_days: 60, tax_attestation_date: addDays(today, -30), cash_stamp_duty: false, ...extra,
});

const renderPage = () => render(
  <MemoryRouter initialEntries={['/compta/invoices/f1']}>
    <Routes><Route path="/compta/invoices/:id" element={<InvoiceDetailPage />} /></Routes>
  </MemoryRouter>,
);
const stored = () => state.db.tables.quotes[0];
const save = () => fireEvent.click(screen.getAllByRole('button', { name: /^Enregistrer$/ })[0]);

beforeEach(() => {
  invalidateCompaniesCache();
  showToast.mockClear();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  state.db = createFakeDb({
    quotes: [invoice()],
    companies: [company()],
    clients: [{ id: 'k1', full_name: 'Hôtel Atlas', phone_number: '0661234510', ice: '001234567000089', company_id: 'c1', is_individual: false }],
    journal_entries: [],
  });
  state.db.rpc.next_document_number = () => 1;
});

describe('payments on the invoice page', () => {
  it('lists every settlement at its date, the withholding apart from the money received', async () => {
    stored().payment_methods_json = [
      { id: 'b1', method: 'Virement bancaire', amount: 1000, date: addDays(today, -2), reference: 'VIR-1' },
      { id: 'w1', kind: 'vat_withholding', method: 'TVA retenue à la source', amount: 200, date: addDays(today, -1), withholding_rate: 100 },
    ];
    renderPage();
    const list = await screen.findByRole('list', { name: 'Règlements' });
    const lines = within(list).getAllByRole('listitem').map(li => li.textContent);
    expect(lines[0]).toMatch(new RegExp(`^${fr(addDays(today, -2))} · Virement bancaire · VIR-1.*1\\s000,00`));
    expect(lines[1]).toMatch(new RegExp(`^${fr(addDays(today, -1))} · TVA retenue par le client.*200,00`));
    expect(screen.getByText('Encaissé').nextSibling?.textContent).toMatch(/1\s000,00/);
    expect(screen.getByText('TVA retenue par le client', { selector: 'dt' }).nextSibling?.textContent).toMatch(/200,00/);
    expect(screen.getAllByText('Facture soldée').length).toBeGreaterThan(0);
  });

  it('records a dated payment, with the stamp duty on cash when the company applies it', async () => {
    state.db.tables.companies[0].cash_stamp_duty = true;
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Enregistrer un paiement/ }));
    expect((screen.getByLabelText('Date du règlement') as HTMLInputElement).value).toBe(today);
    fireEvent.change(screen.getByLabelText('Mode de règlement'), { target: { value: 'Espèces' } });
    expect(screen.getByText(/Droit de timbre 0,25 % : 3,00.*à encaisser : 1\s203,00/)).toBeTruthy();
    save();
    await waitFor(() => expect(stored().payment_methods_json).toHaveLength(1));
    expect(stored().payment_methods_json[0]).toMatchObject({ method: 'Espèces', amount: 1200, date: today, kind: 'payment', stamp_duty: 3 });
    expect(stored().paid_amount).toBe(1200);
  });

  it('saves a new cash advance as a dated settlement carrying its stamp duty; an old one is left alone', async () => {
    state.db.tables.companies[0].cash_stamp_duty = true;
    const first = renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Modifier la facture/ }));
    fireEvent.change(screen.getByLabelText('Mode'), { target: { value: 'Espèces' } });
    fireEvent.click(screen.getByLabelText('Avance sur facture'));
    fireEvent.change(screen.getByLabelText('Montant de l’avance (Dh)'), { target: { value: '400' } });
    expect(screen.getByText(/Droit de timbre 0,25 % : 1,00.*à encaisser : 401,00/)).toBeTruthy();
    save();
    await waitFor(() => expect(stored().payment_methods_json).toHaveLength(1));
    expect(stored().avance_amount).toBe(0);
    expect(stored().payment_methods_json[0]).toMatchObject({ method: 'Espèces', amount: 400, stamp_duty: 1 });

    // An advance recorded before the setting was on gets no duty when the invoice is saved again.
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Facture mise à jour' })));
    first.unmount();
    showToast.mockClear();
    Object.assign(stored(), { avance_amount: 300, payment_method: 'Espèces', payment_methods_json: [] });
    invalidateCompaniesCache();
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Modifier la facture/ }));
    save();
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Facture mise à jour' })));
    expect(stored()).toMatchObject({ avance_amount: 300, payment_methods_json: [] });
  });

  it('records no stamp duty when the setting is off', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Enregistrer un paiement/ }));
    fireEvent.change(screen.getByLabelText('Mode de règlement'), { target: { value: 'Espèces' } });
    expect(screen.queryByText(/Droit de timbre 0,25 %/)).toBeNull();
    save();
    await waitFor(() => expect(stored().payment_methods_json).toHaveLength(1));
    expect(stored().payment_methods_json[0]).not.toHaveProperty('stamp_duty');
  });

  it('refuses a payment dated before the invoice unless ticked as an advance', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Enregistrer un paiement/ }));
    fireEvent.change(screen.getByLabelText('Date du règlement'), { target: { value: addDays(today, -10) } });
    expect(screen.getByText(/précède la facture/)).toBeTruthy();
    save();
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', message: expect.stringMatching(/précède la facture/) })));
    expect(stored().payment_methods_json).toHaveLength(0);
    fireEvent.click(screen.getByLabelText('Avance reçue avant la facture'));
    save();
    await waitFor(() => expect(stored().payment_methods_json).toHaveLength(1));
    expect(stored().payment_methods_json[0]).toMatchObject({ date: addDays(today, -10), advance: true });
  });

  it('records the VAT withheld by the client, defaulting to the invoice VAT', async () => {
    stored().payment_methods_json = [{ id: 'b1', method: 'Virement bancaire', amount: 1000, date: today }];
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'TVA retenue par le client' }));
    expect((screen.getByLabelText('Montant de la TVA retenue') as HTMLInputElement).value).toBe('200');
    save();
    await waitFor(() => expect(stored().payment_methods_json).toHaveLength(2));
    expect(stored().payment_methods_json[1]).toMatchObject({ kind: 'vat_withholding', amount: 200, date: today, withholding_rate: 100 });
    expect(stored().paid_amount).toBe(1200);
  });

  it('warns, without blocking, about cash on a sale of 20,000 DH or more', async () => {
    Object.assign(stored(), { total_amount: 30000, items: [{ id: 'a', quantity: 1, unitPrice: 30000, subtotal: 30000, quoteName: 'Chambre froide', addedAt: '2026-10-01T00:00:00Z' }] });
    stored().payment_methods_json = [{ id: 'c1', method: 'Espèces', amount: 5000, date: today }];
    renderPage();
    expect(await screen.findByText(/amende est de 6 % de la transaction, soit 1\s800,00 DH/)).toBeTruthy();
  });
});

describe('attestation de régularité fiscale on the invoice', () => {
  it('warns when it is missing or older than 6 months, not when valid', async () => {
    state.db.tables.companies[0].tax_attestation_date = null;
    const { unmount } = renderPage();
    expect(await screen.findByText(/non renseignée : vos clients assujettis doivent retenir la TVA/)).toBeTruthy();
    unmount();
    invalidateCompaniesCache();
    state.db.tables.companies[0].tax_attestation_date = addDays(today, -200);
    const second = renderPage();
    expect(await screen.findByText(/plus de 6 mois/)).toBeTruthy();
    second.unmount();
    invalidateCompaniesCache();
    state.db.tables.companies[0].tax_attestation_date = addDays(today, -170);
    const third = renderPage();
    expect(await screen.findByText(/valable jusqu’au.*demandez-en une nouvelle/)).toBeTruthy();
    third.unmount();
    invalidateCompaniesCache();
    state.db.tables.companies[0].tax_attestation_date = addDays(today, -10);
    renderPage();
    await screen.findByText('Hôtel Atlas');
    expect(screen.queryByText(/régularité fiscale/)).toBeNull();
  });

  it('says nothing before the migration is run (the setting cannot be saved yet)', async () => {
    state.db.tables.companies = [{ id: 'c1', name: 'Cuisimat', doc_prefix: 'CM', tva_rate: 20, payment_terms_days: 60 }];
    renderPage();
    await screen.findByText('Hôtel Atlas');
    expect(screen.queryByText(/régularité fiscale/)).toBeNull();
  });
});

describe('a draft invoice', () => {
  it('shows no number until it is finalised, then takes the next one', async () => {
    Object.assign(stored(), { quote_number: 'BROUILLON-3F9A2C', status: 'draft', quote_date: today });
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Facture brouillon' })).toBeTruthy();
    expect(screen.getByText(/Réf\. provisoire BROUILLON-3F9A2C/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Finaliser la facture/ }));
    await waitFor(() => expect(stored()).toMatchObject({ quote_number: `CM${ym}-1`, status: 'final' }));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/prochain numéro de la série/));
    expect(await screen.findByRole('heading', { name: `Facture CM${ym}-1` })).toBeTruthy();
  });

  it('keeps its provisional reference in edit mode and is not finalised by a cancelled confirmation', async () => {
    Object.assign(stored(), { quote_number: 'BROUILLON-3F9A2C', status: 'draft', quote_date: today });
    vi.mocked(window.confirm).mockReturnValue(false);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Modifier la facture/ }));
    const number = screen.getByLabelText('Numéro de facture') as HTMLInputElement;
    expect(number.disabled).toBe(true);
    expect(number.placeholder).toMatch(/finalisation/);
    fireEvent.change(screen.getByLabelText('Statut de la facture'), { target: { value: 'final' } });
    save();
    await waitFor(() => expect(window.confirm).toHaveBeenCalled());
    expect(stored()).toMatchObject({ quote_number: 'BROUILLON-3F9A2C', status: 'draft' });
  });
});
