import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import KioskPage from '../pages/kiosk/KioskPage';
import { KioskService } from '../utils/kioskService';
import { buildShowcase } from '../utils/kioskShowcase';

vi.mock('../utils/kioskService', () => ({
  KioskRequestError: class KioskRequestError extends Error {
    constructor(message: string, readonly status: number | null, readonly serverMessage: string | null) { super(message); }
  },
  KioskService: { loadPublic: vi.fn(), listPublicProducts: vi.fn(), submit: vi.fn(), imageUrl: vi.fn(() => null) },
}));
// jsdom has no canvas to draw QR codes.
vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn(async () => 'data:image/png;base64,QR') } }));

const service = vi.mocked(KioskService);
const TOKEN = '00000000-0000-4000-8000-000000000000';
const REVIEW = 'https://g.page/r/cuisimat/review';
const DRILL = { barcode: '611000000001', name: 'Perceuse de test', brand: 'Stocky', image: null, kiosk_category: 'equipment' as const, price: 799, available: true };

afterEach(() => { vi.clearAllMocks(); vi.useRealTimers(); sessionStorage.clear(); });

function mockKiosk(overrides: Record<string, unknown> = {}) {
  service.loadPublic.mockResolvedValue({
    profile: {
      id: 'profile-1', name: 'Accueil', company_name: 'Cuisimat', greeting_title: 'Bienvenue chez Cuisimat', greeting_message: 'Préparez votre demande.',
      logo_url: null, accent_color: '#e11d48', language: 'fr', customer_languages: ['fr', 'en', 'ar'], allow_deferred_contact: true,
      success_screen_seconds: 20, grid_columns: 0, show_prices: true, price_mode: 'retail', require_email: false, show_availability: true,
      inactivity_timeout_seconds: 180,
      showcase_enabled: true, showcase_idle_seconds: 30, showcase_slide_seconds: 8, showcase_builtin: true, showcase_slides: [], google_review_url: null,
      ...overrides,
    },
    brands: ['Stocky'],
    sectors: [],
  });
  service.listPublicProducts.mockImplementation(async (_token, options = {}) => (
    options.featuredOnly ? { products: [], total: 0, page: 0, page_size: 24 } : { products: [DRILL], total: 1, page: 0, page_size: 48 }
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

const INTRO = 'Le partenaire des professionnels de la restauration';

describe('showcase slides', () => {
  const custom = { id: 'promo', media_url: 'https://cdn.test/promo.mp4', media_type: 'video' as const, kicker: 'Nouveau', title: 'Machines à café', text: 'En stock' };

  it('plays the built-in presentation, the kiosk’s own slides, the call to action, then the review page', () => {
    const slides = buildShowcase({ showcase_builtin: true, showcase_slides: [custom], google_review_url: REVIEW }, 'fr');
    expect(slides.map(slide => slide.kind)).toEqual(['intro', 'media', 'media', 'media', 'steps', 'mosaic', 'stats', 'cities', 'media', 'cta', 'review']);
    expect(slides[8]).toMatchObject({ title: 'Machines à café', video: 'https://cdn.test/promo.mp4' });
    expect(slides[1].video).toMatch(/kiosk-showcase\/showroom\.mp4$/);
  });

  it('can leave out the built-in presentation and the review page', () => {
    const slides = buildShowcase({ showcase_builtin: false, showcase_slides: [custom], google_review_url: null }, 'fr');
    expect(slides.map(slide => slide.kind)).toEqual(['media', 'cta']);
  });

  it('speaks the customer’s language', () => {
    expect(buildShowcase({ showcase_builtin: true }, 'en')[0].title).toBe('The partner of food-service professionals');
    expect(buildShowcase({ showcase_builtin: true }, 'ar')[7].cities).toContain('الدار البيضاء');
  });
});

describe('KioskPage showcase', () => {
  it('opens on the showcase and goes to the catalogue on a touch', async () => {
    mockKiosk();
    renderKiosk();
    expect(await screen.findByRole('heading', { name: INTRO })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Bienvenue chez Cuisimat' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('heading', { name: INTRO }));
    expect(await screen.findByText('Perceuse de test')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: INTRO })).not.toBeInTheDocument();
  });

  it('moves to the next slide on its own', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockKiosk({ showcase_slide_seconds: 4 });
    renderKiosk();
    expect(await screen.findByRole('heading', { name: INTRO })).toBeInTheDocument();
    await act(async () => {}); // let the slide timer start
    act(() => { vi.advanceTimersByTime(4000); });
    expect(screen.getByRole('heading', { name: '+8 000 références en stock' })).toBeInTheDocument();
  });

  it('comes back after the welcome screen is left alone', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockKiosk({ showcase_idle_seconds: 30 });
    renderKiosk();
    fireEvent.click(await screen.findByRole('button', { name: /Découvrir nos produits/ }));
    expect(await screen.findByText('Perceuse de test')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Accueil' }));
    expect(screen.getByRole('heading', { name: 'Bienvenue chez Cuisimat' })).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(29_000); });
    expect(screen.getByRole('heading', { name: 'Bienvenue chez Cuisimat' })).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(screen.getByRole('heading', { name: INTRO })).toBeInTheDocument();
  });

  it('keeps the classic welcome screen when the showcase is off', async () => {
    mockKiosk({ showcase_enabled: false });
    renderKiosk();
    expect(await screen.findByRole('heading', { name: 'Bienvenue chez Cuisimat' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: INTRO })).not.toBeInTheDocument();
  });

  it('does not cover a selection being resumed after a reload', async () => {
    sessionStorage.setItem(`stocky-kiosk-session:${TOKEN}`, JSON.stringify({
      cart: { [DRILL.barcode]: { product: DRILL, quantity: 2 } }, customer: { name: '', phone: '', email: '', note: '' },
      deferContact: false, stage: 'catalog', language: null, expiresAt: Date.now() + 60_000,
    }));
    mockKiosk();
    renderKiosk();
    expect(await screen.findByText('Perceuse de test')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: INTRO })).not.toBeInTheDocument();
  });

  it('switches the showcase language without leaving it', async () => {
    mockKiosk();
    renderKiosk();
    await screen.findByRole('heading', { name: INTRO });
    fireEvent.click(screen.getByRole('button', { name: 'EN' }));
    expect(await screen.findByRole('heading', { name: 'The partner of food-service professionals' })).toBeInTheDocument();
  });

  it('opens the Google review page with its QR code', async () => {
    mockKiosk({ google_review_url: REVIEW });
    renderKiosk();
    await screen.findByRole('heading', { name: INTRO });
    fireEvent.click(screen.getByRole('button', { name: /Laisser un avis/ }));
    const dialog = screen.getByRole('dialog', { name: 'Votre avis compte !' });
    expect(await within(dialog).findByAltText('QR code')).toHaveAttribute('src', 'data:image/png;base64,QR');
    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Fermer' })[0]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: INTRO })).toBeInTheDocument();
  });

  it('invites a review after a request is sent', async () => {
    mockKiosk({ google_review_url: REVIEW });
    renderKiosk();
    fireEvent.click(await screen.findByRole('button', { name: /Découvrir nos produits/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Ajouter/ }));
    fireEvent.click(screen.getByRole('button', { name: /Voir ma demande/ }));
    fireEvent.change(screen.getByLabelText(/Nom complet/), { target: { value: 'Client Test' } });
    fireEvent.change(screen.getByLabelText(/Téléphone/), { target: { value: '0612345678' } });
    fireEvent.click(screen.getByRole('button', { name: /Envoyer la demande/ }));
    expect(await screen.findByText('KSK-TEST-001')).toBeInTheDocument();
    expect(screen.getByText('Satisfait de votre visite ? Laissez-nous un avis Google.')).toBeInTheDocument();
    expect(await screen.findByAltText('QR code')).toBeInTheDocument();
  });

  it('offers the review page from the welcome screen too', async () => {
    mockKiosk({ showcase_enabled: false, google_review_url: REVIEW });
    renderKiosk();
    fireEvent.click(await screen.findByRole('button', { name: /Laisser un avis/ }));
    expect(screen.getByRole('dialog', { name: 'Votre avis compte !' })).toBeInTheDocument();
  });
});
