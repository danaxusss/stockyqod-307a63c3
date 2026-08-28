import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ProductsPage from '../pages/ProductsPage';

const appState = vi.hoisted(() => ({
  products: [{
    barcode: 'TEST-BOTTOM-001',
    name: 'Produit en bas de liste',
    brand: 'Stocky',
    provider: 'Test',
    price: 120,
    buyprice: 80,
    reseller_price: 100,
    image: null,
    stock_levels: { depot: 3 },
    kiosk_category: 'equipment',
  }],
}));

vi.mock('../context/AppContext', () => ({
  useAppContext: () => ({ state: appState }),
}));

vi.mock('../context/ToastContext', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

vi.mock('../hooks/useQuoteCart', () => ({
  useQuoteCart: () => ({ addToCart: vi.fn() }),
}));

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ canCreateQuote: () => true, getPriceDisplayType: () => 'normal', isStock: true }),
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

afterEach(() => {
  document.body.style.overflow = '';
  vi.clearAllMocks();
});

describe('ProductsPage quick view', () => {
  it('renders in a body portal and locks the current page scroll', async () => {
    render(<MemoryRouter><ProductsPage /></MemoryRouter>);

    const quickViewButtons = await screen.findAllByTitle('Aperçu rapide');
    fireEvent.click(quickViewButtons[0]);

    const dialog = screen.getByRole('dialog', { name: 'Produit en bas de liste' });
    const overlay = dialog.parentElement;
    expect(overlay?.parentElement).toBe(document.body);
    expect(document.body.style.overflow).toBe('hidden');

    fireEvent.click(screen.getByTitle('Fermer'));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(document.body.style.overflow).toBe('');
    });
  });
});
