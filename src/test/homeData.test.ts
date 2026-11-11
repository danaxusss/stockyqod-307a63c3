import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeDb, fakeClient, type FakeDb } from './fakeSupabase';

const state = vi.hoisted(() => ({ db: null as unknown as FakeDb }));
vi.mock('../utils/supabaseClient', () => ({ get supabase() { return fakeClient(state.db); } }));
vi.mock('../utils/supabaseCompanyFilter', () => ({
  getCompanyContext: () => ({ companyId: 'c1', bypassFilter: false, isSuperAdmin: false, isCompta: false }),
}));

import { loadHomeData, docStatus, docPath } from '../utils/homeData';
import { computeAccess, type AccessFlags } from '../lib/navigation';
import { formatMoney, formatRelativeDay } from '../utils/format';
import { searchProducts, searchPages, ilikePattern } from '../utils/commandSearch';
import { buildModules } from '../lib/navigation';
import type { Product } from '../types';

const none: AccessFlags = {
  canCreateQuote: false, isAdmin: false, isSuperAdmin: false, isFacturation: false, isCompta: false, isManager: false,
  isSeniorSales: false, isJuniorSales: false, isPaie: false, isStock: false, isTasks: false, isTasksOnly: false, tasksRole: null,
};
const access = (f: Partial<AccessFlags>) => computeAccess({ ...none, ...f });
const doc = (id: string, extra: Record<string, unknown>) => ({
  id, quote_number: id.toUpperCase(), document_type: 'quote', status: 'pending', company_id: 'c1', created_by: 'ali',
  customer_info: { fullName: `Client ${id}`, phoneNumber: '0661234510' }, total_amount: 1000, paid_amount: 0,
  created_at: '2026-11-01T10:00:00Z', updated_at: '2026-11-02T10:00:00Z', ...extra,
});

beforeEach(() => {
  state.db = createFakeDb({
    quotes: [
      doc('q1', {}),
      doc('q2', { created_by: 'sara', updated_at: '2026-11-01T09:00:00Z' }),
      doc('q3', { status: 'final' }),
      doc('q4', { company_id: 'c2' }),
      doc('f1', { document_type: 'invoice', status: 'draft', total_amount: 1200, paid_amount: 200, created_at: '2026-11-03T10:00:00Z' }),
      doc('f2', { document_type: 'invoice', status: 'solde', total_amount: 900, paid_amount: 900 }),
      doc('b1', { document_type: 'bl', status: 'final', created_at: '2026-11-05T10:00:00Z' }),
    ],
    tasks: [
      { id: 't1', company_id: 'c1', type: 'delivery', status: 'pending', client_name: 'Hôtel Atlas', assigned_to: 'u-tech', priority: 'high', due_date: '2026-11-10' },
      { id: 't2', company_id: 'c1', type: 'technical_intervention', status: 'doing', client_name: 'Snack', assigned_to: 'u-other', priority: 'urgent', due_date: null },
      { id: 't3', company_id: 'c1', type: 'delivery', status: 'done', client_name: 'Riad', assigned_to: 'u-tech', priority: 'low', due_date: null },
    ],
  });
});

