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
const auth = vi.hoisted(() => ({ isStock: true, canEditProducts: true }));
const applyProductChanges = vi.hoisted(() => vi.fn());

vi.mock('../context/AppContext', () => ({ useAppContext: () => ({ state: appState, applyProductChanges }) }));
vi.mock('../context/ToastContext', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('../hooks/useQuoteCart', () => ({ useQuoteCart: () => ({ addToCart: vi.fn() }) }));
vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ canCreateQuote: () => false, getPriceDisplayType: () => 'normal', isStock: auth.isStock, canEditProducts: auth.canEditProducts }),
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
  auth.canEditProducts = true;
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

  it('saves bulk changes to several products automatically, grouped in one save', async () => {
    renderProducts();
    fireEvent.click(screen.getByRole('button', { name: 'Modification groupée' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sélectionner Hachoir' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sélectionner Machine espresso' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Ajouter un secteur à la sélection' }), { target: { value: 's-hotel' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Type kiosque pour la sélection' }), { target: { value: 'furniture' } });
    expect(screen.getByText('produit(s) en attente d’enregistrement…')).toBeInTheDocument();

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1), { timeout: 3000 });
    expect(save).toHaveBeenCalledWith({
      P3: { sector_ids: ['s-hotel'], kiosk_category: 'furniture' },
      P2: { sector_ids: ['s-cafe', 's-hotel'], kiosk_category: 'furniture' },
    });
    expect(applyProductChanges).toHaveBeenCalledWith(expect.objectContaining({ P2: expect.anything(), P3: expect.anything() }));
    expect(await screen.findByText('Modifications enregistrées')).toBeInTheDocument();
  });

  it('saves at once with "Enregistrer", and on "Terminer"', async () => {
    renderProducts();
    fireEvent.click(screen.getByRole('button', { name: 'Modification groupée' }));
    const row = screen.getByRole('link', { name: 'Four mixte' }).closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: /Secteur : Restaurant, Hôtel/ }));
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Hôtel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(save).toHaveBeenCalledWith({ P1: { sector_ids: ['s-resto'] } });

    fireEvent.change(within(row).getByRole('combobox', { name: 'Type kiosque de Four mixte' }), { target: { value: 'equipment' } });
    fireEvent.click(screen.getByRole('button', { name: 'Terminer' }));
    // Edited while the first save was still running, so the sectors ride along again.
    await waitFor(() => expect(save).toHaveBeenLastCalledWith({ P1: expect.objectContaining({ kiosk_category: 'equipment' }) }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Modification groupée' })).not.toBeInTheDocument());
  });

  it('saves pending bulk changes when leaving the page', async () => {
    const view = renderProducts();
    fireEvent.click(screen.getByRole('button', { name: 'Modification groupée' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sélectionner Hachoir' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Ajouter un secteur à la sélection' }), { target: { value: 's-cafe' } });
    view.unmount();
    expect(save).toHaveBeenCalledWith({ P3: { sector_ids: ['s-cafe'] } });
  });

  it('reports a failed bulk save and retries only when asked', async () => {
    save.mockResolvedValueOnce({ saved: {}, failed: [{ barcode: 'P3', message: 'permission denied' }] });
    renderProducts();
    fireEvent.click(screen.getByRole('button', { name: 'Modification groupée' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sélectionner Hachoir' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Ajouter un secteur à la sélection' }), { target: { value: 's-cafe' } });

    expect(await screen.findByText(/1 produit\(s\) non enregistré\(s\) — P3 : permission denied/, {}, { timeout: 3000 })).toBeInTheDocument();
    await new Promise(resolve => setTimeout(resolve, 1200));
    expect(save).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /Réessayer/ }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Modifications enregistrées')).toBeInTheDocument();
  });

  it('lets a user granted "Peut modifier les produits" edit, but not delete sectors', () => {
    auth.isStock = false;
    renderProducts();
    const row = screen.getByRole('link', { name: 'Four mixte' }).closest('tr')!;
    expect(within(row).getByTitle('Modifier')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Modification groupée' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Gérer les secteurs/ }));
    expect(screen.getByRole('textbox', { name: 'Nom du secteur Restaurant' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Supprimer Restaurant' })).not.toBeInTheDocument();
  });

  it('keeps products read-only for users without the editing permission', () => {
    auth.isStock = false;
    auth.canEditProducts = false;
    renderProducts();
    const row = screen.getByRole('link', { name: 'Four mixte' }).closest('tr')!;
    expect(within(row).queryByTitle('Modifier')).not.toBeInTheDocument();
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

describe('ProductsPage on phones', () => {
  const desktopWidth = window.innerWidth;
  afterEach(() => { window.innerWidth = desktopWidth; });

  it('shows product cards with collapsed filters instead of the table', async () => {
    window.innerWidth = 390;
    renderProducts();
    expect(await screen.findByRole('button', { name: /Filtres/ })).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Four mixte' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Secteur' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Filtres/ }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Secteur' }), { target: { value: 's-cafe' } });
    expect(screen.queryByRole('link', { name: 'Four mixte' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Machine espresso' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Filtres/ })).toHaveTextContent('1');

    fireEvent.change(screen.getByRole('combobox', { name: 'Trier par' }), { target: { value: 'name:desc' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Secteur' }), { target: { value: '' } });
    const names = screen.getAllByRole('link').map(link => link.textContent).filter(name => ['Four mixte', 'Machine espresso', 'Hachoir'].includes(name || ''));
    expect(names).toEqual(['Machine espresso', 'Hachoir', 'Four mixte']);
  });

  it('supports bulk editing from the cards', async () => {
    window.innerWidth = 390;
    renderProducts();
    fireEvent.click(await screen.findByRole('button', { name: 'Modification groupée' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sélectionner Hachoir' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Ajouter un secteur à la sélection' }), { target: { value: 's-hotel' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(save).toHaveBeenCalledWith({ P3: { sector_ids: ['s-hotel'] } });
  });
});
