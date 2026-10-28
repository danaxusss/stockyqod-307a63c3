import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { findLevelKey, levelAt, locationCandidates } from '../inventory/lib/locationKeys';
import { postDocumentStockOut } from '../inventory/lib/stockPosting';
import StockCountPage from '../pages/inventaire/StockCountPage';
import { StockService } from '../utils/supabaseStock';
import type { Quote } from '../types';

const posted = vi.hoisted(() => ({ rows: [] as unknown[] }));
const locations = vi.hoisted(() => [{ id: 'loc-1', name: 'Dépôt', abbreviation: 'DEP' }]);

vi.mock('../utils/supabaseClient', () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => ({ limit: async () => ({ data: posted.rows, error: null }) }) }) }) },
}));
vi.mock('../utils/supabaseStock', () => ({
  StockService: { getProducts: vi.fn(), applyMovements: vi.fn() },
}));
vi.mock('../inventory/lib/lowStockAlert', () => ({ notifyLowStock: vi.fn() }));
vi.mock('../inventory/hooks/useAccessibleLocations', () => ({
  useAccessibleLocations: () => ({ accessibleLocations: locations, locations, loading: false }),
}));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ currentUser: { username: 'magasin' } }) }));
const showToast = vi.hoisted(() => vi.fn());
vi.mock('../context/ToastContext', () => ({ useToast: () => ({ showToast }) }));
const navigate = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', async importOriginal => ({ ...(await importOriginal<typeof import('react-router-dom')>()), useNavigate: () => navigate }));

const products = vi.mocked(StockService.getProducts);
const apply = vi.mocked(StockService.applyMovements);

const product = (barcode: string, name: string, stock_levels: Record<string, number>) =>
  ({ barcode, name, brand: '', price: 0, buyprice: 0, reseller_price: 0, provider: '', image: null, stock_levels }) as never;

afterEach(() => { vi.clearAllMocks(); posted.rows = []; });

describe('location keys', () => {
  it('finds the stock under the spelling the product uses', () => {
    const candidates = locationCandidates({ abbreviation: 'DEP', name: 'Dépôt' });
    expect(candidates).toEqual(['DEP', 'Dépôt']);
    expect(findLevelKey({ 'Dépôt': 4 }, candidates)).toBe('Dépôt');
    expect(findLevelKey({ depot_central: 4 }, ['Depot Central'])).toBe('depot_central');
    expect(levelAt({ stock_levels: { dep: 7 } } as never, candidates)).toBe(7);
    expect(levelAt({ stock_levels: {} } as never, candidates)).toBe(0);
  });
});

describe('BL stock posting', () => {
  const bl = {
    id: 'bl-1', quoteNumber: 'BL-0001',
    items: [
      { quoteBarcode: 'A', quoteName: 'Four', quantity: 2, dispatch: [{ stock_location_abbrev: 'DEP', stock_location_name: 'Dépôt', stock_location_id: 'loc-1', quantity: 2 }] },
      { quoteBarcode: 'B', quoteName: 'Batteur', quantity: 1 },
      { quoteName: 'Transport', quantity: 1 },
      { quoteBarcode: 'ZZ', quoteName: 'Article libre', quantity: 1 },
    ],
  } as unknown as Quote;

  it('posts the whole BL at once under one posting key and reports what was left out', async () => {
    products.mockResolvedValue([product('A', 'Four', { 'Dépôt': 5 }), product('B', 'Batteur', { DEP: 3 })]);
    apply.mockResolvedValue({ duplicate: false, movements: [{ balance_after: 3 }, { balance_after: 2 }] as never });
    const result = await postDocumentStockOut(bl, { createdBy: 'magasin' });
    expect(apply).toHaveBeenCalledTimes(1);
    const [key, movements, by] = apply.mock.calls[0];
    expect(key).toBe('bl-out:bl-1');
    expect(by).toBe('magasin');
    expect(movements).toEqual([
      expect.objectContaining({ barcode: 'A', locationKeys: ['DEP', 'Dépôt'], type: 'out', quantity: 2, sourceId: 'bl-1' }),
      expect.objectContaining({ barcode: 'B', locationKeys: ['DEP'], type: 'out', quantity: 1 }),
    ]);
    expect(result).toMatchObject({ posted: 2, skipped: 2, skippedItems: ['Transport', 'Article libre'] });
  });

  it('says so when the BL was already posted (retry, double click, second user)', async () => {
    products.mockResolvedValue([product('A', 'Four', { 'Dépôt': 5 }), product('B', 'Batteur', { DEP: 3 })]);
    apply.mockResolvedValue({ duplicate: true, movements: [] });
    expect(await postDocumentStockOut(bl)).toMatchObject({ posted: 0, alreadyPosted: true });

    posted.rows = [{ id: 'old' }];
    expect(await postDocumentStockOut(bl)).toMatchObject({ alreadyPosted: true });
    expect(apply).toHaveBeenCalledTimes(1);
  });
});

describe('StockCountPage', () => {
  it('sends counted quantities (not differences) and keeps one id across retries', async () => {
    products.mockResolvedValue([product('A', 'Four mixte', { 'Dépôt': 50 }), product('B', 'Batteur', { DEP: 0, Showroom: 2 })]);
    apply.mockRejectedValueOnce(new Error('Réseau indisponible')).mockResolvedValueOnce({ duplicate: false, movements: [{ quantity: -5 }] as never });
    render(<MemoryRouter><StockCountPage /></MemoryRouter>);

    expect(await screen.findByText('Four mixte')).toBeInTheDocument();
    expect(screen.queryByText('Batteur')).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('—'), { target: { value: '45' } });
    fireEvent.click(screen.getByRole('button', { name: /Valider l'inventaire/ }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
    fireEvent.click(screen.getByRole('button', { name: /Valider l'inventaire/ }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/inventaire/mouvements'));

    const [firstKey, firstMoves] = apply.mock.calls[0];
    const [secondKey] = apply.mock.calls[1];
    expect(firstKey).toMatch(/^count:/);
    expect(secondKey).toBe(firstKey);
    expect(firstMoves).toEqual([expect.objectContaining({ barcode: 'A', counted: 45, locationKeys: ['DEP', 'Dépôt'], type: 'count' })]);
    expect(firstMoves[0]).not.toHaveProperty('quantity');
  });
});
