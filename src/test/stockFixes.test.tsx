import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import StockCountPage from '../pages/inventaire/StockCountPage';
import StockLevelsPage from '../pages/inventaire/StockLevelsPage';
import PurchaseOrderDetailPage from '../pages/inventaire/PurchaseOrderDetailPage';
import { StockService } from '../utils/supabaseStock';
import { PurchaseOrdersService } from '../utils/supabasePurchaseOrders';

const locations = vi.hoisted(() => [
  { id: 'loc-1', name: 'Dépôt', abbreviation: 'DEP' },
  { id: 'loc-2', name: 'Showroom', abbreviation: 'SHOW' },
]);
// The user may see DEP and SHOW, not the other branch's MAZRAA.
const allowed = vi.hoisted(() => new Set(['DEP', 'SHOW']));

vi.mock('../utils/supabaseStock', () => ({
  StockService: {
    getProducts: vi.fn(), applyMovements: vi.fn(), getStockSettings: vi.fn(async () => []),
    getMovementsForProduct: vi.fn(), upsertStockSetting: vi.fn(),
  },
}));
vi.mock('../utils/supabaseStockLocations', () => ({ StockLocationsService: { getStockLocations: vi.fn(async () => locations) } }));
vi.mock('../utils/supabasePurchaseOrders', () => ({
  PurchaseOrdersService: { getById: vi.fn(), setStatus: vi.fn(async () => undefined), receive: vi.fn() },
  OverReceiptError: class OverReceiptError extends Error {},
}));
vi.mock('../inventory/lib/lowStockAlert', () => ({ notifyLowStock: vi.fn() }));
// Product photos import the client.
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
vi.mock('../inventory/hooks/useAccessibleLocations', () => ({
  useAccessibleLocations: () => ({
    accessibleLocations: locations, locations, loading: false,
    keyAllowed: (key: string) => allowed.has(key),
    filterLevels: (levels: Record<string, number> = {}) => Object.fromEntries(Object.entries(levels).filter(([k]) => allowed.has(k))),
  }),
}));
vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ currentUser: { username: 'magasin' }, isSuperAdmin: true, isAdmin: false, isManager: false, canAccessStockLocation: () => true }),
}));
const showToast = vi.hoisted(() => vi.fn());
vi.mock('../context/ToastContext', () => ({ useToast: () => ({ showToast }) }));

const products = vi.mocked(StockService.getProducts);
const movements = vi.mocked(StockService.getMovementsForProduct);
const getPo = vi.mocked(PurchaseOrdersService.getById);
const setPoStatus = vi.mocked(PurchaseOrdersService.setStatus);

