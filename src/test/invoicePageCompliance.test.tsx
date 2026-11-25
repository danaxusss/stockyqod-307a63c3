import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeDb, fakeClient, type FakeDb } from './fakeSupabase';

// The invoice page with the billing rules: late invoices, booked invoices,
// the missing buyer ICE and its quick entry, the fixed number.
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
const invoice = (extra: Record<string, unknown> = {}) => ({
  id: 'f1', quote_number: 'CM2610-4', document_type: 'invoice', status: 'final', company_id: 'c1', issuing_company_id: 'c1',
  created_at: '2026-10-01T10:00:00.000Z', updated_at: '2026-10-01T10:00:00.000Z', quote_date: addDays(today, -70), due_date: addDays(today, -10),
  customer_info: { fullName: 'Hôtel Atlas', phoneNumber: '0661234510', address: '', city: 'Rabat', salesPerson: '' },
  items: [{ id: 'a', quantity: 1, unitPrice: 1200, subtotal: 1200, quoteName: 'Four mixte', addedAt: '2026-10-01T00:00:00Z' }],
  total_amount: 1200, paid_amount: 0, avance_amount: 0, payment_methods_json: [], source_bl_ids: [], tva_rate: 20, ...extra,
});

const renderPage = () => render(
  <MemoryRouter initialEntries={['/compta/invoices/f1']}>
    <Routes><Route path="/compta/invoices/:id" element={<InvoiceDetailPage />} /></Routes>
  </MemoryRouter>,
);

beforeEach(() => {
  invalidateCompaniesCache();
  showToast.mockClear();
  state.db = createFakeDb({
    quotes: [invoice()],
    companies: [{ id: 'c1', name: 'Cuisimat', doc_prefix: 'CM', tva_rate: 10, payment_terms_days: 60 }],
    clients: [{ id: 'k1', full_name: 'Hôtel Atlas', phone_number: '0661234510', ice: '', company_id: 'c1', is_individual: false }],
    journal_entries: [{ id: 'e1', company_id: 'c1', source_type: 'invoice', source_id: 'f1', status: 'posted' }],
  });
});

describe('invoice page', () => {
  it('shows a late, booked invoice at its own VAT rate, with no "TTC only" option', async () => {
    renderPage();
    expect(await screen.findByText(/En retard · 10 j/)).toBeTruthy();
    expect(screen.getByText('Comptabilisée')).toBeTruthy();
    expect(screen.getByText(/Cette facture est comptabilisée\. Extournez son écriture dans Comptabilité ou établissez un avoir\./)).toBeTruthy();
    // 20 % frozen on the invoice although the company is at 10 % now.
    expect(screen.getByText('TVA 20 %')).toBeTruthy();
    expect(screen.queryByText('Prix TTC uniquement')).toBeNull();
  });

  it('warns about the missing buyer ICE and saves it on the invoice and the client', async () => {
    renderPage();
    expect(await screen.findByText(/ICE du client manquant — obligatoire sur les factures aux professionnels \(art\. 145 CGI\), amende de 100 DH par omission/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('ICE du client'), { target: { value: '001 234 567 000 089' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer l’ICE' }));
    await waitFor(() => expect(state.db.tables.quotes[0].customer_info.ice).toBe('001234567000089'));
    // Booked, but completing the ICE does not change who was invoiced.
    expect(state.db.tables.quotes[0].customer_info.fullName).toBe('Hôtel Atlas');
    await waitFor(() => expect(state.db.tables.clients[0].ice).toBe('001234567000089'));
    await waitFor(() => expect(screen.queryByText(/ICE du client manquant/)).toBeNull());
  });

  it('does not warn for a private client', async () => {
    state.db.tables.clients[0].is_individual = true;
    renderPage();
    await screen.findByText(/En retard/);
    expect(screen.queryByText(/ICE du client manquant/)).toBeNull();
  });

  it('keeps the number of an issued invoice in edit mode', async () => {
    state.db.tables.journal_entries = [];
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Modifier la facture/ }));
    expect((screen.getByLabelText('Numéro de facture') as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByRole('option', { name: 'Brouillon' })).toBeNull();
    expect((screen.getByLabelText('Échéance') as HTMLInputElement).max).toBe(addDays(addDays(today, -70), 120));
  });
});