describe('home page data, by role', () => {
  it('shows a junior salesperson only their own quotes, and no invoices or tasks', async () => {
    const data = await loadHomeData({ access: access({ canCreateQuote: true, isJuniorSales: true }), username: 'ali', userId: 'u1' });
    expect(data.followUps?.map(d => d.id)).toEqual(['q1']);
    expect(data.unpaid).toBeNull();
    expect(data.tasks).toBeNull();
    expect(data.recent?.every(d => d.type === 'quote')).toBe(true);
  });

  it('shows a manager every pending quote of the company, oldest first', async () => {
    const data = await loadHomeData({ access: access({ canCreateQuote: true, isManager: true, isStock: true }), username: 'boss', userId: 'u2' });
    expect(data.followUps?.map(d => d.id)).toEqual(['q2', 'q1']);
  });

  it('lists unpaid invoices with what is left to pay for billing staff', async () => {
    const data = await loadHomeData({ access: access({ isFacturation: true }), username: 'fat', userId: 'u3' });
    expect(data.followUps).toBeNull();
    expect(data.unpaid?.map(d => [d.id, d.total - d.paid])).toEqual([['f1', 1000]]);
    // No quote rights: recent documents leave quotes out.
    expect(data.recent?.map(d => d.type).sort()).toEqual(['bl', 'invoice', 'invoice']);
  });

  it('gives a technician only the open tasks assigned to them', async () => {
    const tech = await loadHomeData({ access: access({ isTasks: true, isTasksOnly: true, tasksRole: 'technician' }), username: 'tech', userId: 'u-tech' });
    expect(tech.tasks?.map(t => t.id)).toEqual(['t1']);
    const admin = await loadHomeData({ access: access({ isSuperAdmin: true, isAdmin: true, isTasks: true, tasksRole: 'super_admin' }), username: 'admin', userId: 'u0' });
    expect(admin.tasks?.map(t => t.id)).toEqual(['t1', 't2']);
  });

  it('keeps the other sections when one fails', async () => {
    Object.defineProperty(state.db.tables, 'tasks', { get() { throw new Error('boom'); } });
    const data = await loadHomeData({ access: access({ isSuperAdmin: true, isAdmin: true, isTasks: true, canCreateQuote: true }), username: 'admin', userId: 'u0' });
    expect(data.tasks).toBeNull();
    expect(data.followUps?.length).toBe(2);
  });
});

describe('document labels and links', () => {
  it('describes payment and quote states', () => {
    expect(docStatus({ type: 'invoice', status: 'draft', total: 1000, paid: 0 })).toEqual({ label: 'Non payée', tone: 'red' });
    expect(docStatus({ type: 'invoice', status: 'draft', total: 1000, paid: 250 })).toEqual({ label: 'Payée 25 %', tone: 'amber' });
    expect(docStatus({ type: 'invoice', status: 'solde', total: 1000, paid: 1000 }).label).toBe('Payée');
    expect(docStatus({ type: 'quote', status: 'pending', total: 1, paid: 0 }).label).toBe('Envoyé');
    expect(docPath({ id: 'x', type: 'bl' })).toBe('/compta/bls/x');
    expect(docPath({ id: 'x', type: 'quote' })).toBe('/quote-cart/x');
  });

  it('formats money and recent days the same way everywhere', () => {
    expect(formatMoney(7246.667)).toBe('7 246,67 Dh');
    expect(formatMoney(1200)).toBe('1 200,00 Dh');
    const now = new Date('2026-11-09T12:00:00');
    expect(formatRelativeDay('2026-11-09T08:00:00', now)).toBe('Aujourd’hui');
    expect(formatRelativeDay('2026-11-08T08:00:00', now)).toBe('Hier');
    expect(formatRelativeDay('2026-11-06T08:00:00', now)).toBe('il y a 3 j');
  });
});

describe('global search matching', () => {
  const p = (barcode: string, name: string, brand: string) => ({ barcode, name, brand }) as Product;
  const products = [p('611000000016', 'FOUR À PIZZA 2 CHAMBRES', 'ELECTROLUX'), p('611000000000', 'FOUR MIXTE 10 NIVEAUX', 'RATIONAL'), p('611000000021', 'Batteur', 'KITCHENAID')];

  it('ignores accents and case, and needs every word', () => {
    expect(searchProducts(products, 'four a pizza').map(x => x.barcode)).toEqual(['611000000016']);
    expect(searchProducts(products, 'four').map(x => x.barcode)).toEqual(['611000000016', '611000000000']);
    expect(searchProducts(products, 'rational four').map(x => x.barcode)).toEqual(['611000000000']);
  });

  it('puts an exact barcode first and leaves out brands the user may not see', () => {
    expect(searchProducts(products, '611000000021')[0].barcode).toBe('611000000021');
    expect(searchProducts(products, 'four', 6, x => x.brand !== 'RATIONAL').map(x => x.barcode)).toEqual(['611000000016']);
  });

  it('finds pages of the user’s own menu only', () => {
    const sales = buildModules(access({ canCreateQuote: true, isJuniorSales: true }));
    expect(searchPages(sales, 'devis').map(x => x.to)).toEqual(['/quotes-history', '/quote-cart']);
    expect(searchPages(sales, 'factures')).toEqual([]);
  });

  it('escapes search text for the database', () => {
    expect(ilikePattern('50%_off, (x)')).toBe('%50\\%\\_off   x %');
  });
});
