import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import KioskPage from '../pages/kiosk/KioskPage';
import { KioskRequestError, KioskService } from '../utils/kioskService';
import { readableTextOn } from '../utils/kioskColors';

vi.mock('../utils/kioskService', () => ({
  KioskRequestError: class KioskRequestError extends Error {
    constructor(message: string, readonly status: number | null, readonly serverMessage: string | null) { super(message); }
  },
  KioskService: {
    loadPublic: vi.fn(),
    listPublicProducts: vi.fn(),
    submit: vi.fn(),
    imageUrl: vi.fn(() => null),
  },
}));

const service = vi.mocked(KioskService);
const TOKEN = '00000000-0000-4000-8000-000000000000';

afterEach(() => { vi.clearAllMocks(); vi.useRealTimers(); sessionStorage.clear(); });

const DRILL = {
  barcode: '611000000001', name: 'Perceuse de test', brand: 'Stocky', image: null,
  kiosk_category: 'equipment' as const, price: 799, available: true,
};
const FEATURED = { ...DRILL, barcode: '611000000099', name: 'Aspirateur vedette', featured: true };

type Sector = { id: string; name: string; name_en: string | null; name_ar: string | null };

function mockKiosk(overrides: Record<string, unknown> = {}, featured: typeof FEATURED[] = [], sectors: Sector[] = []) {
  service.loadPublic.mockResolvedValue({
    profile: {
      id: 'profile-1', name: 'Accueil', company_name: 'Stocky Test',
      greeting_title: 'Bienvenue chez Stocky', greeting_message: 'Préparez votre demande.',
      logo_url: null, accent_color: '#2563eb', language: 'fr', customer_languages: ['fr', 'en'],
      allow_deferred_contact: true, success_screen_seconds: 20, grid_columns: 0, show_prices: true,
      price_mode: 'retail', require_email: true, show_availability: true,
      inactivity_timeout_seconds: 180,
      ...overrides,
    },
    brands: ['Stocky'],
    sectors,
  });
  service.listPublicProducts.mockImplementation(async (_token, options = {}) => (
    options.featuredOnly
      ? { products: featured, total: featured.length, page: 0, page_size: 24 }
      : { products: [DRILL], total: 1, page: 0, page_size: 48 }
  ));
  service.submit.mockResolvedValue({ request_id: 'request-1', request_number: 'KSK-TEST-001' });
}

function renderKiosk() {
  return render(
    <MemoryRouter initialEntries={[`/kiosk/${TOKEN}`]}>
      <Routes><Route path="/kiosk/:token" element={<KioskPage />} /></Routes>
    </MemoryRouter>,
  );
}

async function openReview() {
  expect(await screen.findByRole('heading', { name: 'Bienvenue chez Stocky' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Commencer/i }));
  expect(await screen.findByText('Perceuse de test')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Ajouter/i }));
  fireEvent.click(screen.getByRole('button', { name: /Voir ma demande/i }));
  expect(screen.getByRole('heading', { name: 'Vérifier la demande' })).toBeInTheDocument();
}