const product = (barcode: string, name: string, stock_levels: Record<string, number>) =>
  ({ barcode, name, brand: '', price: 0, buyprice: 0, reseller_price: 0, provider: '', image: null, stock_levels }) as never;

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('stock levels', () => {
  it('draws one page at a time, with a page size that is remembered', async () => {
    products.mockResolvedValue(Array.from({ length: 45 }, (_, i) => product(`P${i}`, `Article ${String(i).padStart(2, '0')}`, { DEP: 1 })));
    const { unmount } = render(<MemoryRouter><StockLevelsPage /></MemoryRouter>);
    const table = await screen.findByRole('table');
    expect(within(table).getByText('Article 00')).toBeInTheDocument();
    expect(within(table).queryByText('Article 20')).not.toBeInTheDocument();
    expect(screen.getByText('1-20 sur 45')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Page suivante' }));
    expect(within(table).getByText('Article 20')).toBeInTheDocument();
    expect(within(table).queryByText('Article 00')).not.toBeInTheDocument();

    // Search applies to every product, and goes back to page 1.
    fireEvent.change(screen.getByRole('textbox', { name: 'Rechercher un article' }), { target: { value: 'Article 03' } });
    expect(within(table).getByText('Article 03')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Rechercher un article' }), { target: { value: '' } });
    expect(within(table).getByText('Article 00')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox', { name: 'Articles par page' }), { target: { value: '50' } });
    expect(within(table).getByText('Article 44')).toBeInTheDocument();
    unmount();
    render(<MemoryRouter><StockLevelsPage /></MemoryRouter>);
    expect(await screen.findByRole('combobox', { name: 'Articles par page' })).toHaveValue('50');
  });

  it('shows the movement history only for locations the user may see', async () => {
    products.mockResolvedValue([product('P1', 'Four mixte', { DEP: 3, MAZRAA: 2 })]);
    movements.mockResolvedValue([
      { id: 'm1', barcode: 'P1', location_key: 'DEP', type: 'in', quantity: 3, balance_after: 3, reason: 'Réception dépôt', created_at: '2026-11-10T10:00:00Z', created_by: 'a' },
      { id: 'm2', barcode: 'P1', location_key: 'MAZRAA', type: 'in', quantity: 2, balance_after: 2, reason: 'Réception autre agence', created_at: '2026-11-10T11:00:00Z', created_by: 'b' },
    ] as never);
    render(<MemoryRouter><StockLevelsPage /></MemoryRouter>);
    fireEvent.click(within(await screen.findByRole('table')).getByText('Four mixte'));
    expect(await screen.findByText(/Réception dépôt/)).toBeInTheDocument();
    expect(screen.queryByText(/Réception autre agence/)).not.toBeInTheDocument();
  });
});

describe('physical count', () => {
  it('asks before switching location once counts are typed, and keeps them if refused', async () => {
    products.mockResolvedValue([product('A', 'Four', { DEP: 5 }), product('B', 'Batteur', { SHOW: 2 })]);
    render(<MemoryRouter><StockCountPage /></MemoryRouter>);
    const select = await screen.findByRole('combobox', { name: 'Emplacement à inventorier' });
    await screen.findAllByText('Four');
    fireEvent.change(screen.getAllByPlaceholderText('—')[0], { target: { value: '4' } });

    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.change(select, { target: { value: 'loc-2' } });
    expect(confirm).toHaveBeenCalledWith('Changer d’emplacement efface les quantités saisies. Continuer ?');
    expect(select).toHaveValue('loc-1');
    expect(screen.getAllByPlaceholderText('—')[0]).toHaveValue(4);

    confirm.mockReturnValue(true);
    fireEvent.change(select, { target: { value: 'loc-2' } });
    expect(select).toHaveValue('loc-2');
    await waitFor(() => expect(screen.getAllByText('Batteur').length).toBeGreaterThan(0));
  });

  it('switches without asking when nothing was typed', async () => {
    products.mockResolvedValue([product('A', 'Four', { DEP: 5 })]);
    render(<MemoryRouter><StockCountPage /></MemoryRouter>);
    const select = await screen.findByRole('combobox', { name: 'Emplacement à inventorier' });
    const confirm = vi.spyOn(window, 'confirm');
    fireEvent.change(select, { target: { value: 'loc-2' } });
    expect(confirm).not.toHaveBeenCalled();
    expect(select).toHaveValue('loc-2');
  });
});

describe('supplier order', () => {
  const renderPo = () => render(
    <MemoryRouter initialEntries={['/inventaire/commandes/po1']}>
      <Routes><Route path="/inventaire/commandes/:id" element={<PurchaseOrderDetailPage />} /></Routes>
    </MemoryRouter>,
  );

  it('asks before cancelling, and cancels only when confirmed', async () => {
    getPo.mockResolvedValue({
      id: 'po1', company_id: 'c1', po_number: 'PO-2026-001', provider_id: null, provider_name: 'RESTOQUIP', location_key: 'DEP',
      status: 'sent', order_date: '2026-11-01', expected_date: null, total_ht: 100, notes: null, created_by: 'a',
      created_at: '2026-11-01', updated_at: '2026-11-01', items: [],
    } as never);
    renderPo();
    const cancel = await screen.findByRole('button', { name: /Annuler le bon/ });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(cancel);
    expect(confirm).toHaveBeenCalledWith('Annuler ce bon de commande ?');
    expect(setPoStatus).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    fireEvent.click(cancel);
    await waitFor(() => expect(setPoStatus).toHaveBeenCalledWith('po1', 'cancelled'));
  });
});
