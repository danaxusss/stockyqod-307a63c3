import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ProductsPage from '../pages/ProductsPage';

const product = (barcode: string, name: string) => ({
  barcode, name, brand: 'Bosch', provider: 'Test', price: 120, buyprice: 80, reseller_price: 100, image: null, stock_levels: { depot: 3 },
});

const appState = vi.hoisted(() => ({ products: [] as unknown[] }));
const auth = vi.hoisted(() => ({ canEditProducts: true }));

vi.mock('../context/AppContext', () => ({ useAppContext: () => ({ state: appState, applyProductChanges: vi.fn() }) }));
vi.mock('../context/ToastContext', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('../hooks/useQuoteCart', () => ({ useQuoteCart: () => ({ addToCart: vi.fn() }) }));
vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ canCreateQuote: () => false, getPriceDisplayType: () => 'normal', isStock: auth.canEditProducts, canEditProducts: auth.canEditProducts }),
}));
vi.mock('../hooks/useProductOverrides', () => ({
  useProductOverrides: () => ({
    getOriginalName: () => null,
    getAllNames: (_type: string, value: string) => [value],
    getDisplayName: (_type: string, value: string) => value,
  }),
}));
vi.mock('../utils/supabaseStockLocations', () => ({ StockLocationsService: { getStockLocations: vi.fn().mockResolvedValue([]) } }));
vi.mock('../integrations/supabase/client', () => ({
  supabase: {
    from: () => ({ select: vi.fn().mockResolvedValue({ data: [], error: null }) }),
    storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: '' } }) }) },
  },
}));
vi.mock('../utils/technicalSheets', () => ({
  loadSheetLinks: vi.fn().mockResolvedValue({ LINKED: [{ id: 's1', title: 'Fiche perceuse', file_url: 'https://storage.test/s1.pdf' }] }),
}));
// The finder itself is covered in technicalSheetFinder.test.tsx.
vi.mock('../components/TechnicalSheetFinder', () => ({
  TechnicalSheetFinder: ({ product, onLinked, onClose }: { product: { name: string }; onLinked: (sheet: unknown) => void; onClose: () => void }) => (
    <div role="dialog" aria-label={`Fiche pour ${product.name}`}>
      <button onClick={() => { onLinked({ id: 's2', title: 'Fiche meuleuse', file_url: 'https://storage.test/s2.pdf' }); onClose(); }}>Lier (test)</button>
    </div>
  ),
}));

afterEach(() => { vi.clearAllMocks(); auth.canEditProducts = true; });

describe('ProductsPage technical sheet icon', () => {
  it('opens a linked sheet, and searches then links one for a product without', async () => {
    appState.products = [product('LINKED', 'Perceuse'), product('NONE', 'Meuleuse')];
    render(<MemoryRouter><ProductsPage /></MemoryRouter>);

    expect(await screen.findByRole('link', { name: 'Ouvrir la fiche technique Fiche perceuse' })).toHaveAttribute('href', 'https://storage.test/s1.pdf');
    fireEvent.click(screen.getByRole('button', { name: 'Rechercher une fiche technique' }));
    fireEvent.click(screen.getByRole('dialog', { name: 'Fiche pour Meuleuse' }).querySelector('button')!);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ouvrir la fiche technique Fiche meuleuse' })).toHaveAttribute('href', 'https://storage.test/s2.pdf');
    expect(screen.queryByRole('button', { name: 'Rechercher une fiche technique' })).not.toBeInTheDocument();
  });

  it('hides the search for people who cannot edit products', async () => {
    auth.canEditProducts = false;
    appState.products = [product('LINKED', 'Perceuse'), product('NONE', 'Meuleuse')];
    render(<MemoryRouter><ProductsPage /></MemoryRouter>);
    expect(await screen.findByRole('link', { name: 'Ouvrir la fiche technique Fiche perceuse' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rechercher une fiche technique' })).not.toBeInTheDocument();
  });
});
