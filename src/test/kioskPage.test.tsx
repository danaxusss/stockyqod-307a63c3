import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import KioskPage from '../pages/kiosk/KioskPage';
import { KioskService } from '../utils/kioskService';

vi.mock('../utils/kioskService', () => ({
  KioskService: {
    loadPublic: vi.fn(),
    listPublicProducts: vi.fn(),
    submit: vi.fn(),
    imageUrl: vi.fn(() => null),
  },
}));

const service = vi.mocked(KioskService);

afterEach(() => vi.clearAllMocks());

describe('KioskPage', () => {
  it('collects contact details, builds a cart and submits a quote request', async () => {
    service.loadPublic.mockResolvedValue({
      profile: {
        id: 'profile-1', name: 'Accueil', company_name: 'Stocky Test',
        greeting_title: 'Bienvenue chez Stocky', greeting_message: 'Préparez votre demande.',
        logo_url: null, accent_color: '#2563eb', language: 'fr', show_prices: true,
        price_mode: 'retail', require_email: false, show_availability: true,
        inactivity_timeout_seconds: 180,
      },
      families: [{ id: 'family-1', name: 'Outillage', sort_order: 0 }],
    });
    service.listPublicProducts.mockResolvedValue({
      products: [{
        barcode: '611000000001', name: 'Perceuse de test', brand: 'Stocky', image: null,
        family_id: 'family-1', family_name: 'Outillage', price: 799, available: true,
      }],
      total: 1, page: 0, page_size: 30,
    });
    service.submit.mockResolvedValue({ request_id: 'request-1', request_number: 'KSK-TEST-001' });

    render(
      <MemoryRouter initialEntries={['/kiosk/00000000-0000-4000-8000-000000000000']}>
        <Routes><Route path="/kiosk/:token" element={<KioskPage />} /></Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Bienvenue chez Stocky' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Commencer/i }));
    fireEvent.change(screen.getByLabelText(/Nom complet/), { target: { value: 'Client Test' } });
    fireEvent.change(screen.getByLabelText(/Téléphone/), { target: { value: '0600000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir le catalogue' }));

    expect(await screen.findByText('Perceuse de test')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Ajouter/i }));
    fireEvent.click(screen.getByRole('button', { name: /Voir ma demande/i }));
    expect(screen.getByRole('heading', { name: 'Vérifier la demande' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Envoyer la demande/i }));

    expect(await screen.findByText('KSK-TEST-001')).toBeInTheDocument();
    await waitFor(() => expect(service.submit).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000000',
      expect.objectContaining({ name: 'Client Test', phone: '0600000000' }),
      [{ barcode: '611000000001', quantity: 1 }],
    ));
  });
});
