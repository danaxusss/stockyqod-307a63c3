import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import KioskInstallPage, { KioskAppLauncher } from '../pages/kiosk/KioskInstallPage';
import { KioskRequestError, KioskService } from '../utils/kioskService';
import { installPlatform, rememberKioskToken, rememberedKioskToken } from '../utils/kioskApp';
import manifest from '../../public/kiosk-manifest.webmanifest?raw';

vi.mock('../utils/kioskService', () => ({
  KioskRequestError: class KioskRequestError extends Error {
    constructor(message: string, readonly status: number | null, readonly serverMessage: string | null) { super(message); }
  },
  KioskService: { loadPublic: vi.fn() },
}));

const TOKEN = '00000000-0000-4000-8000-000000000000';
const load = vi.mocked(KioskService.loadPublic);

afterEach(() => { vi.clearAllMocks(); localStorage.clear(); });

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/kiosk/:token" element={<Where />} />
        <Route path="/kiosk/:token/install" element={<KioskInstallPage />} />
        <Route path="/kiosk/app" element={<KioskAppLauncher />} />
      </Routes>
    </MemoryRouter>,
  );
}

function mockProfile() {
  load.mockResolvedValue({ profile: { id: 'p1', name: 'Showroom Maârif', company_name: 'Cuisimat', accent_color: '#e30613' } as never, brands: [] });
}

describe('kiosk app helpers', () => {
  it('recognises iPads, including those that present themselves as a Mac', () => {
    expect(installPlatform('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)', 5)).toBe('ios');
    expect(installPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5)).toBe('ios');
    expect(installPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0)).toBe('other');
    expect(installPlatform('Mozilla/5.0 (Linux; Android 14; SM-X710)', 10)).toBe('android');
  });

  it('only remembers real kiosk links', () => {
    rememberKioskToken('../../admin');
    expect(rememberedKioskToken()).toBeNull();
    rememberKioskToken(TOKEN);
    expect(rememberedKioskToken()).toBe(TOKEN);
  });
});

describe('KioskInstallPage', () => {
  it('installs in one tap where the browser allows it', async () => {
    mockProfile();
    renderAt(`/kiosk/${TOKEN}/install`);
    expect(await screen.findByRole('heading', { name: 'Kiosque · Showroom Maârif' })).toBeInTheDocument();
    expect(rememberedKioskToken()).toBe(TOKEN);

    const prompt = vi.fn(async () => undefined);
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt, userChoice: Promise.resolve({ outcome: 'accepted' }) });
    act(() => { window.dispatchEvent(event); });
    fireEvent.click(screen.getByRole('button', { name: /Installer l’application/ }));
    expect(await screen.findByText('Application installée')).toBeInTheDocument();
    expect(prompt).toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it('explains the home-screen steps when there is no install prompt', async () => {
    mockProfile();
    renderAt(`/kiosk/${TOKEN}/install`);
    expect(await screen.findByText('Ajouter le kiosque à l’écran d’accueil')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Ouvrir le kiosque sans l’installer/ })).toHaveAttribute('href', `/kiosk/${TOKEN}`);
  });

  it('says when the link no longer exists, and keeps the kiosk the tablet already opens', async () => {
    const WORKING = '11111111-1111-4111-8111-111111111111';
    rememberKioskToken(WORKING);
    load.mockRejectedValue(new KioskRequestError('gone', 404, null));
    renderAt(`/kiosk/${TOKEN}/install`);
    expect(await screen.findByText(/n’existe plus ou a été renouvelé/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Installer/ })).not.toBeInTheDocument();
    expect(rememberedKioskToken()).toBe(WORKING);
  });

  it('goes straight to the kiosk when opened from the home-screen icon', async () => {
    mockProfile();
    const matchMedia = window.matchMedia;
    window.matchMedia = ((query: string) => ({ ...matchMedia(query), matches: query === '(display-mode: standalone)' })) as typeof window.matchMedia;
    try {
      renderAt(`/kiosk/${TOKEN}/install`);
      expect(await screen.findByTestId('where')).toHaveTextContent(`/kiosk/${TOKEN}`);
    } finally {
      window.matchMedia = matchMedia;
    }
  });
});

describe('kiosk app manifest', () => {
  it('starts inside its own scope, which leaves the staff pages out', () => {
    const data = JSON.parse(manifest) as { start_url: string; scope: string; display: string };
    expect(data.start_url.startsWith(data.scope)).toBe(true);
    expect('/kiosk-admin'.startsWith(data.scope)).toBe(false);
    expect(`/kiosk/${TOKEN}`.startsWith(data.scope)).toBe(true);
    expect(data.display).toBe('fullscreen');
  });
});

describe('KioskAppLauncher', () => {
  it('opens the kiosk this tablet was set up with', async () => {
    rememberKioskToken(TOKEN);
    renderAt('/kiosk/app');
    expect(await screen.findByTestId('where')).toHaveTextContent(`/kiosk/${TOKEN}`);
  });

  it('asks for the install link on a tablet that was never set up', () => {
    renderAt('/kiosk/app');
    expect(screen.getByRole('heading', { name: 'Kiosque à configurer' })).toBeInTheDocument();
  });
});