describe('KioskPage', () => {
  it('collects and validates contact details at confirmation before submitting', async () => {
    mockKiosk();
    renderKiosk();
    await openReview();

    fireEvent.change(screen.getByLabelText(/Nom complet/), { target: { value: 'Client Test' } });
    fireEvent.change(screen.getByLabelText(/Téléphone/), { target: { value: 'invalid' } });
    fireEvent.change(screen.getByLabelText(/E-mail/), { target: { value: 'client@invalid' } });
    fireEvent.click(screen.getByRole('button', { name: /Envoyer la demande/i }));
    expect(await screen.findByText('Veuillez saisir un numéro de téléphone valide.')).toBeInTheDocument();
    expect(service.submit).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/Téléphone/), { target: { value: '+212 600-000000' } });
    fireEvent.click(screen.getByRole('button', { name: /Envoyer la demande/i }));
    expect(await screen.findByText('Veuillez saisir une adresse e-mail valide.')).toBeInTheDocument();
    expect(service.submit).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/E-mail/), { target: { value: 'client@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /Envoyer la demande/i }));

    expect(await screen.findByText('KSK-TEST-001')).toBeInTheDocument();
    await waitFor(() => expect(service.submit).toHaveBeenCalledWith(
      TOKEN,
      expect.objectContaining({ name: 'Client Test', phone: '+212 600-000000', email: 'client@example.com' }),
      [{ barcode: '611000000001', quantity: 1 }],
      false,
    ));
  });

  it('allows the client to defer contact details until staff follow-up', async () => {
    mockKiosk();
    renderKiosk();
    await openReview();

    fireEvent.click(screen.getByLabelText(/Je renseignerai mes coordonnées plus tard/));
    fireEvent.click(screen.getByRole('button', { name: /Envoyer la demande/i }));

    expect(await screen.findByText('KSK-TEST-001')).toBeInTheDocument();
    await waitFor(() => expect(service.submit).toHaveBeenCalledWith(
      TOKEN,
      { name: '', phone: '', email: '', note: '' },
      [{ barcode: '611000000001', quantity: 1 }],
      true,
    ));
  });

  it('filters the full Stocky product list by kiosk type, brand, and availability', async () => {
    mockKiosk();
    renderKiosk();
    expect(await screen.findByRole('heading', { name: 'Bienvenue chez Stocky' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Commencer/i }));
    expect(await screen.findByText('Perceuse de test')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Équipement' }));
    await waitFor(() => expect(service.listPublicProducts).toHaveBeenLastCalledWith(
      TOKEN,
      expect.objectContaining({ category: 'equipment', page: 0, pageSize: 48 }),
    ));

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Stocky' } });
    fireEvent.click(screen.getByLabelText('Disponibles uniquement'));
    await waitFor(() => expect(service.listPublicProducts).toHaveBeenLastCalledWith(
      TOKEN,
      expect.objectContaining({ category: 'equipment', brand: 'Stocky', onlyAvailable: true }),
    ));
  });

  it('clears an abandoned selection left on the welcome screen', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockKiosk({ inactivity_timeout_seconds: 60 });
    renderKiosk();
    expect(await screen.findByRole('heading', { name: 'Bienvenue chez Stocky' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Commencer/i }));
    expect(await screen.findByText('Perceuse de test')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Ajouter/i }));
    expect(screen.getByRole('button', { name: /Voir ma demande/i })).toBeInTheDocument();

    // The customer taps back and walks away.
    fireEvent.click(screen.getByRole('button', { name: 'Accueil' }));
    expect(await screen.findByRole('heading', { name: 'Bienvenue chez Stocky' })).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(61_000); });

    fireEvent.click(screen.getByRole('button', { name: /Commencer/i }));
    expect(await screen.findByText('Perceuse de test')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Voir ma demande/i })).not.toBeInTheDocument();
  });

  it('keeps the kiosk usable and offers a retry when the catalogue fails to load', async () => {
    mockKiosk();
    const catalogue = service.listPublicProducts.getMockImplementation()!;
    let failed = false;
    service.listPublicProducts.mockImplementation(async (token, options = {}) => {
      if (!options.featuredOnly && !failed) {
        failed = true;
        throw new KioskRequestError('Too many requests', 429, 'Too many requests');
      }
      return catalogue(token, options);
    });
    renderKiosk();
    expect(await screen.findByRole('heading', { name: 'Bienvenue chez Stocky' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Commencer/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Le kiosque est très sollicité');
    expect(screen.queryByText('Ce kiosque est indisponible.')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Réessayer/i }));
    expect(await screen.findByText('Perceuse de test')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('explains a rejected submission in the kiosk language and keeps the selection', async () => {
    mockKiosk();
    service.submit.mockRejectedValueOnce(new KioskRequestError('One or more products are unavailable', 500, 'One or more products are unavailable'));
    renderKiosk();
    await openReview();

    fireEvent.click(screen.getByLabelText(/Je renseignerai mes coordonnées plus tard/));
    fireEvent.click(screen.getByRole('button', { name: /Envoyer la demande/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Un ou plusieurs produits ne sont plus disponibles');
    expect(screen.getByText('Perceuse de test')).toBeInTheDocument();
  });

  it('does not reload the catalogue when returning from the review step', async () => {
    mockKiosk();
    renderKiosk();
    await openReview();
    const catalogCalls = () => service.listPublicProducts.mock.calls.filter(([, options]) => !options?.featuredOnly).length;
    expect(catalogCalls()).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: /Retour au catalogue/i }));
    expect(await screen.findByText('Perceuse de test')).toBeInTheDocument();
    expect(catalogCalls()).toBe(1);
  });

  it('shows an unavailable screen with a retry for a disabled kiosk', async () => {
    service.loadPublic.mockRejectedValueOnce(new KioskRequestError('Kiosk unavailable', 404, 'Kiosk unavailable'));
    renderKiosk();
    expect(await screen.findByText('Ce kiosque est indisponible.')).toBeInTheDocument();
    expect(screen.queryByText(/momentanément indisponible/)).not.toBeInTheDocument();

    mockKiosk();
    fireEvent.click(screen.getByRole('button', { name: /Réessayer/i }));
    expect(await screen.findByRole('heading', { name: 'Bienvenue chez Stocky' })).toBeInTheDocument();
  });

  it('lets the customer switch to another offered language', async () => {
    mockKiosk();
    renderKiosk();
    expect(await screen.findByRole('button', { name: /Commencer/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'العربية' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'English' }));
    expect(screen.getByRole('button', { name: /Start/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Français' }));
    expect(screen.getByRole('button', { name: /Commencer/i })).toBeInTheDocument();
  });

  it('keeps featured products off the welcome screen and offers them as a catalogue filter', async () => {
    mockKiosk({}, [FEATURED]);
    renderKiosk();
    expect(await screen.findByRole('button', { name: /Commencer/i })).toBeInTheDocument();
    await waitFor(() => expect(service.listPublicProducts).toHaveBeenCalledWith(TOKEN, expect.objectContaining({ featuredOnly: true })));
    expect(screen.queryByText('Aspirateur vedette')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Commencer/i }));
    fireEvent.click(await screen.findByRole('button', { name: /★ Sélection/ }));
    await waitFor(() => expect(service.listPublicProducts).toHaveBeenLastCalledWith(
      TOKEN, expect.objectContaining({ featuredOnly: true, page: 0, pageSize: 48 }),
    ));
  });

  it('filters the catalogue by business sector, labelled in the kiosk language', async () => {
    mockKiosk({ language: 'en' }, [], [
      { id: '11111111-1111-4111-8111-111111111111', name: 'Hôtel', name_en: 'Hotel', name_ar: 'فندق' },
      { id: '22222222-2222-4222-8222-222222222222', name: 'Boucherie', name_en: null, name_ar: null },
    ]);
    renderKiosk();
    fireEvent.click(await screen.findByRole('button', { name: /Start/ }));
    const sectors = await screen.findByRole('group', { name: 'Sector' });
    expect(within(sectors).getByRole('button', { name: 'Boucherie' })).toBeInTheDocument();

    fireEvent.click(within(sectors).getByRole('button', { name: 'Hotel' }));
    await waitFor(() => expect(service.listPublicProducts).toHaveBeenLastCalledWith(
      TOKEN, expect.objectContaining({ sector: '11111111-1111-4111-8111-111111111111', page: 0 }),
    ));
    fireEvent.click(within(sectors).getByRole('button', { name: 'All sectors' }));
    await waitFor(() => expect(service.listPublicProducts).toHaveBeenLastCalledWith(
      TOKEN, expect.objectContaining({ sector: null }),
    ));
  });

  it('hides the sector filter when no sector has products', async () => {
    mockKiosk();
    renderKiosk();
    fireEvent.click(await screen.findByRole('button', { name: /Commencer/i }));
    expect(await screen.findByText('Perceuse de test')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Secteur' })).not.toBeInTheDocument();
  });

  it('lays out the catalogue with the configured number of products per row', async () => {
    mockKiosk({ grid_columns: 3 });
    renderKiosk();
    fireEvent.click(await screen.findByRole('button', { name: /Commencer/i }));
    expect(await screen.findByText('Perceuse de test')).toBeInTheDocument();
    expect(screen.getByTestId('kiosk-grid')).toHaveClass('lg:grid-cols-3');
    expect(screen.getByTestId('kiosk-grid')).not.toHaveClass('xl:grid-cols-5');
  });

  it('keeps the selection through an accidental reload', async () => {
    mockKiosk();
    const first = renderKiosk();
    expect(await screen.findByRole('button', { name: /Commencer/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Commencer/i }));
    expect(await screen.findByText('Perceuse de test')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Ajouter/i }));
    first.unmount();

    renderKiosk();
    expect(await screen.findByRole('button', { name: /Voir ma demande/i })).toBeInTheDocument();
  });

  it('removes a line from the review step', async () => {
    mockKiosk();
    renderKiosk();
    await openReview();
    fireEvent.click(screen.getByRole('button', { name: 'Retirer' }));
    expect(screen.getByText('Votre sélection est vide.')).toBeInTheDocument();
  });

  it('hides the "details later" option when the kiosk requires contact details', async () => {
    mockKiosk({ allow_deferred_contact: false });
    renderKiosk();
    await openReview();
    expect(screen.queryByLabelText(/Je renseignerai mes coordonnées plus tard/)).not.toBeInTheDocument();
    expect(screen.getByText('Nom complet')).toBeInTheDocument();
  });

  it('counts down before clearing an idle session', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockKiosk({ inactivity_timeout_seconds: 60 });
    renderKiosk();
    expect(await screen.findByRole('button', { name: /Commencer/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Commencer/i }));
    expect(await screen.findByText('Perceuse de test')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(45_000); });
    expect(screen.getByText('Toujours là ?')).toBeInTheDocument();
    expect(screen.getByText('15')).toBeInTheDocument();
  });
});

describe('readableTextOn', () => {
  it('picks dark text on light accents and white text on dark ones', () => {
    expect(readableTextOn('#facc15')).toBe('#0f172a');
    expect(readableTextOn('#2563eb')).toBe('#ffffff');
    expect(readableTextOn('not-a-colour')).toBe('#ffffff');
  });
});
