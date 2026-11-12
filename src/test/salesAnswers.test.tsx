import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { createFakeDb, fakeClient, type FakeDb } from './fakeSupabase';

const state = vi.hoisted(() => ({ db: null as unknown as FakeDb }));
vi.mock('../utils/supabaseClient', () => ({ get supabase() { return fakeClient(state.db); } }));
vi.mock('../integrations/supabase/client', () => ({ get supabase() { return fakeClient(state.db); } }));
vi.mock('../utils/supabaseCompanyFilter', () => ({
  getCompanyContext: () => ({ companyId: 'c1', bypassFilter: false, isSuperAdmin: false, isCompta: false }),
}));

import { isQuoteOwnedBy, ownedQuotesFilter, quoteOwnerOf } from '../utils/quoteOwnership';
import { quoteMarginHT } from '../utils/quoteMargin';
import { loadHomeData } from '../utils/homeData';
import { SupabaseQuotesService } from '../utils/supabaseQuotes';
import { computeAccess, type AccessFlags } from '../lib/navigation';
import { QuoteReadOnlyView } from '../components/QuoteReadOnlyView';

const none: AccessFlags = {
  canCreateQuote: false, isAdmin: false, isSuperAdmin: false, isFacturation: false, isCompta: false, isManager: false,
  isSeniorSales: false, isJuniorSales: false, isPaie: false, isStock: false, isTasks: false, isTasksOnly: false, tasksRole: null,
};
const junior = computeAccess({ ...none, canCreateQuote: true, isJuniorSales: true });

// Live data: created_by holds the username ("YASSINE"), the seller is the
// user's seller name ("M. YASSINE"), and they often differ.
const doc = (id: string, createdBy: string, seller: string, extra: Record<string, unknown> = {}) => ({
  id, quote_number: id.toUpperCase(), document_type: 'quote', status: 'pending', company_id: 'c1', created_by: createdBy,
  customer_info: { fullName: `Client ${id}`, phoneNumber: '0661234510', salesPerson: seller }, items: [], total_amount: 1000, paid_amount: 0,
  created_at: `2026-11-0${id.slice(1)}T10:00:00Z`, updated_at: `2026-11-0${id.slice(1)}T10:00:00Z`, ...extra,
});

const yassine = quoteOwnerOf({ username: 'YASSINE', custom_seller_name: 'M. YASSINE' })!;

beforeEach(() => {
  state.db = createFakeDb({
    quotes: [
      doc('q1', 'YASSINE', 'M. YASSINE'),     // created and sold by him
      doc('q2', 'NOUREDINE', 'M. YASSINE'),   // made by someone else for him
      doc('q3', 'YASSINE', 'M. NOUREDINE'),   // made by him for someone else
      doc('q4', 'NOUREDINE', 'M. ISMAIL'),    // neither
      doc('q5', 'NOUREDINE', 'm. yassine'),   // seller in another case
    ],
  });
});

describe('who owns a quote', () => {
  it('uses the seller name, else the username', () => {
    expect(quoteOwnerOf({ username: 'ISMAIL', custom_seller_name: ' M. ISMAIL ' })).toEqual({ username: 'ISMAIL', sellerName: 'M. ISMAIL' });
    expect(quoteOwnerOf({ username: 'TAHA', custom_seller_name: '' })).toEqual({ username: 'TAHA', sellerName: 'TAHA' });
    expect(quoteOwnerOf({ username: '' })).toBeNull();
    expect(quoteOwnerOf(null)).toBeNull();
  });

  it('owns a quote they created or are named seller on, whatever the case', () => {
    const quote = (createdBy: string, seller: string) => ({ createdBy, customer: { salesPerson: seller } });
    expect(isQuoteOwnedBy(quote('YASSINE', 'M. ISMAIL'), yassine)).toBe(true);
    expect(isQuoteOwnedBy(quote('NOUREDINE', 'M. YASSINE'), yassine)).toBe(true);
    expect(isQuoteOwnedBy(quote('NOUREDINE', ' m. yassine'), yassine)).toBe(true);
    expect(isQuoteOwnedBy(quote('NOUREDINE', 'M. ISMAIL'), yassine)).toBe(false);
    expect(isQuoteOwnedBy(quote('', ''), null)).toBe(false);
  });

  it('builds a filter that cannot be broken by commas or wildcards in a name', () => {
    expect(ownedQuotesFilter(yassine)).toBe('created_by.ilike.YASSINE,customer_info->>salesPerson.ilike.M. YASSINE');
    const odd = ownedQuotesFilter({ username: 'a_b', sellerName: 'Dar (Fès), 100%' });
    expect(odd).toBe('created_by.ilike.a\\_b,customer_info->>salesPerson.ilike.Dar _Fès__ 100\\%');
    expect(odd.split(',')).toHaveLength(2);
  });
});

describe('salespeople see quotes they created or sell', () => {
  it('in the quote history', async () => {
    const quotes = await SupabaseQuotesService.getAllQuotes(undefined, { ownedBy: yassine });
    expect(quotes.map(q => q.id).sort()).toEqual(['q1', 'q2', 'q3', 'q5']);
  });

  it('on the home page', async () => {
    const data = await loadHomeData({ access: junior, username: 'YASSINE', sellerName: 'M. YASSINE', userId: 'u1' });
    expect(data.followUps?.map(d => d.id).sort()).toEqual(['q1', 'q2', 'q3', 'q5']);
    expect(data.recent?.map(d => d.id).sort()).toEqual(['q1', 'q2', 'q3', 'q5']);
  });
});

describe('estimated margin, purchase prices including TVA', () => {
  it('compares sale and purchase prices both without TVA', () => {
    // Bought 1 200 TTC (1 000 HT), sold 1 800 TTC (1 500 HT): 500 HT of margin.
    expect(quoteMarginHT({ totalTTC: 1800, purchaseTTC: 1200, tvaRate: 20 })).toBeCloseTo(500, 6);
    expect(quoteMarginHT({ totalTTC: 1200, purchaseTTC: 1200, tvaRate: 20 })).toBeCloseTo(0, 6);
    expect(quoteMarginHT({ totalTTC: 1100, purchaseTTC: 1100, tvaRate: 0 })).toBeCloseTo(0, 6);
  });
});

describe("another salesperson's quote", () => {
  const props = {
    quoteNumber: 'QT-9', quoteDate: '2026-11-04', status: 'pending' as const, customer: { fullName: 'Café Le Central', phoneNumber: '0661', address: 'Gueliz', salesPerson: 'M. ISMAIL' },
    lines: [{ id: 'l1', name: 'Four mixte', brand: 'RATIONAL', barcode: 'R1', quantity: 2, unitPriceTTC: 1200, totalTTC: 2400 }],
    totalTTC: 2400, tvaRate: 20, isExporting: false,
  };

  it('is read-only: PDF and preview only, no saving or sending', () => {
    const onExport = vi.fn();
    const onPreview = vi.fn();
    render(<QuoteReadOnlyView {...props} onExport={onExport} onPreview={onPreview} />);
    expect(screen.getByText(/Devis de M\. ISMAIL — lecture seule/)).toBeInTheDocument();
    expect(screen.getByText('Four mixte')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Télécharger le PDF/ }));
    expect(onExport).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Aperçu/ }));
    expect(onPreview).toHaveBeenCalled();
    for (const name of [/Enregistrer/, /WhatsApp/, /E-mail/, /livraison/]) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
  });
});
