import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

// Public pages and the login list run before anyone is signed in: since
// secure login step 2 they only talk to edge functions, never to tables.
const state = vi.hoisted(() => ({
  invoke: vi.fn(),
  from: vi.fn(() => { throw new Error('public pages must not read tables'); }),
  rpc: vi.fn(),
}));

vi.mock('../integrations/supabase/client', () => ({
  supabase: { functions: { invoke: state.invoke }, from: state.from, rpc: state.rpc, channel: vi.fn() },
}));
vi.mock('../utils/supabaseClient', () => ({
  supabase: { functions: { invoke: state.invoke }, from: state.from, rpc: state.rpc },
}));

import PublicSharePage from '../pages/PublicSharePage';
import TrackDelivery from '../tasks/pages/TrackDelivery';
import { LanguageProvider as TasksLanguageProvider } from '../tasks/contexts/LanguageContext';
import { getLoginProfiles } from '../utils/supabaseUsers';

type Body = Record<string, unknown>;
const reply = (data: unknown) => ({ data, error: null });

beforeEach(() => {
  state.invoke.mockReset();
  state.from.mockClear();
  state.rpc.mockReset();
});

const sheet = { id: '11111111-1111-4111-8111-111111111111', title: 'Fiche four', manufacturer: 'Rational', category: 'Four', sector: '', file_url: 'https://cdn.test/s1.pdf', file_size: 2048, file_type: 'application/pdf' };

describe('public share page', () => {
  it('shows the sheets from the public-share function and counts a download there', async () => {
    state.invoke.mockImplementation(async (fn: string, { body }: { body: Body }) => {
      if (fn === 'public-share' && body.action === 'get') return reply({ status: 'ok', link: { title: 'Devis QT-9', expires_at: null, product_images: [] }, sheets: [sheet], company: null });
      if (fn === 'public-share' && body.action === 'downloaded') return reply({ status: 'ok', counted: 1 });
      return { data: null, error: new Error('unexpected ' + fn) };
    });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new Blob(['%PDF'])));
    const createUrl = vi.fn(() => 'blob:x');
    Object.assign(URL, { createObjectURL: createUrl, revokeObjectURL: vi.fn() });

    render(<MemoryRouter initialEntries={['/share/tok-abc123']}><Routes><Route path="/share/:token" element={<PublicSharePage />} /></Routes></MemoryRouter>);
    expect(await screen.findByText('Fiche four')).toBeInTheDocument();
    expect(screen.getByText('Devis QT-9')).toBeInTheDocument();
    expect(state.invoke).toHaveBeenCalledWith('public-share', { body: { action: 'get', token: 'tok-abc123' } });

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Télécharger/ })); });
    expect(state.invoke).toHaveBeenCalledWith('public-share', { body: { action: 'downloaded', token: 'tok-abc123', sheet_ids: [sheet.id] } });
    expect(state.from).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });

  it('says when the link has expired or does not exist', async () => {
    state.invoke.mockResolvedValueOnce(reply({ status: 'expired' }));
    const { unmount } = render(<MemoryRouter initialEntries={['/share/tok-old1234']}><Routes><Route path="/share/:token" element={<PublicSharePage />} /></Routes></MemoryRouter>);
    expect(await screen.findByText('Ce lien de partage a expiré')).toBeInTheDocument();
    unmount();
    state.invoke.mockResolvedValueOnce(reply({ status: 'missing' }));
    render(<MemoryRouter initialEntries={['/share/tok-none123']}><Routes><Route path="/share/:token" element={<PublicSharePage />} /></Routes></MemoryRouter>);
    expect(await screen.findByText('Lien de partage introuvable')).toBeInTheDocument();
  });
});

describe('public delivery tracking', () => {
  it('loads the delivery and the driver phone from public-tracking, then polls it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    state.invoke.mockImplementation(async (_fn: string, { body }: { body: Body }) => {
      const session = { client_name: 'Café Atlas', expires_at: '2099-01-01T00:00:00Z', destination_latitude: 33.5, destination_longitude: -7.6, destination_source: 'gps' };
      if (body.action === 'get') return reply({ status: 'ok', session, driver_phone: '0600000000', location: null });
      if (body.action === 'poll') return reply({ status: 'expired' });
      return { data: null, error: new Error('unexpected') };
    });
    render(<MemoryRouter initialEntries={['/track/' + 'a'.repeat(64)]}><TasksLanguageProvider><Routes><Route path="/track/:token" element={<TrackDelivery />} /></Routes></TasksLanguageProvider></MemoryRouter>);
    expect(await screen.findByText('Café Atlas')).toBeInTheDocument();
    expect(document.querySelector('a[href="tel:0600000000"]')).not.toBeNull();
    expect(state.invoke).toHaveBeenCalledWith('public-tracking', { body: { action: 'get', token: 'a'.repeat(64) } });

    // The next poll finds the delivery over: the page says so.
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(state.invoke).toHaveBeenCalledWith('public-tracking', { body: { action: 'poll', token: 'a'.repeat(64) } });
    expect(state.from).not.toHaveBeenCalled();
    expect(state.rpc).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe('login screen names', () => {
  it('come from verify-pin, with the company name', async () => {
    state.invoke.mockResolvedValueOnce(reply({
      users: [{ id: 'u1', username: 'ali', custom_seller_name: 'Ali B.', company_id: 'c1' }, { id: 'u2', username: 'sara', custom_seller_name: null, company_id: null }],
      companies: [{ id: 'c1', name: 'Cuisimat' }],
    }));
    expect(await getLoginProfiles()).toEqual([
      { id: 'u1', username: 'ali', custom_seller_name: 'Ali B.', company_id: 'c1', company_name: 'Cuisimat' },
      { id: 'u2', username: 'sara', custom_seller_name: '', company_id: null, company_name: null },
    ]);
    expect(state.invoke).toHaveBeenCalledWith('verify-pin', { body: { action: 'login-options' } });
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it('fall back to the previous read while verify-pin is not redeployed', async () => {
    state.invoke.mockResolvedValueOnce({ data: null, error: Object.assign(new Error('non-2xx'), { context: new Response(JSON.stringify({ error: 'Invalid action' }), { status: 400 }) }) });
    state.rpc.mockResolvedValueOnce({ data: [{ id: 'u1', username: 'ali', custom_seller_name: '', company_id: null, allowed_stock_locations: [], allowed_brands: [] }], error: null });
    const order = vi.fn().mockResolvedValue({ data: [], error: null });
    state.from.mockImplementationOnce((() => ({ select: () => ({ order }) })) as never);
    expect((await getLoginProfiles()).map(p => p.username)).toEqual(['ali']);
    expect(state.rpc).toHaveBeenCalledWith('get_app_users_safe');
  });
});
