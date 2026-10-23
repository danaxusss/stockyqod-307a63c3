import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

afterEach(() => { vi.clearAllMocks(); vi.useRealTimers(); });

function mockKiosk(overrides: Record<string, unknown> = {}) {
  service.loadPublic.mockResolvedValue({
    profile: {
      id: 'profile-1', name: 'Accueil', company_name: 'Stocky Test',
      greeting_title: 'Bienvenue chez Stocky', greeting_message: 'Préparez votre demande.',
      logo_url: null, accent_color: '#2563eb', language: 'fr', show_prices: true,
      price_mode: 'retail', require_email: true, show_availability: true,
      inactivity_timeout_seconds: 180,
      ...overrides,
    },
    brands: ['Stocky'],
  });
  service.listPublicProducts.mockResolvedValue({
    products: [{
      barcode: '611000000001', name: 'Perceuse de test', brand: 'Stocky', image: null,
      kiosk_category: 'equipment', price: 799, available: true,
    }],
    total: 1, page: 0, page_size: 30,
  });
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
    service.listPublicProducts.mockRejectedValueOnce(new KioskRequestError('Too many requests', 429, 'Too many requests'));
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
    expect(service.listPublicProducts).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /Retour au catalogue/i }));
    expect(await screen.findByText('Perceuse de test')).toBeInTheDocument();
    expect(service.listPublicProducts).toHaveBeenCalledTimes(1);
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
});

describe('readableTextOn', () => {
  it('picks dark text on light accents and white text on dark ones', () => {
    expect(readableTextOn('#facc15')).toBe('#0f172a');
    expect(readableTextOn('#2563eb')).toBe('#ffffff');
    expect(readableTextOn('not-a-colour')).toBe('#ffffff');
  });
});
