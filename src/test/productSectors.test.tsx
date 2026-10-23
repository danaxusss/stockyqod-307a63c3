import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ProductsPage from '../pages/ProductsPage';
import { sectorLabel } from '../utils/sectorLabel';
import { effectiveChange, saveProductClassifications } from '../utils/productClassification';

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
const applyProductChanges = vi.hoisted(() => vi.fn());

vi.mock('../context/AppContext', () => ({ useAppContext: () => ({ state: appState, applyProductChanges }) }));
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
    BusinessSectorsService: { setProductSectors: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
  };
});
vi.mock('../utils/productClassification', async () => {
  const actual = await vi.importActual<typeof import('../utils/productClassification')>('../utils/productClassification');
  return { ...actual, saveProductClassifications: vi.fn() };
});

const save = vi.mocked(saveProductClassifications);
save.mockImplementation(async changes => ({ saved: changes, failed: [] }));

afterEach(() => {
  vi.clearAllMocks();
  save.mockImplementation(async changes => ({ saved: changes, failed: [] }));
  auth.isStock = true;
});

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

  it('shows sectors read-only until the row is edited', () => {
    renderProducts();
    const row = screen.getByRole('link', { name: 'Four mixte' }).closest('tr')!;
    expect(within(row).queryByRole('button', { name: /Secteur :/ })).not.toBeInTheDocument();
    expect(within(row).getByText('Restaurant')).toBeInTheDocument();
    expect(within(row).getByText('Hôtel')).toBeInTheDocument();
  });

  it('saves sectors as soon as they change while a row is being edited', async () => {
    renderProducts();
    const row = screen.getByRole('link', { name: 'Hachoir' }).closest('tr')!;
    fireEvent.click(within(row).getByTitle('Modifier'));
    fireEvent.click(within(row).getByRole('button', { name: /Secteur : aucun/ }));
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Restaurant' }));

    await waitFor(() => expect(save).toHaveBeenCalledWith({ P3: { sector_ids: ['s-resto'] } }));
    await waitFor(() => expect(applyProductChanges).toHaveBeenCalledWith({ P3: { sector_ids: ['s-resto'] } }));
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Hôtel' }));
    await waitFor(() => expect(save).toHaveBeenLastCalledWith({ P3: { sector_ids: ['s-resto', 's-hotel'] } }));
  });

  it('puts the sector back and warns when an automatic save fails', async () => {
    save.mockResolvedValueOnce({ saved: {}, failed: [{ barcode: 'P3', message: 'permission denied' }] });
    renderProducts();
    const row = screen.getByRole('link', { name: 'Hachoir' }).closest('tr')!;
    fireEvent.click(within(row).getByTitle('Modifier'));
    fireEvent.click(within(row).getByRole('button', { name: /Secteur : aucun/ }));
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Restaurant' }));
    await waitFor(() => expect(within(row).getByRole('button', { name: /Secteur : aucun/ })).toBeInTheDocument());
    expect(applyProductChanges).not.toHaveBeenCalled();
  });

  it('applies sector changes to several products in bulk mode and saves them only on "Enregistrer"', async () => {
    renderProducts();
    fireEvent.click(screen.getByRole('button', { name: 'Modification groupée' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sélectionner Hachoir' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sélectionner Machine espresso' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Ajouter un secteur à la sélection' }), { target: { value: 's-hotel' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Type kiosque pour la sélection' }), { target: { value: 'furniture' } });

    expect(screen.getByText('2 produit(s) modifié(s), non enregistré(s)')).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({
      P3: { sector_ids: ['s-hotel'], kiosk_category: 'furniture' },
      P2: { sector_ids: ['s-cafe', 's-hotel'], kiosk_category: 'furniture' },
    }));
    expect(applyProductChanges).toHaveBeenCalledWith(expect.objectContaining({ P2: expect.anything(), P3: expect.anything() }));
    expect(await screen.findByText('Aucune modification')).toBeInTheDocument();
  });

  it('lets bulk edits on a row be cancelled without saving', async () => {
    renderProducts();
    fireEvent.click(screen.getByRole('button', { name: 'Modification groupée' }));
    const row = screen.getByRole('link', { name: 'Four mixte' }).closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: /Secteur : Restaurant, Hôtel/ }));
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Hôtel' }));
    expect(screen.getByText('1 produit(s) modifié(s), non enregistré(s)')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(screen.getByText('Aucune modification')).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: /Secteur : Restaurant, Hôtel/ })).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
  });

  it('shows sectors read-only to users who cannot classify products', () => {
    auth.isStock = false;
    renderProducts();
    const row = screen.getByRole('link', { name: 'Four mixte' }).closest('tr')!;
    expect(within(row).getByText('Restaurant')).toBeInTheDocument();
    expect(within(row).getByText('Hôtel')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Gérer les secteurs/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Modification groupée/ })).not.toBeInTheDocument();
  });
});

describe('effectiveChange', () => {
  it('keeps only fields that differ from the saved product', () => {
    const saved = { kiosk_category: 'equipment' as const, sector_ids: ['a', 'b'] };
    expect(effectiveChange(saved, { sector_ids: ['b', 'a'], kiosk_category: 'equipment' })).toEqual({});
    expect(effectiveChange(saved, { sector_ids: ['a'] })).toEqual({ sector_ids: ['a'] });
    expect(effectiveChange(saved, { kiosk_category: null })).toEqual({ kiosk_category: null });
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
