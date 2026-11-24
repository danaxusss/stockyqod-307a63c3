import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Boxes, Calculator } from 'lucide-react';
import type { NavModule } from '../lib/navigation';

// iPad: below 1024 px the menu is an icon rail with labels that opens over the
// page; from 1024 px it sits beside the page as before.
const modules: NavModule[] = [
  { id: 'stock', label: 'Stock', icon: Boxes, prefixes: ['/inventaire'], items: [{ to: '/inventaire', label: 'Tableau de bord' }, { to: '/inventaire/bons', label: 'Bons d’entrée / sortie' }] },
  { id: 'comptabilite', label: 'Comptabilité', icon: Calculator, prefixes: ['/comptabilite'], items: [{ to: '/comptabilite', label: 'Vue d’ensemble' }] },
];

vi.mock('../hooks/useTheme', () => ({ useTheme: () => ({ theme: 'light', toggle: () => {} }) }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ isAdmin: true, isSuperAdmin: false, companyName: 'Cuisimat', currentUser: { username: 'nour' }, newRole: 'admin', tasksRole: null, logout: () => {} }) }));
vi.mock('../hooks/useUserAuth', () => ({ useUserAuth: () => ({ isAuthenticated: true, authenticatedUser: { username: 'nour' }, logout: () => {} }) }));
vi.mock('../hooks/useAccess', () => ({ useAccess: () => ({ access: { tasksOnly: false }, modules }) }));
vi.mock('../hooks/useHomeData', () => ({ useHomeData: () => ({ data: null }) }));
vi.mock('../context/AppContext', () => ({ useAppContext: () => ({ syncInfo: { isOnline: true, pendingChanges: 0 }, syncData: async () => false }) }));
vi.mock('../context/ToastContext', () => ({ useToast: () => ({ showToast: () => {} }) }));

import { Sidebar } from '../components/Sidebar';

const realMatchMedia = window.matchMedia;
function screenWidth(width: number, touch = false) {
  window.matchMedia = ((query: string) => {
    const min = /min-width:\s*(\d+)px/.exec(query);
    const matches = min ? width >= Number(min[1]) : query.includes('hover: none') ? touch : false;
    return { matches, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false };
  }) as typeof window.matchMedia;
}

beforeEach(() => localStorage.clear());
afterEach(() => { window.matchMedia = realMatchMedia; });

const renderSidebar = (props: Parameters<typeof Sidebar>[0] = {}) =>
  render(<MemoryRouter initialEntries={['/']}><Sidebar {...props} /></MemoryRouter>);

describe('menu on an iPad in portrait (810 px)', () => {
  it('is a rail that names each icon', () => {
    screenWidth(810, true);
    renderSidebar({ onRequestOpen: () => {} });
    expect(screen.getByText('Stock')).toBeInTheDocument();
    expect(screen.getByText('Compta')).toBeInTheDocument();
    // Sub-pages are not listed until the menu is opened.
    expect(screen.queryByText('Bons d’entrée / sortie')).not.toBeInTheDocument();
  });

  it('opens over the page on the tapped module instead of leaving the page', () => {
    screenWidth(810, true);
    const onRequestOpen = vi.fn();
    const { rerender } = renderSidebar({ onRequestOpen });
    fireEvent.click(screen.getByRole('button', { name: /Stock/ }));
    expect(onRequestOpen).toHaveBeenCalledTimes(1);
    rerender(<MemoryRouter initialEntries={['/']}><Sidebar mobileOpen onRequestOpen={onRequestOpen} /></MemoryRouter>);
    expect(screen.getByText('Bons d’entrée / sortie')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fermer le menu' })).toBeInTheDocument();
  });

  it('offers the assistant in the account menu', () => {
    screenWidth(810, true);
    renderSidebar({ onRequestOpen: () => {}, onOpenAssistant: () => {} });
    fireEvent.click(screen.getByRole('button', { name: /Compte/ }));
    expect(screen.getByRole('menuitem', { name: /Assistant IA/ })).toBeInTheDocument();
  });
});

describe('menu on a wide screen (1280 px, mouse)', () => {
  it('sits beside the page with its modules, as before', () => {
    screenWidth(1280);
    renderSidebar({ onRequestOpen: () => {}, onOpenAssistant: () => {} });
    expect(screen.getByText('Comptabilité')).toBeInTheDocument();
    expect(screen.queryByText('Compta')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Compte/ }));
    // The floating "IA" tab is there instead.
    expect(screen.queryByRole('menuitem', { name: /Assistant IA/ })).not.toBeInTheDocument();
  });
});
