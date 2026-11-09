import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { createFakeDb, fakeClient, type FakeDb } from './fakeSupabase';

const state = vi.hoisted(() => ({ db: null as unknown as FakeDb, companyId: 'c-user' as string | null, invoke: vi.fn() }));

const client = () => ({
  ...fakeClient(state.db),
  functions: { invoke: state.invoke },
  storage: { from: () => ({ getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn.test/${path}` } }) }) },
});
vi.mock('../utils/supabaseClient', () => ({ get supabase() { return client(); } }));
vi.mock('../integrations/supabase/client', () => ({ get supabase() { return client(); } }));
vi.mock('../utils/supabaseCompanyFilter', () => ({
  getCompanyContext: () => ({ companyId: state.companyId, bypassFilter: true, isSuperAdmin: true, isCompta: false }),
}));
vi.mock('../utils/session', async importOriginal => ({ ...(await importOriginal<typeof import('../utils/session')>()), getToken: () => 'tok' }));

import { createAttachmentsLink, findQuoteAttachments, attachmentsLabel } from '../utils/quoteAttachments';
import { quoteCompanyId, SupabaseQuotesService } from '../utils/supabaseQuotes';
import { KioskService, type KioskAdminProfile } from '../utils/kioskService';
import PublicSharePage from '../pages/PublicSharePage';
import type { Quote, QuoteItem } from '../types';

const item = (barcode: string, image: string | null): QuoteItem => ({
  id: barcode, product: { barcode, name: `Produit ${barcode}`, brand: 'Rational', image } as never,
  priceType: 'normal', marginPercentage: 0, finalPrice: 10, addedAt: new Date(), unitPrice: 10, quantity: 1, subtotal: 10,
});

beforeEach(() => {
  state.companyId = 'c-user';
  state.invoke.mockReset();
  state.db = createFakeDb({
    technical_sheet_products: [{ sheet_id: 's1', product_barcode: 'A' }],
    products: [{ barcode: 'B', image: 'b-current.jpg' }, { barcode: 'C', image: null }],
    sheet_share_links: [],
    quotes: [],
  });
});

describe('sheets joined to a quote', () => {
  it('uses the photo of each product that has no technical sheet', async () => {
    const found = await findQuoteAttachments([item('A', 'a.jpg'), item('B', 'b-old.jpg'), item('C', null), item('D', 'folder/d.png')]);
    expect(found.sheetIds).toEqual(['s1']);
    // A has a sheet; B uses its current photo; C has none; D keeps the quote's.
    expect(found.images.map(i => [i.barcode, i.url])).toEqual([
      ['B', `${window.location.origin}/catalogue-images/b-current.jpg`],
      ['D', 'https://cdn.test/folder/d.png'],
    ]);
    expect(attachmentsLabel(found)).toBe('Consulter les fiches techniques et photos');
  });

  it('shares sheets and photos in one link, and sheets alone before the migration', async () => {
    const found = { sheetIds: ['s1'], images: [{ barcode: 'B', name: 'Produit B', brand: 'R', url: 'https://x/b.jpg' }] };
    const link = await createAttachmentsLink('QT-1', found, 30);
    expect(state.db.tables.sheet_share_links[0]).toMatchObject({ sheet_ids: ['s1'], product_images: found.images, title: 'Devis QT-1' });
    expect(link).toMatchObject({ expiryLabel: '30 jours', imagesDropped: false });

    state.db.failWrite = (_t, _op, payload) => ((payload as Record<string, unknown>).product_images ? 'column "product_images" does not exist' : undefined);
    const fallback = await createAttachmentsLink('QT-2', found, null);
    expect(fallback).toMatchObject({ imagesDropped: true, label: 'Consulter les fiches techniques', expiryLabel: 'permanent' });
    await expect(createAttachmentsLink('QT-3', { sheetIds: [], images: found.images }, null)).rejects.toThrow(/migration/);
  });

  it('shows the photos on the public share page', async () => {
    state.db.tables.sheet_share_links.push({
      id: 'l1', token: 'tok-1', title: 'Devis QT-1', sheet_ids: [], expires_at: null, view_count: 0,
      product_images: [{ barcode: 'B', name: 'Batteur 7L', brand: 'KitchenAid', url: 'https://cdn.test/b.jpg' }],
    });
    render(<MemoryRouter initialEntries={['/share/tok-1']}><Routes><Route path="/share/:token" element={<PublicSharePage />} /></Routes></MemoryRouter>);
    expect(await screen.findByText('Photos des produits')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Batteur 7L' })).toHaveAttribute('src', 'https://cdn.test/b.jpg');
    expect(screen.getByText('1 photo')).toBeInTheDocument();
  });
});

describe('quote letterhead company', () => {
  it('loads the quote company and keeps it when someone else edits the quote', async () => {
    state.db.tables.quotes.push({ id: 'q1', quote_number: 'QT-1', created_at: '2026-11-01', updated_at: '2026-11-01', status: 'draft', customer_info: {}, items: [], total_amount: 0, notes: null, notes2: 'interne', quote_date: '2026-10-30', company_id: 'c-cuisimat', created_by: 'ali' });
    const quote = await SupabaseQuotesService.getQuote('q1') as Quote;
    expect(quote).toMatchObject({ company_id: 'c-cuisimat', notes2: 'interne', quote_date: '2026-10-30' });
    expect(quoteCompanyId(quote)).toBe('c-cuisimat');
    expect(quoteCompanyId({ issuing_company_id: 'c-issuer', company_id: 'c-cuisimat' })).toBe('c-issuer');
    expect(quoteCompanyId(null)).toBe('c-user');

    // A user of another company saves it: it stays a Cuisimat quote.
    await SupabaseQuotesService.saveQuote({ ...quote, updatedAt: new Date() });
    expect(state.db.tables.quotes[1]).toMatchObject({ company_id: 'c-cuisimat', notes2: 'interne', quote_date: '2026-10-30' });
  });
});

describe('kiosk showcase setting', () => {
  const profile = { id: 'p1', showcase_enabled: true } as KioskAdminProfile;

  it('says when the deployed kiosk function drops the showcase', async () => {
    state.invoke.mockResolvedValue({ data: { profile: { id: 'p1', showcase_enabled: false } }, error: null });
    await expect(KioskService.saveProfile(profile)).rejects.toThrow(/ancienne version/);
    state.invoke.mockResolvedValue({ data: { profile: { id: 'p1' } }, error: null });
    await expect(KioskService.saveProfile(profile)).rejects.toThrow(/migration 20261028120000/);
    state.invoke.mockResolvedValue({ data: { profile: { id: 'p1', showcase_enabled: true } }, error: null });
    await expect(KioskService.saveProfile(profile)).resolves.toMatchObject({ showcase_enabled: true });
  });
});
