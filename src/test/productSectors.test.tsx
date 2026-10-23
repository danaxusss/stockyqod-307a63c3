import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ProductsPage from '../pages/ProductsPage';
import { BusinessSectorsService } from '../utils/businessSectors';
import { sectorLabel } from '../utils/sectorLabel';

const SECTORS = vi.hoisted(() => [
  { id: 's-resto', name: 'Restaurant', name_en: 'Restaurant', name_ar: 'مطعم', sort_order: 10 },
  { id: 's-cafe', name: 'Café', name_en: null, name_ar: null, sort_order: 20 },
  { id: 's-hotel', name: 'Hôtel', name_en: 'Hotel', name_ar: 'فندق', sort_order: 30 },
]);

const product = (barcode: string, name: string, sector_ids: string[]) => ({
  barcode, name, brand: 'Stocky', provider: 'Test', price: 100, buyprice: 50, reseller_price: 80,
  image: null, stock_levels: { depot: 1 }, kiosk_category: null, sector_ids,
});

const appState = vi.hoisted(() => ({ products: [] as unknown[] }));
const auth = vi.hoisted(() => ({ isStock: true }));

vi.mock('../context/AppContext', () => ({ useAppContext: () => ({ state: appState }) }));
vi.mock('../context/ToastContext', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('../hooks/useQuoteCart', () => ({ useQuoteCart: () => ({ addToCart: vi.fn() }) }));
vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ canCreateQuote: () => false, getPriceDisplayType: () => 'normal', isStock: auth.isStock }),
}));
vi.mock('../hooks/useProductOverrides', () => ({
  useProductOverrides: () => ({
    getOriginalName: () => null,
    getAllNames: (_type: string, value: string) => [value],
    getDisplayName: (_type: string, value: string) => value,
  }),
}));
vi.mock('../utils/supabaseStockLocations', () => ({
  StockLocationsService: { getStockLocations: vi.fn().mockResolvedValue([]) },
}));
vi.mock('../integrations/supabase/client', () => ({
  supabase: {
    from: () => ({ select: vi.fn().mockResolvedValue({ data: [], error: null }) }),
    storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: '' } }) }) },
  },
}));
vi.mock('../utils/businessSectors', async () => {
  const actual = await vi.importActual<typeof import('../utils/businessSectors')>('../utils/businessSectors');
  return {
    ...actual,
    useBusinessSectors: () => ({ sectors: SECTORS, loading: false, error: '' }),
    BusinessSectorsService: { setProductSectors: vi.fn().mockResolvedValue(undefined), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
  };
});

const setProductSectors = vi.mocked(BusinessSectorsService.setProductSectors);

afterEach(() => { vi.clearAllMocks(); auth.isStock = true; });

function renderProducts() {
  appState.products = [
    product('P1', 'Four mixte', ['s-resto', 's-hotel']),
    product('P2', 'Machine espresso', ['s-cafe']),
    product('P3', 'Hachoir', []),
  ];
  return render(<MemoryRouter><ProductsPage /></MemoryRouter>);
}

const visibleNames = () => ['Four mixte', 'Machine espresso', 'Hachoir'].filter(name => screen.queryByRole('link', { name }));

describe('ProductsPage business sectors', () => {
  it('filters products by sector, including products in several sectors and products without one', () => {
    renderProducts();
    const filter = screen.getByRole('combobox', { name: 'Secteur' });

    fireEvent.change(filter, { target: { value: 's-hotel' } });
    expect(visibleNames()).toEqual(['Four mixte']);

    fireEvent.change(filter, { target: { value: 's-resto' } });
    expect(visibleNames()).toEqual(['Four mixte']);

    fireEvent.change(filter, { target: { value: 's-cafe' } });
    expect(visibleNames()).toEqual(['Machine espresso']);

    fireEvent.change(filter, { target: { value: '__none__' } });
    expect(visibleNames()).toEqual(['Hachoir']);
  });

  it('assigns several sectors to a product from the "Secteur" column', async () => {
    renderProducts();
    const row = screen.getByRole('link', { name: 'Hachoir' }).closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: /Secteur : aucun/ }));
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Restaurant' }));
    await waitFor(() => expect(setProductSectors).toHaveBeenLastCalledWith('P3', ['s-resto']));
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Hôtel' }));
    await waitFor(() => expect(setProductSectors).toHaveBeenLastCalledWith('P3', ['s-resto', 's-hotel']));
    expect(within(row).getByRole('button', { name: /Secteur : Restaurant, Hôtel/ })).toBeInTheDocument();
  });

  it('shows sectors read-only to users who cannot classify products', () => {
    auth.isStock = false;
    renderProducts();
    const row = screen.getByRole('link', { name: 'Four mixte' }).closest('tr')!;
    expect(within(row).getByText('Restaurant')).toBeInTheDocument();
    expect(within(row).getByText('Hôtel')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Gérer les secteurs/ })).not.toBeInTheDocument();
  });
});

describe('sectorLabel', () => {
  it('uses the translation for the kiosk language and falls back to the French name', () => {
    expect(sectorLabel(SECTORS[2], 'en')).toBe('Hotel');
    expect(sectorLabel(SECTORS[2], 'ar')).toBe('فندق');
    expect(sectorLabel(SECTORS[1], 'en')).toBe('Café');
    expect(sectorLabel(SECTORS[0])).toBe('Restaurant');
  });
});
